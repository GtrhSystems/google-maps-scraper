package web

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Resena es una reseña pública de Google Maps con la respuesta del propietario.
type Resena struct {
	ID             string `json:"id,omitempty"`
	Valoracion     int    `json:"valoracion"`
	Texto          string `json:"texto,omitempty"`
	Fecha          string `json:"fecha,omitempty"` // AAAA-MM-DD
	Cuando         string `json:"cuando,omitempty"`
	Idioma         string `json:"idioma,omitempty"`
	Respuesta      string `json:"respuesta,omitempty"`
	FechaRespuesta string `json:"fecha_respuesta,omitempty"`
}

// reFicha extrae el identificador estable de la ficha («0x…:0x…») del enlace de Google Maps.
var reFicha = regexp.MustCompile(`!1s(0x[0-9a-f]+:0x[0-9a-f]+)|[?&]ftid=(0x[0-9a-f]+:0x[0-9a-f]+)`)

// claveFicha identifica un negocio: su ficha de Google o, si no hay, su nombre.
func claveFicha(link, titulo string) string {
	if m := reFicha.FindStringSubmatch(link); m != nil {
		if m[1] != "" {
			return m[1]
		}

		return m[2]
	}

	return "t:" + normalizar(titulo)
}

func fechaMicros(us int64) string {
	if us <= 0 {
		return ""
	}

	return time.UnixMicro(us).UTC().Format("2006-01-02")
}

// leerResenas lee todas las reseñas de un CSV de resultados, por negocio.
func leerResenas(path string) (map[string][]Resena, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	defer func() { _ = f.Close() }()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	r.LazyQuotes = true

	header, err := r.Read()
	if err != nil {
		if errors.Is(err, io.EOF) {
			return map[string][]Resena{}, nil
		}

		return nil, err
	}

	col := map[string]int{}
	for i, h := range header {
		col[h] = i
	}

	get := func(row []string, k string) string {
		if i, ok := col[k]; ok && i < len(row) {
			return row[i]
		}

		return ""
	}

	type raw struct {
		ID          string `json:"review_id"`
		Rating      int    `json:"Rating"`
		Description string `json:"Description"`
		When        string `json:"When"`
		Language    string `json:"language"`
		Posted      int64  `json:"posted_at_unix_micros"`
		Reply       string `json:"reply_text"`
		ReplyPosted int64  `json:"reply_posted_at_unix_micros"`
	}

	out := map[string][]Resena{}

	for {
		row, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}

		if err != nil {
			return nil, err
		}

		clave := claveFicha(get(row, "link"), get(row, "title"))
		visto := map[string]bool{}

		for _, k := range []string{"user_reviews", "user_reviews_extended"} {
			var rs []raw
			if json.Unmarshal([]byte(get(row, k)), &rs) != nil {
				continue
			}

			for _, x := range rs {
				id := x.ID
				if id == "" {
					id = x.When + "|" + x.Description
				}

				if visto[id] || x.Rating < 1 || x.Rating > 5 {
					continue
				}

				visto[id] = true
				out[clave] = append(out[clave], Resena{
					ID: x.ID, Valoracion: x.Rating, Texto: strings.TrimSpace(x.Description), Fecha: fechaMicros(x.Posted), Cuando: x.When,
					Idioma: x.Language, Respuesta: strings.TrimSpace(x.Reply), FechaRespuesta: fechaMicros(x.ReplyPosted),
				})
			}
		}
	}

	return out, nil
}

// ---------------------------------------------------------------------------
// Análisis por aspectos (léxicos en español e inglés; sin servicios externos)
// ---------------------------------------------------------------------------

type aspectoDef struct {
	clave, nombre string
	re            *regexp.Regexp
}

