package web

import (
	"bytes"
	"compress/gzip"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Catálogo de lugares elegibles en el buscador (scripts/lugares/generar.mjs):
// nombres y códigos de los registros oficiales de cada país. La búsqueda solo
// admite lugares de este catálogo, nunca texto libre.
//
//go:embed lugares/*.json.gz lugares/paises.json
var lugaresFS embed.FS

// paisLugar es una entrada del índice de países (lugares/paises.json): los
// principales, con fuentes oficiales, primero; después el resto por nombre.
type paisLugar struct {
	CC        string `json:"cc"`
	Nombre    string `json:"nombre"`
	Principal bool   `json:"principal"`
}

var paisesLugares = func() []paisLugar {
	var ps []paisLugar

	data, err := lugaresFS.ReadFile("lugares/paises.json")
	if err == nil {
		_ = json.Unmarshal(data, &ps)
	}

	return ps
}()

// Lugar es un elemento del catálogo tal y como lo recibe la interfaz.
type Lugar struct {
	Tipo      string    `json:"tipo"`     // region | provincia | municipio | localidad | barrio | cp
	Etiqueta  string    `json:"etiqueta"` // «Municipio», «Comuna», «Código postal»…
	Nombre    string    `json:"nombre"`   // nombre oficial
	Contexto  string    `json:"contexto"` // «Madrid · Comunidad de Madrid»
	Lat       float64   `json:"lat"`      //
	Lon       float64   `json:"lon"`      //
	CP        string    `json:"cp,omitempty"`
	Codigo    string    `json:"codigo,omitempty"` // código oficial (INE, INEGI, DIVIPOLA, ubigeo…)
	Fuente    string    `json:"fuente"`           // texto de la fuente
	Poblacion int64     `json:"poblacion,omitempty"`
	BBox      []float64 `json:"bbox,omitempty"` // límite oficial [latMín, lonMín, latMáx, lonMáx]
	Zoom      int       `json:"zoom"`           // encuadre de Google Maps para buscar en esa zona
	RadioKm   float64   `json:"radio_km"`       // tolerancia para validar que un resultado está en la zona
	Consulta  string    `json:"consulta"`       // cómo se nombra la zona en la búsqueda de Google Maps
	Pais      string    `json:"pais"`
}

type catLugares struct {
	Pais     string            `json:"pais"`
	Niveles  map[string]string `json:"niveles"`
	Fuentes  map[string]string `json:"fuentes"`
	Generado string            `json:"generado"`
	Items    [][]any           `json:"items"`

	lugares []Lugar
	claves  []string // nombre normalizado
	textos  []string // nombre + contexto + CP normalizados
}

var (
	lugaresMu  sync.Mutex
	lugaresCat = map[string]*catLugares{}
)

var sinTildes = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// normalizar: minúsculas, sin tildes, signos como espacios. «Ñ» se conserva como «n».
func normalizar(s string) string {
	t, _, err := transform.String(sinTildes, s)
	if err != nil {
		t = s
	}

	var b strings.Builder

	espacio := true

	for _, r := range strings.ToLower(t) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)

			espacio = false
		} else if !espacio {
			b.WriteByte(' ')

			espacio = true
		}
	}

	return strings.TrimSpace(b.String())
}

func etiquetaTipo(c *catLugares, tipo string) string {
	switch tipo {
	case "cp":
		return "Código postal"
	case "barrio":
		if c.Pais == "MX" {
			return "Colonia / barrio"
		}

		return "Barrio"
	case "localidad":
		return "Localidad"
	}

	if e := c.Niveles[tipo]; e != "" {
		return e
	}

	return strings.ToUpper(tipo[:1]) + tipo[1:]
}

// zoomYRadio calcula el encuadre de Google Maps y la tolerancia de validación:
// con el límite oficial cuando existe; si no, según el tipo de lugar.
func zoomYRadio(tipo string, bbox []float64, pob int64) (int, float64) {
	if len(bbox) == 4 {
		alto := (bbox[2] - bbox[0]) * 111
		ancho := (bbox[3] - bbox[1]) * 111 * math.Cos((bbox[0]+bbox[2])/2*math.Pi/180)
		lado := math.Max(math.Max(alto, ancho), 1)
		radio := math.Hypot(alto, ancho)/2 + 1
		// Google Maps a zoom z muestra unos 40000/2^z km en 1000 px de ancho.
		z := int(math.Round(math.Log2(40000 / lado)))

		return max(8, min(16, z)), math.Round(radio*10) / 10
	}

	switch tipo {
	case "cp", "barrio":
		return 15, 3
	case "localidad":
		return 14, 5
	case "municipio":
		if pob > 500000 {
			return 12, 20
		}

		return 13, 10
	case "provincia":
		return 10, 70
	default:
		return 8, 250
	}
}

