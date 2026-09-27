package web

import (
	"strings"
	"testing"
	"time"
)

const paginaCompleta = `<!doctype html><html lang="es-ES"><head>
<title>Clínica Dental Chamberí | Dentistas en Madrid</title>
<meta name="description" content="Clínica dental en Chamberí con más de 20 años de experiencia: implantes, ortodoncia invisible y estética dental.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="Clínica Dental Chamberí">
<meta name="generator" content="WordPress 6.6.2">
<link rel="canonical" href="https://clinica.example/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Dentist","name":"Clínica"},{"@type":"WebSite"}]}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9"></script>
<script>gtag('config', 'G-ABC123XYZ9'); gtag('config', 'AW-123456789');</script>
<script>!function(f,b,e,v,n,t,s){}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '1234567890123456');</script>
<script>ttq.load('C4ABCDEFGHIJKLMNOP12');</script>
<script>(function(h,o,t,j,a,r){h._hjSettings={hjid:3456789,hjsv:6};})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');</script>
<script>(function(c,l,a,r,i,t,y){})(window, document, "clarity", "script", "abcd1234ef");</script>
<script src="https://www.clarity.ms/tag/abcd1234ef"></script>
<script id="Cookiebot" src="https://consent.cookiebot.com/uc.js"></script>
<script src="//js.hs-scripts.com/4567890.js"></script>
</head><body><h1>Tu sonrisa</h1><footer>© 2019 - 2026 Clínica Dental Chamberí</footer></body></html>`

func tagPorNombre(tags []Tag, n string) *Tag {
	for i := range tags {
		if tags[i].Name == n {
			return &tags[i]
		}
	}

	return nil
}

func TestDetectTags(t *testing.T) {
	tags := detectTags(paginaCompleta, "", metaIDs(paginaCompleta))

	quiero := map[string]string{
		"Píxel de Meta":      "1234567890123456",
		"Google Ads":         "AW-123456789",
		"Google Analytics 4": "G-ABC123XYZ9",
		"Píxel de TikTok":    "C4ABCDEFGHIJKLMNOP12",
		"Hotjar":             "3456789",
		"Microsoft Clarity":  "abcd1234ef",
		"HubSpot":            "4567890",
		"Cookiebot":          "",
	}

	for n, id := range quiero {
		tg := tagPorNombre(tags, n)
		if tg == nil {
			t.Errorf("no detectó %s", n)

			continue
		}

		if id != "" && (len(tg.IDs) == 0 || tg.IDs[0] != id) {
			t.Errorf("%s: IDs = %v; quiero %s", n, tg.IDs, id)
		}
	}

	for _, n := range []string{"Pinterest Tag", "Universal Analytics", "Salesforce", "Stripe"} {
		if tagPorNombre(tags, n) != nil {
			t.Errorf("falso positivo: %s", n)
		}
	}
}

// El código genérico de cualquier contenedor de GTM menciona AdSense, Floodlight,
// Clarity y WooCommerce aunque la web no los use: no deben darse por instalados.
func TestDetectTagsGTMGenerico(t *testing.T) {
	gtm := `var a="https://pagead2.googlesyndication.com/pagead/";b="https://fls.doubleclick.net/activityi";` +
		`c="https://www.clarity.ms/tag/"+d;e="woocommerce_add_to_cart";f="https://www.googleadservices.com/pagead/conversion"`

	if tags := detectTags("<html></html>", gtm, nil); len(tags) != 0 {
		t.Fatalf("falsos positivos desde GTM: %+v", tags)
	}

	// Con identificador de cuenta o con un marcador propio del proveedor, sí.
	gtm += `;g="AW-987654321";h="https://bat.bing.com/bat.js";i="https://analytics.tiktok.com/i18n/pixel/events.js"`
	tags := detectTags("<html></html>", gtm, nil)

	for _, n := range []string{"Google Ads", "Microsoft Ads (UET)", "Píxel de TikTok"} {
		if tagPorNombre(tags, n) == nil {
			t.Errorf("no detectó %s desde GTM", n)
		}
	}

	if len(tags) != 3 {
		t.Errorf("etiquetas = %+v; quiero solo 3", tags)
	}
}

// Casos reales: plantillas de WordPress que mencionan WooCommerce o un aviso de
// cookies en sus clases CSS sin tener el plugin instalado.
func TestDetectTagsPalabrasDePlantilla(t *testing.T) {
	html := `<body class="woocommerce-page ast-woocommerce-container"><div id="cookie-notice" class="cookie-notice complianz-like onetrust-banner">`
	if tags := detectTags(html, "", nil); len(tags) != 0 {
		t.Fatalf("falsos positivos por clases de la plantilla: %+v", tags)
	}

	html = `<body class="woocommerce-no-js"><script src="/wp-content/plugins/woocommerce/assets/js/frontend/add-to-cart.min.js"></script>` +
		`<link href="/wp-content/plugins/complianz-gdpr/assets/css/cookieblocker.min.css"><script src="/wp-content/plugins/cookie-notice/js/front.min.js"></script>`
	for _, n := range []string{"WooCommerce", "Complianz", "Cookie Notice"} {
		if tagPorNombre(detectTags(html, "", nil), n) == nil {
			t.Errorf("no detectó %s con el plugin instalado", n)
		}
	}
}

func TestAuditPageCompleta(t *testing.T) {
	now := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
	a := auditPage(paginaCompleta, "https://clinica.example/", 600*time.Millisecond, now)

	if !a.HTTPS || !a.Viewport || !a.Canonical || !a.OpenGraph || a.Noindex || a.H1 != 1 {
		t.Fatalf("banderas: %+v", a)
	}

	if a.Title != "Clínica Dental Chamberí | Dentistas en Madrid" || !strings.HasPrefix(a.Description, "Clínica dental en Chamberí") {
		t.Errorf("título/descripcion: %q / %q", a.Title, a.Description)
	}

	if strings.Join(a.Schema, ",") != "Dentist,WebSite" || a.Lang != "es-es" || a.Year != 2026 || a.Generator != "WordPress 6.6.2" {
		t.Errorf("schema=%v lang=%q año=%d generador=%q", a.Schema, a.Lang, a.Year, a.Generator)
	}

	if a.Score != 100 {
		t.Errorf("puntuación = %d; quiero 100", a.Score)
	}
}

func TestAuditPagePobre(t *testing.T) {
	now := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
	body := `<html><head><title>Inicio</title><meta name="robots" content="noindex"></head><body><h1>a</h1><h1>b</h1>© 2017</body></html>`
	a := auditPage(body, "http://pobre.example/", 4*time.Second, now)

	if a.HTTPS || a.Viewport || !a.Noindex || a.H1 != 2 || a.Year != 2017 || len(a.Schema) != 0 {
		t.Fatalf("banderas: %+v", a)
	}

	if a.Score != 0 {
		t.Errorf("puntuación = %d; quiero 0", a.Score)
	}
}
