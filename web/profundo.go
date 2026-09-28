package web

import (
	"bytes"
	"context"
	"encoding/base64"
	"html"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// WebProfunda es lo que revela la web de un negocio más allá de la portada:
// qué servicios y productos ofrece, sus precios, cómo trabaja y su identidad visual.
type WebProfunda struct {
	Estado     string            `json:"estado"`               // ok | plataforma | error
	Plataforma string            `json:"plataforma,omitempty"` // Fresha, Booksy, Instagram…
	Error      string            `json:"error,omitempty"`
	Paginas    []PaginaVista     `json:"paginas,omitempty"`
	Servicios  []string          `json:"servicios,omitempty"`
	Precios    []Precio          `json:"precios,omitempty"`
	Senales    map[string]string `json:"senales,omitempty"` // clave → evidencia
	Marca      Marca             `json:"marca"`
	Palabras   int               `json:"palabras"`
}

type PaginaVista struct {
	URL    string `json:"url"`
	Titulo string `json:"titulo,omitempty"`
}

type Precio struct {
	Valor    float64 `json:"valor"`
	Moneda   string  `json:"moneda"`
	Concepto string  `json:"concepto"`
}

// Marca es la identidad visual detectada en la web (editable en la interfaz).
type Marca struct {
	Colores []string `json:"colores,omitempty"`
	Logo    string   `json:"logo,omitempty"` // data URI para incrustarlo en el informe
	Tono    string   `json:"tono,omitempty"` // claro | oscuro: fondo sobre el que se ve el logotipo
	LogoURL string   `json:"logo_url,omitempty"`
}

// Señales del modelo de trabajo, en español e inglés. La evidencia es el texto encontrado.
var senalesWeb = []struct {
	clave, nombre string
	re            *regexp.Regexp
}{
	{"reserva_online", "Reserva o cita online", regexp.MustCompile(`(?i)(reserva (online|ya|ahora)|reservar (cita|mesa|online)|pide (tu )?cita|pedir cita|cita (online|previa)|book (now|online|an appointment|a table)|schedule (an )?appointment|calendly\.com|booksy\.com|fresha\.com|treatwell\.|doctoralia\.|opentable\.|thefork\.|eltenedor\.|resy\.com|vagaro\.com|acuityscheduling|squareup\.com/appointments|setmore\.com|simplybook|mindbodyonline|zenoti)`)},
	{"whatsapp", "WhatsApp", regexp.MustCompile(`(?i)(wa\.me/|api\.whatsapp\.com|whatsapp)`)},
	{"pago_online", "Pago online", regexp.MustCompile(`(?i)(js\.stripe\.com|paypal|redsys|pago online|paga online|pay online|checkout|pasarela de pago)`)},
	{"tienda_online", "Tienda online", regexp.MustCompile(`(?i)(tienda online|a[ñn]adir al carrito|add to cart|/shop\b|/tienda\b|woocommerce-no-js|cdn\.shopify\.com)`)},
	{"delivery", "Envío o reparto a domicilio", regexp.MustCompile(`(?i)(env[ií]o a domicilio|reparto a domicilio|delivery|pedidos? online|order online|uber ?eats|glovo|just ?eat|rappi|doordash|grubhub)`)},
	{"domicilio", "Servicio a domicilio", regexp.MustCompile(`(?i)(servicio a domicilio|a domicilio|en tu casa|home service|we come to you|mobile service)`)},
	{"financiacion", "Financiación o pago a plazos", regexp.MustCompile(`(?i)(financiaci[oó]n|pago a plazos|sin intereses|c[oó]modas cuotas|financing|payment plans?|klarna|aplazame|sequra|affirm|afterpay|carecredit)`)},
	{"primera_gratis", "Primera visita o diagnóstico gratis", regexp.MustCompile(`(?i)(primera (visita|consulta|clase|sesi[oó]n|revisi[oó]n) (gratis|gratuita)|diagn[oó]stico gratuito|free (consultation|first (visit|class|session))|complimentary consultation)`)},
	{"presupuesto", "Presupuesto sin compromiso", regexp.MustCompile(`(?i)(presupuesto (sin compromiso|gratis|gratuito)|free (quote|estimate))`)},
	{"urgencias", "Urgencias o 24 horas", regexp.MustCompile(`(?i)(urgencias|24 ?h(oras)?\b|24/7|abierto 24|emergenc)`)},
	{"seguros", "Trabaja con seguros o mutuas", regexp.MustCompile(`(?i)(mutuas?\b|aseguradoras?|adeslas|sanitas|dkv|asisa|mapfre salud|insurance accepted|we accept (most )?insurance|in-network|medicare|medicaid)`)},
	{"garantia", "Garantía", regexp.MustCompile(`(?i)(garant[ií]a|guarantee|warranty)`)},
	{"fidelizacion", "Fidelización, club o suscripción", regexp.MustCompile(`(?i)(tarjeta de fidelidad|programa de puntos|club de (clientes|socios)|membres[ií]a|suscripci[oó]n|membership|loyalty|rewards program|subscription)`)},
	{"bonos", "Bonos, packs o paquetes", regexp.MustCompile(`(?i)(\bbonos?\b|\bpacks?\b|paquetes?\b|packages?\b|bundles?\b)`)},
	{"promociones", "Ofertas y promociones", regexp.MustCompile(`(?i)(ofertas?\b|promoci[oó]n|descuento|% ?dto|discount|promo\b|special offer|coupon|cup[oó]n)`)},
	{"regalo", "Tarjetas regalo", regexp.MustCompile(`(?i)(tarjeta regalo|cheque regalo|gift card|gift certificate|vale regalo)`)},
	{"idiomas", "Atención en varios idiomas", regexp.MustCompile(`(?i)(english spoken|se habla (ingl[eé]s|español)|hablamos (ingl[eé]s|español|varios idiomas)|multiling|we speak spanish|bilingual|biling[uü]e)`)},
	{"formacion", "Cursos, talleres o academia", regexp.MustCompile(`(?i)(cursos?\b|talleres?\b|formaci[oó]n|academia|workshops?\b|masterclass|academy)`)},
	{"sostenibilidad", "Sostenibilidad o producto natural", regexp.MustCompile(`(?i)(sostenib|ecol[oó]gic|org[aá]nic|vegan[oa]?\b|cruelty[- ]free|eco[- ]friendly|sustainab|natural products)`)},
	{"testimonios", "Opiniones o testimonios en la web", regexp.MustCompile(`(?i)(testimonios|opiniones de (nuestros )?(clientes|pacientes)|testimonials|what our (clients|customers|patients) say)`)},
	{"equipo", "Presenta a su equipo", regexp.MustCompile(`(?i)(nuestro equipo|conoce al equipo|el equipo\b|our team|meet the team|meet our)`)},
	{"certificaciones", "Certificaciones o colegiación", regexp.MustCompile(`(?i)(certificad[oa]s?|acreditad[oa]|colegiad[oa]|n[ºo]\.? de colegiado|licensed|certified|board[- ]certified|iso ?9001)`)},
	{"blog", "Blog o contenidos", regexp.MustCompile(`(?i)(href="[^"]*/blog|/noticias/|/articulos/)`)},
	{"newsletter", "Newsletter", regexp.MustCompile(`(?i)(newsletter|suscr[ií]bete|subscribe to our)`)},
	{"accesibilidad", "Accesibilidad", regexp.MustCompile(`(?i)(accesible|movilidad reducida|wheelchair|accessib)`)},
}

// NombresSenales, para la interfaz.
func NombresSenales() map[string]string {
	m := map[string]string{}
	for _, s := range senalesWeb {
		m[s.clave] = s.nombre
	}

	return m
}

var (
	reHref      = regexp.MustCompile(`(?is)<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>(.*?)</a>`)
	reQuitar    = regexp.MustCompile(`(?is)<(script|style|noscript|svg|template|iframe)[^>]*>.*?</(script|style|noscript|svg|template|iframe)>`)
	reEtiqueta  = regexp.MustCompile(`(?s)<[^>]+>`)
	reCabecera  = regexp.MustCompile(`(?is)<h([1-3])[^>]*>(.*?)</h[1-3]>`)
	reItem      = regexp.MustCompile(`(?is)<li[^>]*>(.*?)</li>`)
	reEspacios  = regexp.MustCompile(`\s+`)
	reColorHex  = regexp.MustCompile(`#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b`)
	reThemeCol  = regexp.MustCompile(`(?is)<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']`)
	reImgLogo   = regexp.MustCompile(`(?is)<img[^>]+>`)
	reOGImage   = regexp.MustCompile(`(?is)<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']`)
	reHojaCSS   = regexp.MustCompile(`(?is)<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']|<link[^>]+href=["']([^"']+\.css[^"']*)["'][^>]*rel=["']stylesheet["']`)
	reEstiloIn  = regexp.MustCompile(`(?is)<style[^>]*>(.*?)</style>`)
	rePrecio    = regexp.MustCompile(`(?i)(€|\$|US\$|USD|EUR|£|S/\.?|MXN|COP|CLP|ARS)\s?(\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)|(\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)\s?(€|euros?\b|EUR\b|USD\b|d[oó]lares|\$|soles|pesos)`)
	reLogoClaro = regexp.MustCompile(`(?i)(white|blanc|light|negativ|invert|reverse)`)
	reAccion    = regexp.MustCompile(`(?i)(^(reserva|reservar|pide|pedir|solicita|contacta|llama|agenda|compra|descubre|ver|conoce|book|get|call|contact|schedule|buy|shop now|see|learn|discover|start|join|try)\b|→|»|›|>>)`)
	reArchivo   = regexp.MustCompile(`(?i)\.(pdf|jpe?g|png|gif|webp|zip|mp4)$`)
	reCSSAjeno  = regexp.MustCompile(`(?i)(bootstrap|font-?awesome|jquery|elementor/assets/lib|wp-includes|dashicons)`)
	reStyleAttr = regexp.MustCompile(`(?i)style=["']([^"']+)["']`)
	reUtilServ  = regexp.MustCompile(`(?i)(servicio|tratamiento|especialidad|producto|carta|men[uú]|precio|tarifa|catalog|cat[aá]logo|colecci|what we do|services?|treatments?|products?|pricing|prices?|menu|shop|tienda)`)
	reNoServ    = regexp.MustCompile(`(?i)^(inicio|home|contacto|contact|blog|noticias|news|aviso legal|privacidad|privacy|cookies?|t[eé]rminos|terms|leer m[aá]s|ver m[aá]s|read more|learn more|m[aá]s info|saber m[aá]s|reservar?|book( now)?|llamar|call( us)?|s[ií]guenos|follow us|men[uú]|search|buscar|login|mi cuenta|carrito|cart|faq|preguntas frecuentes|ubicaci[oó]n|horarios?|nosotros|about( us)?|qui[eé]nes somos|equipo|team|trabaja con nosotros|careers|mapa del sitio|sitemap|galer[ií]a|gallery|ver todos?|all|español|english|es|en)$`)
)

func textoDe(fragmento string) string {
	t := reEtiqueta.ReplaceAllString(fragmento, " ")

	return strings.TrimSpace(reEspacios.ReplaceAllString(html.UnescapeString(t), " "))
}

// paginasInteresantes elige, de los enlaces de la portada, las páginas internas
// que suelen explicar servicios, precios, forma de trabajar y equipo.
func paginasInteresantes(base *url.URL, portada string, max int) []string {
	claves := []string{"servicio", "tratamiento", "especialidad", "precio", "tarifa", "carta", "menu", "producto", "tienda", "catalogo",
		"services", "treatments", "pricing", "prices", "products", "shop", "nosotros", "quienes", "about", "equipo", "team", "cita", "reserva", "booking", "book"}

	type cand struct {
		u     string
		score int
	}

	var cs []cand

	visto := map[string]bool{base.String(): true}

	for _, m := range reHref.FindAllStringSubmatch(portada, 400) {
		h := strings.TrimSpace(html.UnescapeString(m[1]))

		u, err := base.Parse(h)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || strings.TrimPrefix(u.Hostname(), "www.") != strings.TrimPrefix(base.Hostname(), "www.") {
			continue
		}

		u.Fragment = ""
		if visto[u.String()] || reArchivo.MatchString(u.Path) {
			continue
		}

		visto[u.String()] = true
		texto := strings.ToLower(normalizar(textoDe(m[2]) + " " + u.Path))
		score := 0

		for i, k := range claves {
			if strings.Contains(texto, k) {
				score += 100 - i
			}
		}

		if score > 0 {
			cs = append(cs, cand{u.String(), score})
		}
	}

	sort.SliceStable(cs, func(i, j int) bool { return cs[i].score > cs[j].score })

	out := []string{}
	for _, c := range cs {
		if len(out) >= max {
			break
		}

		out = append(out, c.u)
	}

	return out
}

func valorPrecio(s string) float64 {
	s = strings.TrimSpace(s)
	// «1.250,50» o «1,250.50» → 1250.5; «45,00» → 45
	if i := strings.LastIndexAny(s, ".,"); i >= 0 && len(s)-i-1 <= 2 {
		entero := strings.NewReplacer(".", "", ",", "").Replace(s[:i])
		v, _ := strconv.ParseFloat(entero+"."+s[i+1:], 64)

		return v
	}

	v, _ := strconv.ParseFloat(strings.NewReplacer(".", "", ",", "").Replace(s), 64)

	return v
}

func monedaDe(sim string) string {
	switch strings.ToLower(strings.TrimSpace(sim)) {
	case "€", "eur", "euro", "euros":
		return "EUR"
	case "£":
		return "GBP"
	case "s/", "s/.", "soles":
		return "PEN"
	case "mxn":
		return "MXN"
	case "cop":
		return "COP"
	case "clp":
		return "CLP"
	case "ars":
		return "ARS"
	case "pesos":
		return "MXN/COP/ARS"
	}

	return "USD"
}

// extraerPrecios devuelve importes con su concepto (el texto que los precede).
func extraerPrecios(texto string, max int) []Precio {
	var out []Precio

	visto := map[string]bool{}

	for _, loc := range rePrecio.FindAllStringSubmatchIndex(texto, 200) {
		m := make([]string, len(loc)/2)
		for i := range m {
			if loc[2*i] >= 0 {
				m[i] = texto[loc[2*i]:loc[2*i+1]]
			}
		}

		num, sim := m[2], m[1]
		if num == "" {
			num, sim = m[3], m[4]
		}

		v := valorPrecio(num)
		if v <= 0 || v > 100000 {
			continue
		}

		ini := mayor(loc[0]-70, 0)
		concepto := strings.TrimSpace(texto[ini:loc[0]])

		if i := strings.LastIndexAny(concepto, ".:|•\n"); i >= 0 && len(concepto)-i > 4 {
			concepto = concepto[i+1:]
		}

		// Recorte en frontera de palabra y sin cortar caracteres multibyte.
		for !utf8.ValidString(concepto) && len(concepto) > 0 {
			concepto = concepto[1:]
		}

		if j := strings.IndexByte(concepto, ' '); ini > 0 && j >= 0 && j < 15 {
			concepto = concepto[j+1:]
		}

		concepto = strings.Trim(concepto, " -–:·,(")
		k := concepto + "|" + strconv.FormatFloat(v, 'f', 2, 64)

		if visto[k] || utf8.RuneCountInString(concepto) < 3 {
			continue
		}

		visto[k] = true
		out = append(out, Precio{Valor: math.Round(v*100) / 100, Moneda: monedaDe(sim), Concepto: recorte(concepto, 70)})

		if len(out) >= max {
			break
		}
	}

	return out
}

func mayor(a, b int) int {
	if a > b {
		return a
	}

	return b
}

// coloresDeMarca: los colores más usados en el CSS que no son grises (saturación ≥ 0,25).
func coloresDeMarca(css string, tema string) []string {
	cuenta := map[string]int{}

	for _, m := range reColorHex.FindAllStringSubmatch(css, -1) {
		h := strings.ToLower(m[1])
		if len(h) == 3 {
			h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
		}

		if saturacion(h) >= 0.25 {
			cuenta["#"+h]++
		}
	}

	type kv struct {
		k string
		v int
	}

	var xs []kv
	for k, v := range cuenta {
		xs = append(xs, kv{k, v})
	}

	sort.Slice(xs, func(i, j int) bool {
		if xs[i].v != xs[j].v {
			return xs[i].v > xs[j].v
		}

		return xs[i].k < xs[j].k
	})

	out := []string{}

	if m := reColorHex.FindStringSubmatch(tema); m != nil && len(m[1]) == 6 && saturacion(strings.ToLower(m[1])) >= 0.15 {
		out = append(out, "#"+strings.ToLower(m[1]))
	}

	for _, x := range xs {
		if len(out) >= 3 {
			break
		}

		if x.k != firstOr(out) && !parecido(out, x.k) {
			out = append(out, x.k)
		}
	}

	return out
}

func firstOr(xs []string) string {
	if len(xs) > 0 {
		return xs[0]
	}

	return ""
}

func rgb(h string) (float64, float64, float64) {
	v, _ := strconv.ParseUint(h, 16, 32)

	return float64(v>>16&255) / 255, float64(v>>8&255) / 255, float64(v&255) / 255
}

func saturacion(h string) float64 {
	r, g, b := rgb(h)
	mx, mn := math.Max(r, math.Max(g, b)), math.Min(r, math.Min(g, b))

	if mx == 0 || mx-mn < 0.08 || mx < 0.12 || mn > 0.94 {
		return 0
	}

	return (mx - mn) / mx
}

// parecido evita dos tonos casi iguales en la paleta.
func parecido(ya []string, c string) bool {
	r1, g1, b1 := rgb(strings.TrimPrefix(c, "#"))

	for _, o := range ya {
		r2, g2, b2 := rgb(strings.TrimPrefix(o, "#"))
		if math.Abs(r1-r2)+math.Abs(g1-g2)+math.Abs(b1-b2) < 0.25 {
			return true
		}
	}

	return false
}

func descargar(ctx context.Context, c *http.Client, u string, limite int64) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, "", err
	}

	req.Header.Set("User-Agent", techUA)
	req.Header.Set("Accept-Language", "es-ES,es;q=0.9,en;q=0.8")

	resp, err := c.Do(req)
	if err != nil {
		return nil, "", err
	}

	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		return nil, "", errFetch(resp.StatusCode)
	}

	b, err := io.ReadAll(io.LimitReader(resp.Body, limite))

	return b, resp.Header.Get("Content-Type"), err
}