var aspectos = []aspectoDef{
	{"atencion", "Trato y atención", regexp.MustCompile(`(?i)\b(atenci[oó]n|trato|amab|simp[aá]tic|atent[oa]s?\b|cari[ñn]|educad|cercan|borde|grosero|antip[aá]tic|maleducad|friendly|kind\b|rude|staff|attentive|welcoming|customer service)`)},
	{"calidad", "Profesionalidad y calidad", regexp.MustCompile(`(?i)\b(profesional|expert|calidad|competen|conocimiento|chapuza|incompeten|meticulos|detallist|professional|skilled|experienced|quality|thorough|knowledgeable)`)},
	{"resultado", "Resultado", regexp.MustCompile(`(?i)\b(resultado|qued[oó]|quedaron|encant[oóa]|me gust[oó]|satisfech|decepcion|arruin|estrope|result|disappoint|ruined|exceeded|nailed)`)},
	{"precio", "Precio y valor", regexp.MustCompile(`(?i)\b(precio|caro|cara|barat|econ[oó]mic|asequible|cobr|factur|presupuesto|calidad[- ]precio|price|pricey|expensive|cheap|affordable|overpriced|worth|value for money|charged?)`)},
	{"tiempo", "Tiempo y puntualidad", regexp.MustCompile(`(?i)\b(esper|puntual|retras|demor|r[aá]pid|lent[oa]s?\b|a tiempo|cola\b|wait|late\b|delay|on time|quick|fast|slow|punctual)`)},
	{"instalaciones", "Instalaciones y limpieza", regexp.MustCompile(`(?i)\b(limpi|suci|instalaci|ambiente|decoraci|moderno|local\b|clean|dirty|facilit|atmosphere|cozy|cosy|spotless|decor)`)},
	{"comunicacion", "Comunicación y citas", regexp.MustCompile(`(?i)\b(tel[eé]fono|llam|contest|whatsapp|correo|explic|inform[aó]|comunica|cita|reserv|phone|call(ed)?\b|answer|email|explain|communicat|appointment|booking|schedul)`)},
	{"ubicacion", "Ubicación y acceso", regexp.MustCompile(`(?i)\b(ubicaci|aparca|parking|acceso|metro|c[eé]ntric|location|parking|easy to find|accesib)`)},
}

var (
	rePositivo = regexp.MustCompile(`(?i)\b(excelente|excelent|genial|maravill|perfect|encant|recomiend|recomendad|buen[oa]?s?\b|mejor(es)?\b|fant[aá]stic|incre[ií]ble|estupend|feliz|gracias|super\b|great|excellent|amazing|love[d]?\b|best|awesome|fantastic|wonderful|perfect|recommend|happy|thank)`)
	reNegativo = regexp.MustCompile(`(?i)\b(mal[oa]?s?\b|p[eé]sim|horrible|terrible|nunca|decepcion|caro\b|sucio|grosero|borde|lament|queja|fatal|desastre|peor\b|worst|bad\b|awful|rude|never|disappoint|overpriced|dirty|horrible|poor\b|unprofessional|complain|waste)`)
	reNegacion = regexp.MustCompile(`(?i)\b(no|nada|nunca|ni|not|never|don'?t|didn'?t|wasn'?t|isn'?t)\s+(\S+\s+){0,2}?(excelente\b|buen[oa]?s?\b|recomiend\w*|recomendable|good\b|great\b|recommend\w*|worth\b)`)
	reFrase    = regexp.MustCompile(`[.!?¡¿\n;]+`)
	rePalabra  = regexp.MustCompile(`[\p{L}]+`)
)

// polaridad de una frase: +1, -1 o 0 (sin señal léxica clara).
func polaridad(frase string) int {
	neg := len(reNegativo.FindAllString(frase, -1)) + 2*len(reNegacion.FindAllString(frase, -1))
	pos := len(rePositivo.FindAllString(frase, -1)) - len(reNegacion.FindAllString(frase, -1))

	switch {
	case pos > neg:
		return 1
	case neg > pos:
		return -1
	}

	return 0
}

// Aspecto resume cuántas reseñas hablan de un aspecto y en qué tono.
type Aspecto struct {
	Clave      string `json:"clave"`
	Nombre     string `json:"nombre"`
	Menciones  int    `json:"menciones"`
	Positivas  int    `json:"positivas"`
	Negativas  int    `json:"negativas"`
	EjemploPos string `json:"ejemplo_pos,omitempty"`
	EjemploNeg string `json:"ejemplo_neg,omitempty"`
}

// AnalisisResenas es la voz del cliente de un negocio.
type AnalisisResenas struct {
	Muestra       int            `json:"muestra"`
	Media         float64        `json:"media"`
	Distribucion  [5]int         `json:"distribucion"` // de 1 a 5 estrellas
	ConTexto      int            `json:"con_texto"`
	LongitudMedia int            `json:"longitud_media"`
	Respondidas   int            `json:"respondidas"`
	PctRespuesta  float64        `json:"pct_respuesta"`
	MasReciente   string         `json:"mas_reciente,omitempty"`
	MasAntigua    string         `json:"mas_antigua,omitempty"`
	Ultimos90     int            `json:"ultimos_90"`
	Aspectos      []Aspecto      `json:"aspectos"`
	FrasesPos     []string       `json:"frases_pos,omitempty"`
	FrasesNeg     []string       `json:"frases_neg,omitempty"`
	Idiomas       map[string]int `json:"idiomas,omitempty"`
	Autenticidad  Autenticidad   `json:"autenticidad"`
	CitaMejor     string         `json:"cita_mejor,omitempty"`
	CitaPeor      string         `json:"cita_peor,omitempty"`
}

