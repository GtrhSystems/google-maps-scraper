package web

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	pngenc "image/png"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestClaveFicha(t *testing.T) {
	l := "https://www.google.com/maps/place/Centro+Dental+Madrid/data=!4m7!3m6!1s0xd4228f349cdfb39:0xe0ae83d9a8824624!8m2!3d40.43!4d-3.69?authuser=0&hl=es"
	if k := claveFicha(l, "Centro Dental Madrid"); k != "0xd4228f349cdfb39:0xe0ae83d9a8824624" {
		t.Errorf("clave = %q", k)
	}

	if k := claveFicha("https://maps.google.com/?cid=123", "Café Niño"); k != "t:cafe nino" {
		t.Errorf("sin ficha: %q", k)
	}
}

func TestLeerResenasSinDuplicados(t *testing.T) {
	// El mismo negocio en dos consultas del trabajo: dos filas con reseñas que se solapan.
	link := "https://www.google.com/maps/place/X/data=!4m7!3m6!1s0xabc:0xdef!8m2"
	fila := func(ids ...string) string {
		var rs []string
		for _, id := range ids {
			rs = append(rs, `{""review_id"":""`+id+`"",""Rating"":1,""Description"":""mal""}`)
		}

		return `"` + link + `",X,"[` + strings.Join(rs, ",") + `]"`
	}
	p := t.TempDir() + "/r.csv"
	if err := os.WriteFile(p, []byte("link,title,user_reviews\n"+fila("a", "b", "c")+"\n"+fila("a", "b")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	m, err := leerResenas(p)
	if err != nil {
		t.Fatal(err)
	}

	if n := len(m["0xabc:0xdef"]); n != 3 {
		t.Errorf("reseñas = %d; quiero 3 (sin contar dos veces las repetidas)", n)
	}
}

func TestAnalizarResenas(t *testing.T) {
	hoy := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	rs := []Resena{
		{Valoracion: 5, Texto: "Trato excelente y muy profesionales. El resultado me encantó, lo recomiendo.", Fecha: "2026-09-01", Respuesta: "¡Gracias!"},
		{Valoracion: 5, Texto: "Muy amables, el trato inmejorable. Precio razonable.", Fecha: "2026-08-10"},
		{Valoracion: 1, Texto: "Esperé más de una hora. No lo recomiendo, además es muy caro.", Fecha: "2026-07-01", Respuesta: "Lamentamos la espera."},
		{Valoracion: 2, Texto: "La atención por teléfono fue pésima, nunca contestan.", Fecha: "2025-01-15"},
		{Valoracion: 4, Fecha: "2026-09-20"},
	}

	a := analizarResenas(rs, hoy)

	if a.Muestra != 5 || a.ConTexto != 4 || a.Media != 3.4 || a.Distribucion != [5]int{1, 1, 0, 1, 2} || a.Respondidas != 2 || a.PctRespuesta != 40 {
		t.Fatalf("resumen: %+v", a)
	}

	if a.MasReciente != "2026-09-20" || a.MasAntigua != "2025-01-15" || a.Ultimos90 != 4 {
		t.Errorf("fechas: %s %s %d", a.MasReciente, a.MasAntigua, a.Ultimos90)
	}

	asp := map[string]Aspecto{}
	for _, x := range a.Aspectos {
		asp[x.Clave] = x
	}

	if x := asp["atencion"]; x.Positivas != 2 || x.Negativas != 1 {
		t.Errorf("atención: %+v", x)
	}

	if x := asp["tiempo"]; x.Negativas != 1 || x.Positivas != 0 {
		t.Errorf("tiempo (espera): %+v", x)
	}

	if x := asp["precio"]; x.Negativas != 1 || x.Positivas != 1 {
		t.Errorf("precio: %+v", x)
	}

	if !strings.Contains(a.CitaPeor, "Esperé") || !strings.Contains(a.CitaMejor, "Trato excelente") {
		t.Errorf("citas: %q / %q", a.CitaMejor, a.CitaPeor)
	}

	if a.Autenticidad.Nivel != "muestra pequeña" {
		t.Errorf("autenticidad con muestra pequeña: %+v", a.Autenticidad)
	}
}

func TestPolaridadNegacion(t *testing.T) {
	casos := map[string]int{
		"no lo recomiendo":                 -1,
		"no es muy bueno":                  -1,
		"lo recomiendo totalmente":         1,
		"I would not recommend this place": -1,
		"great service, best in town":      1,
		"fueron a las 10":                  0,
	}

	for f, want := range casos {
		if got := polaridad(f); got != want {
			t.Errorf("polaridad(%q) = %d; quiero %d", f, got, want)
		}
	}
}

func TestAutenticidadSospechosa(t *testing.T) {
	var rs []Resena
	for i := 0; i < 30; i++ {
		rs = append(rs, Resena{Valoracion: 5, Texto: "Muy bien", Fecha: "2026-05-1" + string(rune('0'+i%9))})
	}

	a := analizarResenas(rs, time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC))
	if a.Autenticidad.Nivel != "sospechoso" || a.Autenticidad.Duplicadas != 29 || a.Autenticidad.PctMesPico != 100 {
		t.Errorf("patrón poco natural no detectado: %+v", a.Autenticidad)
	}
}

func TestExtraerPrecios(t *testing.T) {
	txt := "Tarifas. Limpieza dental 45 € · Blanqueamiento LED: 1.250,00 € · Corte de pelo desde $35 · Consulta USD 60 · Llámanos al 912 345 678 · Año 2024"
	ps := extraerPrecios(txt, 10)

	quiero := map[float64]string{45: "EUR", 1250: "EUR", 35: "USD", 60: "USD"}
	if len(ps) != len(quiero) {
		t.Fatalf("precios: %+v", ps)
	}

	for _, p := range ps {
		if quiero[p.Valor] != p.Moneda || p.Concepto == "" {
			t.Errorf("precio mal leído: %+v", p)
		}
	}

	if ps[0].Concepto != "Limpieza dental" || !strings.Contains(ps[1].Concepto, "Blanqueamiento LED") {
		t.Errorf("conceptos: %q / %q", ps[0].Concepto, ps[1].Concepto)
	}
}

func TestColoresDeMarca(t *testing.T) {
	css := `body{color:#333333;background:#ffffff} .btn{background:#0891a6} a{color:#0891A6} .x{color:#0891a6} h1{color:#e11d48} .y{border-color:#e11d48} .g{color:#f5f5f5} .z{color:#0892a7}`
	cs := coloresDeMarca(css, `#1e3a8a`)

	if len(cs) != 3 || cs[0] != "#1e3a8a" || cs[1] != "#0891a6" || cs[2] != "#e11d48" {
		t.Errorf("colores = %v", cs)
	}
}

func TestPaginasInteresantes(t *testing.T) {
	base, _ := url.Parse("https://clinica.example/")
	portada := `<a href="/blog">Blog</a><a href="/servicios/">Nuestros servicios</a><a href="https://otra.com/precios">Precios</a>
	<a href="/tarifas">Tarifas</a><a href="/foto.jpg">Galería</a><a href="/quienes-somos">Quiénes somos</a><a href="/#top">Arriba</a>`

	ps := paginasInteresantes(base, portada, 6)
	if len(ps) != 3 || ps[0] != "https://clinica.example/servicios/" || ps[1] != "https://clinica.example/tarifas" {
		t.Errorf("páginas = %v", ps)
	}
}

func TestTonoImagen(t *testing.T) {
	png := func(c color.Color) []byte {
		img := image.NewRGBA(image.Rect(0, 0, 40, 20))
		for y := 0; y < 20; y++ {
			for x := 0; x < 40; x++ {
				if x > 5 && x < 35 { // fondo transparente alrededor
					img.Set(x, y, c)
				}
			}
		}

		var b bytes.Buffer
		_ = pngenc.Encode(&b, img)

		return b.Bytes()
	}

	if tn := tonoImagen(png(color.White)); tn != "claro" {
		t.Errorf("logo blanco: %q", tn)
	}

	if tn := tonoImagen(png(color.RGBA{R: 20, G: 40, B: 90, A: 255})); tn != "oscuro" {
		t.Errorf("logo oscuro: %q", tn)
	}

	if tn := tonoImagen([]byte("<svg></svg>")); tn != "" {
		t.Errorf("svg: %q", tn)
	}
}

func TestWebProfundaPlataforma(t *testing.T) {
	w := analizarWebProfunda(context.Background(), "https://www.fresha.com/book-now/cabellos-inc/services")
	if w.Estado != "plataforma" || w.Plataforma != "Fresha" || w.Senales["reserva_online"] == "" || len(w.Marca.Colores) != 0 {
		t.Errorf("Fresha: %+v", w)
	}
}

// El PDF sale del navegador del servidor; si no hay navegador (entorno de pruebas), se omite.
func TestHTMLAPDF(t *testing.T) {
	if navegadorPDF() == "" {
		t.Skip("sin navegador para generar PDF en este entorno")
	}

	pdf, err := htmlAPDF(context.Background(), []byte(`<!doctype html><html><head><title>x</title></head><body><h1>Informe ñ</h1><script>document.body.innerHTML="script ejecutado"</script></body></html>`))
	if err != nil || !bytes.HasPrefix(pdf, []byte("%PDF")) {
		t.Fatalf("pdf: %v (%d bytes)", err, len(pdf))
	}
}

// Enlaces sin protocolo («//instagram.com/…»), habituales en webs hechas con constructores.
func TestExtractSocialsSinProtocolo(t *testing.T) {
	html := `<a class="social-link" href="//instagram.com/molet.extensions.miami/"></a><a href="//www.facebook.com/CabellosMolet"></a><a href="https://www.tiktok.com/@molet">`
	s := extractSocials(html)

	if s["instagram"] != "https://www.instagram.com/molet.extensions.miami/" || s["facebook"] != "https://www.facebook.com/CabellosMolet" || s["tiktok"] != "https://www.tiktok.com/@molet" {
		t.Errorf("redes = %v", s)
	}
}

func TestFragmentoYErrorWeb(t *testing.T) {
	txt := "La atención, el cuidado en los detalles y la experiencia del equipo hacen que siempre vuelva."
	i := strings.Index(txt, "equipo")
	if f := fragmento(txt, i, i+6, 20); f != "…la experiencia del equipo hacen que siempre…" {
		t.Errorf("fragmento = %q", f)
	}

	if e := errorWeb(errors.New(`tls: failed to verify certificate: x509: certificate has expired or is not yet valid`)); !strings.Contains(e, "caducado") {
		t.Errorf("error SSL: %q", e)
	}
}