type errFetch int

func (e errFetch) Error() string { return http.StatusText(int(e)) }

// logoDe busca el logotipo (imagen con «logo» en su src, alt, clase o id; si no,
// la imagen social) y lo incrusta como data URI para el informe.
func logoDe(ctx context.Context, c *http.Client, base *url.URL, portada string) (string, string, string) {
	var cand []string

	for _, img := range reImgLogo.FindAllString(portada, 200) {
		if strings.Contains(strings.ToLower(img), "logo") {
			if at := attrs(img); at["src"] != "" && !strings.HasPrefix(at["src"], "data:") {
				cand = append(cand, at["src"])
			} else if at["data-src"] != "" {
				cand = append(cand, at["data-src"])
			}
		}
	}

	// Prioridad: logotipo normal, logotipo blanco o invertido (se pinta sobre fondo
	// oscuro) y, solo si no hay ninguno, la imagen para redes sociales.
	sort.SliceStable(cand, func(i, j int) bool { return !reLogoClaro.MatchString(cand[i]) && reLogoClaro.MatchString(cand[j]) })

	if m := reOGImage.FindStringSubmatch(portada); m != nil {
		cand = append(cand, m[1])
	}

	for _, s := range cand {
		u, err := base.Parse(html.UnescapeString(s))
		if err != nil {
			continue
		}

		b, tipo, err := descargar(ctx, c, u.String(), 400<<10)
		if err != nil || len(b) == 0 || len(b) >= 400<<10 {
			continue
		}

		if !strings.HasPrefix(tipo, "image/") {
			tipo = http.DetectContentType(b)
			if !strings.HasPrefix(tipo, "image/") {
				if strings.Contains(string(b[:min(len(b), 200)]), "<svg") {
					tipo = "image/svg+xml"
				} else {
					continue
				}
			}
		}

		return "data:" + strings.Split(tipo, ";")[0] + ";base64," + base64.StdEncoding.EncodeToString(b), u.String(), tonoImagen(b)
	}

	return "", "", ""
}