// Autenticidad reúne indicios (no pruebas) de reseñas poco naturales.
type Autenticidad struct {
	PctSinTexto float64 `json:"pct_sin_texto"`      // valoraciones sin comentario
	PctCinco    float64 `json:"pct_cinco"`          // proporción de 5 estrellas
	CincoCortas int     `json:"cinco_cortas"`       // 5★ con menos de 25 caracteres
	Duplicadas  int     `json:"duplicadas"`         // textos repetidos
	MesPico     string  `json:"mes_pico,omitempty"` // mes con más reseñas
	PctMesPico  float64 `json:"pct_mes_pico"`       // % de la muestra en ese mes
	Nivel       string  `json:"nivel"`              // natural | revisar | sospechoso | sin datos
}

var palabrasVaciasFrases = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`de la el los las un una unos unas y o a en con por para que se lo le les me mi mis tu su sus es son fue era muy mas más pero como al del ya ha he han hay este esta esto estos estas ese esa eso muy todo toda todos todas nos nuestro nuestra the a an and or of to in on for with is was are were it this that my our their very so but at as be been have has had i we you they me us them your his her its not no si sí también tambien porque cuando donde`) {
		palabrasVaciasFrases[w] = true
	}
}

func frasesFrecuentes(textos []string, max int) []string {
	cuenta := map[string]int{}

	for _, t := range textos {
		ws := []string{}
		for _, w := range rePalabra.FindAllString(strings.ToLower(t), -1) {
			ws = append(ws, w)
		}

		visto := map[string]bool{}

		for n := 2; n <= 3; n++ {
			for i := 0; i+n <= len(ws); i++ {
				g := ws[i : i+n]
				if palabrasVaciasFrases[g[0]] || palabrasVaciasFrases[g[n-1]] || utf8.RuneCountInString(g[0]) < 3 {
					continue
				}

				k := strings.Join(g, " ")
				if !visto[k] {
					visto[k] = true
					cuenta[k]++
				}
			}
		}
	}

	type kv struct {
		k string
		v int
	}

	var xs []kv

	for k, v := range cuenta {
		if v >= 2 {
			xs = append(xs, kv{k, v})
		}
	}

	sort.Slice(xs, func(i, j int) bool {
		if xs[i].v != xs[j].v {
			return xs[i].v > xs[j].v
		}

		return len(xs[i].k) > len(xs[j].k)
	})

	out := []string{}

	for _, x := range xs {
		// Sin repetir una frase contenida en otra ya elegida.
		dup := false

		for _, o := range out {
			if strings.Contains(o, x.k) || strings.Contains(x.k, o) {
				dup = true

				break
			}
		}

		if !dup {
			out = append(out, x.k)
		}

		if len(out) >= max {
			break
		}
	}

	return out
}

func recorte(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}

	r := []rune(s)

	return strings.TrimSpace(string(r[:n])) + "…"
}