func consultaDe(l *Lugar, pais string) string {
	partes := []string{l.Nombre}
	if l.Tipo == "cp" {
		partes = []string{l.CP}
	}

	for _, p := range strings.Split(l.Contexto, " · ") {
		p = strings.TrimSpace(strings.TrimPrefix(p, "CP "))
		if p != "" && !strings.EqualFold(p, partes[len(partes)-1]) && p != l.CP {
			partes = append(partes, p)
		}
	}

	if !strings.EqualFold(partes[len(partes)-1], pais) {
		partes = append(partes, pais)
	}

	return strings.Join(partes, ", ")
}

func nombrePais(cc string) string {
	for _, p := range paisesLugares {
		if p.CC == cc {
			return p.Nombre
		}
	}

	return ""
}

func cargarLugares(cc string) (*catLugares, error) {
	lugaresMu.Lock()
	defer lugaresMu.Unlock()

	if c, ok := lugaresCat[cc]; ok {
		return c, nil
	}

	if nombrePais(cc) == "" {
		return nil, fmt.Errorf("país sin catálogo de lugares: %s", cc)
	}

	gz, err := lugaresFS.ReadFile("lugares/" + cc + ".json.gz")
	if err != nil {
		return nil, err
	}

	zr, err := gzip.NewReader(bytes.NewReader(gz))
	if err != nil {
		return nil, err
	}

	var c catLugares
	if err := json.NewDecoder(zr).Decode(&c); err != nil {
		return nil, err
	}

	pais := nombrePais(cc)
	c.lugares = make([]Lugar, 0, len(c.Items))

	for _, it := range c.Items {
		if len(it) < 9 {
			continue
		}

		str := func(i int) string { s, _ := it[i].(string); return s }
		num := func(i int) float64 { f, _ := it[i].(float64); return f }

		l := Lugar{Tipo: str(0), Nombre: str(1), Contexto: str(2), Lat: num(3), Lon: num(4), CP: str(5), Codigo: str(6),
			Fuente: c.Fuentes[str(7)], Poblacion: int64(num(8)), Pais: cc}

		if len(it) > 9 {
			if bb, ok := it[9].([]any); ok && len(bb) == 4 {
				for _, v := range bb {
					f, _ := v.(float64)
					l.BBox = append(l.BBox, f)
				}
			}
		}

		// Nombres alternativos (sobre todo en español: «Londres», «Múnich») que
		// sirven para buscar pero no se muestran, y radio por superficie oficial.
		alias := ""
		if len(it) > 10 {
			alias = str(10)
		}

		l.Etiqueta = etiquetaTipo(&c, l.Tipo)
		l.Zoom, l.RadioKm = zoomYRadio(l.Tipo, l.BBox, l.Poblacion)

		if len(it) > 11 {
			if km := num(11); km > 0 && len(l.BBox) == 0 {
				l.RadioKm = math.Round((km+0.5)*10) / 10
				l.Zoom = max(8, min(16, int(math.Round(math.Log2(40000/math.Max(2*km, 1))))))
			}
		}

		l.Consulta = consultaDe(&l, pais)
		c.lugares = append(c.lugares, l)
		c.claves = append(c.claves, normalizar(l.Nombre))
		c.textos = append(c.textos, normalizar(l.Nombre+" "+l.Contexto+" "+l.CP+" "+alias))
	}

	c.Items = nil
	lugaresCat[cc] = &c

	return &c, nil
}

var pesoTipo = map[string]float64{"municipio": 60, "region": 55, "provincia": 50, "localidad": 40, "barrio": 35, "cp": 20}

var reSoloDigitos = regexp.MustCompile(`^\d+$`)

var palabrasVacias = map[string]bool{"de": true, "del": true, "la": true, "las": true, "el": true, "los": true, "y": true, "e": true, "a": true, "en": true, "d": true, "c": true}