// tonoImagen: «claro» si el logotipo es casi blanco (necesita fondo oscuro), «oscuro»
// si se ve sobre blanco; vacío si no se puede leer (SVG, WebP).
func tonoImagen(b []byte) string {
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return ""
	}

	r := img.Bounds()
	paso := max(1, max(r.Dx(), r.Dy())/120)

	var suma, n float64

	for y := r.Min.Y; y < r.Max.Y; y += paso {
		for x := r.Min.X; x < r.Max.X; x += paso {
			cr, cg, cb, ca := img.At(x, y).RGBA()
			if ca < 0x8000 {
				continue
			}

			suma += (0.2126*float64(cr) + 0.7152*float64(cg) + 0.0722*float64(cb)) / float64(ca)
			n++
		}
	}

	if n == 0 {
		return ""
	}

	if suma/n > 0.82 {
		return "claro"
	}

	return "oscuro"
}

// analizarWebProfunda recorre la portada y hasta seis páginas internas relevantes.
func analizarWebProfunda(ctx context.Context, sitio string) *WebProfunda {
	w := &WebProfunda{Estado: "ok", Senales: map[string]string{}}
	c := &http.Client{Timeout: 15 * time.Second}

	base, err := url.Parse(sitio)
	if err != nil || base.Host == "" {
		return &WebProfunda{Estado: "error", Error: "Dirección no válida"}
	}

	// Si su «web» es su ficha en una plataforma (Fresha, Booksy, TheFork…) o un perfil
	// social, sus colores y textos son los de la plataforma: solo cuenta cómo reserva.
	host := strings.TrimPrefix(strings.ToLower(base.Hostname()), "www.")
	if n, ok := socialHosts[host]; ok {
		return &WebProfunda{Estado: "plataforma", Plataforma: n, Senales: map[string]string{}}
	}

	for suf, n := range thirdPartyHosts {
		if host == suf || strings.HasSuffix(host, "."+suf) {
			return &WebProfunda{Estado: "plataforma", Plataforma: n, Senales: map[string]string{"reserva_online": "Reservas a través de " + n}}
		}
	}

	b, _, err := descargar(ctx, c, sitio, 3<<20)
	if err != nil {
		return &WebProfunda{Estado: "error", Error: errorWeb(err)}
	}

	portada := string(b)
	codigo := portada // HTML de todas las páginas, para las señales
	textoTotal := ""
	css := ""

	paginas := append([]string{sitio}, paginasInteresantes(base, portada, 6)...)
	servicios := map[string]bool{}
	var ordenServ []string

	for i, p := range paginas {
		cuerpo := portada
		if i > 0 {
			bb, _, err := descargar(ctx, c, p, 2<<20)
			if err != nil {
				continue
			}

			cuerpo = string(bb)
			codigo += "\n" + cuerpo
		}

		titulo := ""
		if m := reTitle.FindStringSubmatch(cuerpo); m != nil {
			titulo = textoDe(m[1])
		}

		w.Paginas = append(w.Paginas, PaginaVista{URL: p, Titulo: recorte(titulo, 90)})

		for _, m := range reEstiloIn.FindAllStringSubmatch(cuerpo, 20) {
			css += m[1]
		}

		limpio := reQuitar.ReplaceAllString(cuerpo, " ")
		texto := textoDe(limpio)
		textoTotal += " " + texto

		// Servicios: títulos y elementos de lista de las páginas de servicios/precios.
		esServ := i > 0 && reUtilServ.MatchString(p+" "+titulo)
		if i == 0 || esServ {
			var frag []string

			if esServ {
				// Páginas de servicios o precios: sus títulos y listas.
				for _, m := range reCabecera.FindAllStringSubmatch(limpio, 80) {
					frag = append(frag, textoDe(m[2]))
				}

				for _, m := range reItem.FindAllStringSubmatch(limpio, 150) {
					frag = append(frag, textoDe(m[1]))
				}
			} else {
				// Portada: solo los enlaces que llevan a una página de servicio
				// (los titulares de la portada suelen ser mensajes de marketing).
				for _, m := range reHref.FindAllStringSubmatch(limpio, 400) {
					if reUtilServ.MatchString(m[1]) && !reUtilServ.MatchString(textoDe(m[2])) {
						frag = append(frag, textoDe(m[2]))
					}
				}
			}

			for _, f := range frag {
				n := utf8.RuneCountInString(f)
				if n < 4 || n > 60 || reNoServ.MatchString(strings.TrimSpace(strings.ToLower(f))) || reAccion.MatchString(f) || strings.Count(f, " ") > 7 || rePrecio.MatchString(f) {
					continue
				}

				k := normalizar(f)
				if !servicios[k] {
					servicios[k] = true
					ordenServ = append(ordenServ, f)
				}
			}
		}
	}

	if len(ordenServ) > 40 {
		ordenServ = ordenServ[:40]
	}

	w.Servicios = ordenServ
	w.Precios = extraerPrecios(textoTotal, 30)
	w.Palabras = len(strings.Fields(textoTotal))

	for _, s := range senalesWeb {
		if loc := s.re.FindStringIndex(textoTotal); loc != nil {
			w.Senales[s.clave] = fragmento(textoTotal, loc[0], loc[1], 45)
		} else if loc := s.re.FindStringIndex(codigo); loc != nil {
			w.Senales[s.clave] = "En el código de la web: " + recorte(strings.ToValidUTF8(codigo[loc[0]:min(len(codigo), loc[1]+30)], ""), 80)
		}
	}

	// Identidad visual: color de tema, CSS propio (hasta dos hojas) y logotipo.
	tema := ""
	if m := reThemeCol.FindStringSubmatch(portada); m != nil {
		tema = m[1]
	}

	hojas := 0

	for _, m := range reHojaCSS.FindAllStringSubmatch(portada, 30) {
		h := m[1]
		if h == "" {
			h = m[2]
		}

		u, err := base.Parse(html.UnescapeString(h))
		if err != nil || strings.TrimPrefix(u.Hostname(), "www.") != strings.TrimPrefix(base.Hostname(), "www.") || reCSSAjeno.MatchString(u.Path) {
			continue
		}

		if bb, _, err := descargar(ctx, c, u.String(), 600<<10); err == nil {
			css += string(bb)
			hojas++
		}

		if hojas >= 2 {
			break
		}
	}

	w.Marca.Colores = coloresDeMarca(css+cuerpoEstilos(portada), tema)
	w.Marca.Logo, w.Marca.LogoURL, w.Marca.Tono = logoDe(ctx, c, base, portada)

	return w
}