// analizarResenas calcula la voz del cliente de un negocio a partir de sus reseñas.
func analizarResenas(rs []Resena, hoy time.Time) AnalisisResenas {
	a := AnalisisResenas{Muestra: len(rs), Idiomas: map[string]int{}}
	if len(rs) == 0 {
		a.Autenticidad.Nivel = "sin datos"

		return a
	}

	suma, largo := 0, 0
	porMes := map[string]int{}
	textos := map[string]int{}
	asp := map[string]*Aspecto{}

	for _, d := range aspectos {
		asp[d.clave] = &Aspecto{Clave: d.clave, Nombre: d.nombre}
	}

	var pos, neg []string

	mejor, peor := -1, -1

	for i, r := range rs {
		suma += r.Valoracion
		a.Distribucion[r.Valoracion-1]++

		if r.Respuesta != "" {
			a.Respondidas++
		}

		if r.Idioma != "" {
			a.Idiomas[r.Idioma]++
		}

		if r.Fecha != "" {
			if a.MasReciente == "" || r.Fecha > a.MasReciente {
				a.MasReciente = r.Fecha
			}

			if a.MasAntigua == "" || r.Fecha < a.MasAntigua {
				a.MasAntigua = r.Fecha
			}

			porMes[r.Fecha[:7]]++

			if t, err := time.Parse("2006-01-02", r.Fecha); err == nil && hoy.Sub(t) <= 90*24*time.Hour {
				a.Ultimos90++
			}
		}

		if r.Texto == "" {
			continue
		}

		a.ConTexto++
		n := utf8.RuneCountInString(r.Texto)
		largo += n
		textos[normalizar(r.Texto)]++

		if r.Valoracion == 5 && n < 25 {
			a.Autenticidad.CincoCortas++
		}

		if r.Valoracion >= 4 {
			pos = append(pos, r.Texto)
		} else if r.Valoracion <= 2 {
			neg = append(neg, r.Texto)
		}

		// Citas: la reseña con texto más completa de cada extremo.
		if r.Valoracion >= 4 && (mejor < 0 || n > utf8.RuneCountInString(rs[mejor].Texto)) && n <= 600 {
			mejor = i
		}

		if r.Valoracion <= 2 && (peor < 0 || n > utf8.RuneCountInString(rs[peor].Texto)) && n <= 600 {
			peor = i
		}

		// Aspectos por frase; el tono de la frase manda y, si es neutro, la valoración.
		contado := map[string]int{}

		for _, frase := range reFrase.Split(r.Texto, -1) {
			if strings.TrimSpace(frase) == "" {
				continue
			}

			p := polaridad(frase)
			if p == 0 {
				switch {
				case r.Valoracion >= 4:
					p = 1
				case r.Valoracion <= 2:
					p = -1
				}
			}

			for _, d := range aspectos {
				if !d.re.MatchString(frase) {
					continue
				}

				if _, ya := contado[d.clave]; ya {
					continue
				}

				contado[d.clave] = p
				x := asp[d.clave]
				x.Menciones++

				switch p {
				case 1:
					x.Positivas++
					if x.EjemploPos == "" || utf8.RuneCountInString(x.EjemploPos) < 30 {
						x.EjemploPos = recorte(frase, 160)
					}
				case -1:
					x.Negativas++
					if x.EjemploNeg == "" || utf8.RuneCountInString(x.EjemploNeg) < 30 {
						x.EjemploNeg = recorte(frase, 160)
					}
				}
			}
		}
	}

	a.Media = math.Round(float64(suma)/float64(len(rs))*100) / 100
	a.PctRespuesta = math.Round(float64(a.Respondidas)/float64(len(rs))*1000) / 10

	if a.ConTexto > 0 {
		a.LongitudMedia = largo / a.ConTexto
	}

	for _, d := range aspectos {
		if x := asp[d.clave]; x.Menciones > 0 {
			a.Aspectos = append(a.Aspectos, *x)
		}
	}

	sort.SliceStable(a.Aspectos, func(i, j int) bool { return a.Aspectos[i].Menciones > a.Aspectos[j].Menciones })

	a.FrasesPos = frasesFrecuentes(pos, 6)
	a.FrasesNeg = frasesFrecuentes(neg, 6)

	if mejor >= 0 {
		a.CitaMejor = recorte(rs[mejor].Texto, 280)
	}

	if peor >= 0 {
		a.CitaPeor = recorte(rs[peor].Texto, 280)
	}

	// Autenticidad: indicios combinados, nunca una acusación.
	au := &a.Autenticidad
	n := float64(len(rs))
	au.PctSinTexto = math.Round((n-float64(a.ConTexto))/n*1000) / 10
	au.PctCinco = math.Round(float64(a.Distribucion[4])/n*1000) / 10

	for _, c := range textos {
		if c > 1 {
			au.Duplicadas += c - 1
		}
	}

	for m, c := range porMes {
		if pct := math.Round(float64(c)/n*1000) / 10; pct > au.PctMesPico || (pct == au.PctMesPico && m > au.MesPico) {
			au.PctMesPico, au.MesPico = pct, m
		}
	}

	indicios := 0
	if au.PctCinco >= 95 && len(rs) >= 20 {
		indicios++
	}

	if au.Duplicadas >= 2 {
		indicios++
	}

	if float64(au.CincoCortas)/n >= 0.4 {
		indicios++
	}

	if au.PctMesPico >= 50 && len(rs) >= 20 {
		indicios++
	}

	switch {
	case len(rs) < 10:
		au.Nivel = "muestra pequeña"
	case indicios >= 2:
		au.Nivel = "sospechoso"
	case indicios == 1:
		au.Nivel = "revisar"
	default:
		au.Nivel = "natural"
	}

	return a
}