// significativas quita duplicados, preposiciones y artículos.
func significativas(ws []string) []string {
	out := []string{}
	visto := map[string]bool{}

	for _, w := range ws {
		if !palabrasVacias[w] && !visto[w] {
			visto[w] = true
			out = append(out, w)
		}
	}

	return out
}

// buscarLugares devuelve los lugares cuyo nombre, contexto o CP contienen todas
// las palabras buscadas, los más probables primero.
func buscarLugares(cc, q string, limite int) ([]Lugar, error) {
	c, err := cargarLugares(cc)
	if err != nil {
		return nil, err
	}

	nq := normalizar(q)
	if nq == "" {
		return []Lugar{}, nil
	}

	palabras := strings.Fields(nq)
	digitos := reSoloDigitos.MatchString(strings.ReplaceAll(nq, " ", ""))

	type cand struct {
		i     int
		score float64
	}

	var cs []cand

	for i, l := range c.lugares {
		if digitos {
			if l.CP == "" || !strings.HasPrefix(l.CP, strings.ReplaceAll(nq, " ", "")) {
				continue
			}

			s := 100.0
			if l.Tipo == "cp" {
				s += 500
			}

			if l.CP == nq {
				s += 200
			}

			cs = append(cs, cand{i, s})

			continue
		}

		texto := " " + c.textos[i] + " "
		ok := true

		for _, p := range palabras {
			if !strings.Contains(texto, " "+p) {
				ok = false

				break
			}
		}

		if !ok {
			continue
		}

		clave := c.claves[i]
		s := pesoTipo[l.Tipo] + math.Log10(float64(l.Poblacion)+1)*12

		switch {
		case clave == nq:
			s += 1000
		case strings.HasPrefix(clave, nq):
			s += 600
		default:
			// Palabras significativas del nombre presentes en la búsqueda, y un extra
			// si el nombre queda cubierto entero («miguel hidalgo» en «miguel hidalgo
			// ciudad de mexico»). Las preposiciones y artículos no puntúan.
			delNombre := " " + clave + " "
			for _, p := range significativas(palabras) {
				if strings.Contains(delNombre, " "+p) {
					s += 100
				}
			}

			cubierto := true

			for _, w := range significativas(strings.Fields(clave)) {
				if !strings.Contains(" "+nq+" ", " "+w+" ") {
					cubierto = false

					break
				}
			}

			if cubierto {
				s += 300
			}
		}

		cs = append(cs, cand{i, s - float64(len(clave))/10})
	}

	sort.SliceStable(cs, func(a, b int) bool { return cs[a].score > cs[b].score })

	out := make([]Lugar, 0, min(limite, len(cs)))
	for _, x := range cs[:min(limite, len(cs))] {
		out = append(out, c.lugares[x.i])
	}

	return out, nil
}

// ---------------------------------------------------------------------------
// Verificación oficial de códigos postales de España en CartoCiudad (IGN)
// ---------------------------------------------------------------------------

var cartoCiudadURL = "https://www.cartociudad.es/geocoder/api/geocoder/find"

type verificacion struct {
	OK     bool    `json:"ok"`
	Lat    float64 `json:"lat,omitempty"`
	Lon    float64 `json:"lon,omitempty"`
	Fuente string  `json:"fuente"`
	Motivo string  `json:"motivo,omitempty"`
}

var reCPES = regexp.MustCompile(`^(0[1-9]|[1-4]\d|5[0-2])\d{3}$`)

func verificarCPEspana(ctx context.Context, cp string) verificacion {
	v := verificacion{Fuente: "CartoCiudad (Instituto Geográfico Nacional)"}

	if !reCPES.MatchString(cp) {
		v.Motivo = "No es un código postal español válido"

		return v
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cartoCiudadURL+"?id="+url.QueryEscape(cp)+"&type=Codpost", nil)
	if err != nil {
		v.Motivo = err.Error()

		return v
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		v.Motivo = "CartoCiudad no responde: no se ha podido verificar"

		return v
	}

	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var r struct {
		PostalCode string  `json:"postalCode"`
		Lat        float64 `json:"lat"`
		Lng        float64 `json:"lng"`
	}

	if resp.StatusCode != http.StatusOK || json.Unmarshal(body, &r) != nil || r.PostalCode != cp || (r.Lat == 0 && r.Lng == 0) {
		v.Motivo = "CartoCiudad no reconoce este código postal"

		return v
	}

	v.OK, v.Lat, v.Lon = true, r.Lat, r.Lng

	return v
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

func (s *Server) apiLugares(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cc := strings.ToUpper(q.Get("pais"))
	limite, _ := strconv.Atoi(q.Get("limite"))

	if limite <= 0 || limite > 50 {
		limite = 12
	}

	res, err := buscarLugares(cc, q.Get("q"), limite)
	if err != nil {
		renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: err.Error()})

		return
	}

	renderJSON(w, http.StatusOK, res)
}