// cuerpoEstilos: colores de atributos style="" de la portada.
func cuerpoEstilos(h string) string {
	var b strings.Builder

	for _, m := range reStyleAttr.FindAllStringSubmatch(h, 500) {
		b.WriteString(m[1])
		b.WriteByte(';')
	}

	return b.String()
}

// fragmento devuelve el texto alrededor de [a, b) con unas palabras de contexto,
// sin cortar palabras por la mitad.
func fragmento(t string, a, b, margen int) string {
	ini, fin := mayor(a-margen, 0), min(len(t), b+margen)
	if ini > 0 {
		if i := strings.IndexByte(t[ini:a], ' '); i >= 0 {
			ini += i + 1
		}
	}

	if fin < len(t) {
		if i := strings.LastIndexByte(t[b:fin], ' '); i >= 0 {
			fin = b + i
		}
	}

	f := strings.TrimSpace(strings.ToValidUTF8(t[ini:fin], ""))
	if ini > 0 {
		f = "…" + f
	}

	if fin < len(t) {
		f += "…"
	}

	return f
}

// errorWeb explica en lenguaje claro por qué no se pudo leer una web (y, si es
// por su certificado, es en sí un hallazgo: los navegadores muestran un aviso).
func errorWeb(err error) string {
	e := strings.ToLower(err.Error())

	switch {
	case strings.Contains(e, "certificate has expired"):
		return "Certificado de seguridad (SSL) caducado: los navegadores muestran un aviso a quien la visita"
	case strings.Contains(e, "certificate") || strings.Contains(e, "x509") || strings.Contains(e, "tls"):
		return "Certificado de seguridad (SSL) no válido: los navegadores muestran un aviso a quien la visita"
	case strings.Contains(e, "no such host"):
		return "El dominio no existe o no está configurado"
	case strings.Contains(e, "timeout") || strings.Contains(e, "deadline"):
		return "La web no responde (tiempo de espera agotado)"
	case strings.Contains(e, "forbidden") || strings.Contains(e, "too many"):
		return "La web bloquea el análisis automático"
	case strings.Contains(e, "not found"):
		return "La página no existe (error 404)"
	case strings.Contains(e, "refused"):
		return "El servidor de la web rechaza la conexión"
	}

	return "La web no responde"
}