type paisLugares struct {
	CC       string            `json:"cc"`
	Nombre   string            `json:"nombre"`
	Niveles  map[string]string `json:"niveles"`
	Fuentes  map[string]string `json:"fuentes"`
	Generado string            `json:"generado"`
	Lugares  int               `json:"lugares"`
}

// apiLugaresPaises devuelve el índice de países; con ?cc= devuelve además las
// fuentes y el tamaño del catálogo de ese país (y lo deja cargado).
func (s *Server) apiLugaresPaises(w http.ResponseWriter, r *http.Request) {
	if cc := strings.ToUpper(r.URL.Query().Get("cc")); cc != "" {
		c, err := cargarLugares(cc)
		if err != nil {
			renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: err.Error()})

			return
		}

		renderJSON(w, http.StatusOK, paisLugares{CC: cc, Nombre: nombrePais(cc), Niveles: c.Niveles, Fuentes: c.Fuentes, Generado: c.Generado, Lugares: len(c.lugares)})

		return
	}

	renderJSON(w, http.StatusOK, paisesLugares)
}

func (s *Server) apiLugaresVerificar(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if strings.ToUpper(q.Get("pais")) != "ES" {
		renderJSON(w, http.StatusOK, verificacion{Fuente: "", Motivo: "Sin verificador oficial en línea para este país"})

		return
	}

	renderJSON(w, http.StatusOK, verificarCPEspana(r.Context(), strings.TrimSpace(q.Get("cp"))))
}

// validarZonas comprueba que cada zona de una búsqueda existe en el catálogo
// oficial y la sustituye por la del catálogo (no se fía de lo que envíe el cliente).
// Las coordenadas verificadas en CartoCiudad se conservan si están muy cerca.
func validarZonas(zs []Lugar) ([]Lugar, error) {
	out := make([]Lugar, 0, len(zs))

	for _, z := range zs {
		c, err := cargarLugares(strings.ToUpper(z.Pais))
		if err != nil {
			return nil, err
		}

		var hallado *Lugar

		for i := range c.lugares {
			l := &c.lugares[i]
			if l.Tipo == z.Tipo && l.Nombre == z.Nombre && l.Contexto == z.Contexto && l.CP == z.CP && l.Codigo == z.Codigo {
				hallado = l

				break
			}
		}

		if hallado == nil {
			return nil, fmt.Errorf("la zona «%s» no está en el catálogo oficial de lugares", z.Nombre)
		}

		ok := *hallado
		if z.Lat != 0 && math.Abs(z.Lat-ok.Lat) < 0.05 && math.Abs(z.Lon-ok.Lon) < 0.05 {
			ok.Lat, ok.Lon = z.Lat, z.Lon
		}

		out = append(out, ok)
	}

	return out, nil
}

var reGeoConsulta = regexp.MustCompile(`^#@\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,2})\s*$`)

// validarGeoConsulta rechaza al crear la búsqueda un sufijo «#@lat,lon,zoom» mal
// formado o fuera de rango (el motor lo rechazaría después, con la búsqueda ya en cola).
func validarGeoConsulta(k string) error {
	i := strings.Index(k, "#@")
	if i < 0 {
		return nil
	}

	if strings.TrimSpace(k[:i]) == "" {
		return fmt.Errorf("consulta vacía: «%s»", k)
	}

	m := reGeoConsulta.FindStringSubmatch(k[i:])
	if m == nil {
		return fmt.Errorf("coordenadas mal formadas en la consulta «%s»", k)
	}

	lat, _ := strconv.ParseFloat(m[1], 64)
	lon, _ := strconv.ParseFloat(m[2], 64)
	zoom, _ := strconv.Atoi(m[3])

	if lat < -90 || lat > 90 || lon < -180 || lon > 180 || zoom < 1 || zoom > 21 {
		return fmt.Errorf("coordenadas o zoom fuera de rango en la consulta «%s»", k)
	}

	return nil
}
