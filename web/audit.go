package web

import (
	"encoding/json"
	"html"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Tag es una etiqueta de marketing o medición instalada en la web, con los
// identificadores de cuenta que se ven en el código (píxel, medición, contenedor…).
type Tag struct {
	Name string   `json:"name"`
	Cat  string   `json:"cat"` // publicidad | analitica | comportamiento | contenedor | crm | consentimiento | pagos
	IDs  []string `json:"ids,omitempty"`
}

// WebAudit resume la salud técnica y SEO de la página principal.
type WebAudit struct {
	HTTPS       bool     `json:"https"`
	ResponseMS  int      `json:"response_ms"`
	SizeKB      int      `json:"size_kb"`
	Title       string   `json:"title,omitempty"`
	Description string   `json:"description,omitempty"`
	H1          int      `json:"h1"`
	Canonical   bool     `json:"canonical"`
	OpenGraph   bool     `json:"open_graph"`
	Viewport    bool     `json:"viewport"`
	Noindex     bool     `json:"noindex"`
	Schema      []string `json:"schema,omitempty"`
	Lang        string   `json:"lang,omitempty"`
	Year        int      `json:"year,omitempty"` // año más reciente del pie (©): lo actualizada que está la web
	Generator   string   `json:"generator,omitempty"`
	Score       int      `json:"score"`
}

type tagRule struct {
	name, cat string
	gtm       bool // su marcador es fiable dentro de un contenedor de GTM (no está en su código genérico)
	detect    *regexp.Regexp
	id        *regexp.Regexp // primer grupo = identificador; nil si la etiqueta no expone uno
}

var tagRules = []tagRule{
	{"Píxel de Meta", "publicidad", true, reMetaScript, nil}, // sus IDs salen de metaIDs
	{"Google Ads", "publicidad", false, regexp.MustCompile(`AW-\d{6,12}|googleadservices\.com/pagead/conversion`), regexp.MustCompile(`(AW-\d{6,12})`)},
	{"Floodlight (Campaign Manager)", "publicidad", false, regexp.MustCompile(`DC-\d{6,10}|fls\.doubleclick\.net`), regexp.MustCompile(`(DC-\d{6,10})`)},
	{"Google AdSense", "publicidad", false, regexp.MustCompile(`pagead2\.googlesyndication\.com|ca-pub-\d{10,20}`), regexp.MustCompile(`(ca-pub-\d{10,20})`)},
	{"Píxel de TikTok", "publicidad", true, reTikTok, regexp.MustCompile(`ttq\.load\(\s*['"]([A-Z0-9]{15,25})`)},
	{"LinkedIn Insight", "publicidad", true, reLinkedIn, regexp.MustCompile(`_linkedin_partner_id\s*=\s*['"]?(\d{4,10})`)},
	{"Pinterest Tag", "publicidad", true, regexp.MustCompile(`s\.pinimg\.com/ct/core\.js|pintrk\(`), regexp.MustCompile(`pintrk\(\s*['"]load['"]\s*,\s*['"](\d{10,16})`)},
	{"Píxel de Snapchat", "publicidad", true, regexp.MustCompile(`sc-static\.net/scevent\.min\.js|snaptr\(`), regexp.MustCompile(`snaptr\(\s*['"]init['"]\s*,\s*['"]([0-9a-f-]{36})`)},
	{"Píxel de X (Twitter)", "publicidad", true, regexp.MustCompile(`static\.ads-twitter\.com/uwt\.js|twq\(`), regexp.MustCompile(`twq\(\s*['"](?:config|init)['"]\s*,\s*['"]([a-z0-9]{5,10})`)},
	{"Microsoft Ads (UET)", "publicidad", true, regexp.MustCompile(`bat\.bing\.com/bat\.js`), regexp.MustCompile(`ti\s*:\s*['"]?(\d{6,10})`)},
	{"Criteo", "publicidad", true, regexp.MustCompile(`static\.criteo\.net|dynamic\.criteo\.com`), nil},
	{"Taboola", "publicidad", true, regexp.MustCompile(`cdn\.taboola\.com`), nil},
	{"Outbrain", "publicidad", true, regexp.MustCompile(`amplify\.outbrain\.com|widgets\.outbrain\.com`), nil},
	{"Google Analytics 4", "analitica", false, regexp.MustCompile(`gtag/js\?id=G-|['"]G-[A-Z0-9]{6,12}['"]`), regexp.MustCompile(`\b(G-[A-Z0-9]{6,12})\b`)},
	{"Universal Analytics", "analitica", false, regexp.MustCompile(`UA-\d{4,10}-\d{1,3}|google-analytics\.com/(?:analytics|ga)\.js`), regexp.MustCompile(`(UA-\d{4,10}-\d{1,3})`)},
	{"Yandex Metrica", "analitica", true, regexp.MustCompile(`mc\.yandex\.ru/metrika`), regexp.MustCompile(`ym\(\s*(\d{6,10})`)},
	{"Matomo", "analitica", true, regexp.MustCompile(`matomo\.js|piwik\.js|_paq\.push`), regexp.MustCompile(`setSiteId['"]\s*,\s*['"]?(\d{1,6})`)},
	{"Plausible", "analitica", true, regexp.MustCompile(`plausible\.io/js`), nil},
	{"Segment", "analitica", true, regexp.MustCompile(`cdn\.segment\.com/analytics\.js`), nil},
	{"Mixpanel", "analitica", true, regexp.MustCompile(`cdn\.mxpnl\.com|mixpanel\.init`), nil},
	{"Amplitude", "analitica", true, regexp.MustCompile(`cdn\.amplitude\.com|amplitude\.getInstance`), nil},
	{"Hotjar", "comportamiento", true, regexp.MustCompile(`static\.hotjar\.com|hjid\s*:`), regexp.MustCompile(`hjid\s*:\s*(\d{5,10})`)},
	{"Microsoft Clarity", "comportamiento", false, regexp.MustCompile(`clarity\.ms/tag`), regexp.MustCompile(`clarity\.ms/tag/['"]?\s*\+?\s*['"]?([a-z0-9]{8,12})|\(window,\s*document,\s*['"]clarity['"],\s*['"]script['"],\s*['"]([a-z0-9]{8,12})`)},
	{"Google Tag Manager", "contenedor", true, reGTM, regexp.MustCompile(`(GTM-[A-Z0-9]{4,10})`)},
	{"HubSpot", "crm", false, regexp.MustCompile(`js\.hs-scripts\.com|js\.hsforms\.net`), regexp.MustCompile(`js\.hs-scripts\.com/(\d{5,10})\.js`)},
	{"Mailchimp", "crm", false, regexp.MustCompile(`chimpstatic\.com|list-manage\.com`), nil},
	{"Klaviyo", "crm", true, regexp.MustCompile(`static\.klaviyo\.com`), regexp.MustCompile(`company_id=([A-Za-z0-9]{6})`)},
	{"ActiveCampaign", "crm", false, regexp.MustCompile(`trackcmp\.net|activehosted\.com`), nil},
	{"Brevo (Sendinblue)", "crm", false, regexp.MustCompile(`sibautomation\.com|sendinblue\.com|brevo\.com/js`), nil},
	{"Salesforce", "crm", false, regexp.MustCompile(`pardot\.com/pd\.js|\.my\.salesforce\.com|salesforceliveagent\.com`), nil},
	{"Cookiebot", "consentimiento", false, regexp.MustCompile(`consent\.cookiebot\.com`), nil},
	// Plugins de WordPress: se exige su ruta o su script, no una palabra suelta
	// (las plantillas mencionan «woocommerce» o «cookie-notice» en sus estilos
	// aunque el plugin no esté instalado).
	{"OneTrust", "consentimiento", false, regexp.MustCompile(`cdn\.cookielaw\.org|otSDKStub`), nil},
	{"CookieYes", "consentimiento", false, regexp.MustCompile(`cdn-cookieyes\.com|/plugins/cookie-law-info/`), nil},
	{"Complianz", "consentimiento", false, regexp.MustCompile(`/plugins/complianz|cmplz_(?:banner|cookie|categories)`), nil},
	{"iubenda", "consentimiento", false, regexp.MustCompile(`cdn\.iubenda\.com`), nil},
	{"Cookie Notice", "consentimiento", false, regexp.MustCompile(`/plugins/cookie-notice/`), nil},
	{"Borlabs Cookie", "consentimiento", false, regexp.MustCompile(`/plugins/borlabs-cookie/`), nil},
	{"WooCommerce", "pagos", false, regexp.MustCompile(`/plugins/woocommerce/|woocommerce-no-js|wc_add_to_cart_params|woocommerce_params`), nil},
	{"Stripe", "pagos", false, regexp.MustCompile(`js\.stripe\.com`), nil},
	{"PayPal", "pagos", false, regexp.MustCompile(`paypal\.com/sdk/js|paypalobjects\.com`), nil},
	{"Redsys", "pagos", false, regexp.MustCompile(`redsys\.es`), nil},
}

// detectTags busca las etiquetas conocidas en el HTML de la web y en el código
// de sus contenedores de Tag Manager. Ese código incluye referencias genéricas
// (AdSense, Floodlight, Clarity, WooCommerce…) tanto si se usan como si no, así
// que ahí solo cuenta una etiqueta si aparece su identificador de cuenta o si
// su marcador no forma parte de la librería genérica de GTM (tagRule.gtm).
func detectTags(html, gtm string, metaPixelIDs []string) []Tag {
	var out []Tag

	for _, r := range tagRules {
		enHTML := r.detect.MatchString(html)
		enGTM := r.detect.MatchString(gtm)

		if !enHTML && !enGTM {
			continue
		}

		t := Tag{Name: r.name, Cat: r.cat}

		if r.name == "Píxel de Meta" {
			t.IDs = metaPixelIDs
		} else if r.id != nil {
			t.IDs = uniq(append(firstGroups(r.id, html), firstGroups(r.id, gtm)...))
		}

		if !enHTML && !r.gtm && len(t.IDs) == 0 {
			continue
		}

		out = append(out, t)
	}

	return out
}

// firstGroups devuelve, de cada coincidencia, el primer grupo no vacío.
func firstGroups(re *regexp.Regexp, s string) []string {
	var ids []string

	for _, m := range re.FindAllStringSubmatch(s, 20) {
		for _, g := range m[1:] {
			if g != "" {
				ids = append(ids, g)

				break
			}
		}
	}

	return ids
}

var (
	reTitle     = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	reMetaTag   = regexp.MustCompile(`(?is)<meta\s[^>]*>`)
	reAttr      = regexp.MustCompile(`(?is)([a-z:-]+)\s*=\s*("([^"]*)"|'([^']*)')`)
	reH1        = regexp.MustCompile(`(?i)<h1[\s>]`)
	reCanonical = regexp.MustCompile(`(?i)<link[^>]+rel=["']canonical["']`)
	reHTMLLang  = regexp.MustCompile(`(?i)<html[^>]*\slang=["']?([a-zA-Z-]{2,10})`)
	reLDJSON    = regexp.MustCompile(`(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>`)
	reCopyYear  = regexp.MustCompile(`(?i)(?:©|&copy;|&#169;|copyright)[^<]{0,40}?((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?`)
)

func attrs(tag string) map[string]string {
	m := map[string]string{}

	for _, a := range reAttr.FindAllStringSubmatch(tag, -1) {
		v := a[3]
		if a[4] != "" {
			v = a[4]
		}

		m[strings.ToLower(a[1])] = html.UnescapeString(v)
	}

	return m
}

// schemaTypes recoge los @type de los bloques JSON-LD (LocalBusiness, Restaurant…).
func schemaTypes(body string) []string {
	var types []string

	var walk func(v any)

	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			switch t := x["@type"].(type) {
			case string:
				types = append(types, t)
			case []any:
				for _, s := range t {
					if s, ok := s.(string); ok {
						types = append(types, s)
					}
				}
			}

			for _, k := range []string{"@graph", "mainEntity", "itemListElement"} {
				if c, ok := x[k]; ok {
					walk(c)
				}
			}
		case []any:
			for _, c := range x {
				walk(c)
			}
		}
	}

	for _, m := range reLDJSON.FindAllStringSubmatch(body, 10) {
		var v any
		if json.Unmarshal([]byte(strings.TrimSpace(m[1])), &v) == nil {
			walk(v)
		}
	}

	sort.Strings(types)

	return uniq(types)
}

// auditPage analiza el HTML de la página principal.
func auditPage(body, finalURL string, elapsed time.Duration, now time.Time) *WebAudit {
	a := &WebAudit{
		HTTPS:      strings.HasPrefix(strings.ToLower(finalURL), "https://"),
		ResponseMS: int(elapsed.Milliseconds()),
		SizeKB:     (len(body) + 1023) / 1024,
		H1:         len(reH1.FindAllStringIndex(body, -1)),
		Canonical:  reCanonical.MatchString(body),
		Schema:     schemaTypes(body),
	}

	if m := reTitle.FindStringSubmatch(body); m != nil {
		a.Title = strings.Join(strings.Fields(html.UnescapeString(m[1])), " ")
	}

	if m := reHTMLLang.FindStringSubmatch(body); m != nil {
		a.Lang = strings.ToLower(m[1])
	}

	for _, t := range reMetaTag.FindAllString(body, 200) {
		at := attrs(t)
		name := strings.ToLower(at["name"] + at["property"])

		switch {
		case name == "description":
			a.Description = strings.Join(strings.Fields(at["content"]), " ")
		case name == "viewport":
			a.Viewport = true
		case name == "robots" && strings.Contains(strings.ToLower(at["content"]), "noindex"):
			a.Noindex = true
		case strings.HasPrefix(name, "og:"):
			a.OpenGraph = true
		case name == "generator" && a.Generator == "":
			a.Generator = at["content"]
		}
	}

	for _, m := range reCopyYear.FindAllStringSubmatch(body, -1) {
		for _, g := range m[1:] {
			if y, err := strconv.Atoi(g); err == nil && y <= now.Year() && y > a.Year {
				a.Year = y
			}
		}
	}

	a.Score = webScore(a, now)

	return a
}

// webScore puntúa de 0 a 100 lo básico que un negocio debería tener en su web.
func webScore(a *WebAudit, now time.Time) int {
	s := 0
	add := func(ok bool, pts int) {
		if ok {
			s += pts
		}
	}

	add(a.HTTPS, 15)
	add(a.Viewport, 15)
	add(a.ResponseMS > 0 && a.ResponseMS < 1500, 10)
	add(a.ResponseMS > 0 && a.ResponseMS < 3000, 5)
	add(len([]rune(a.Title)) >= 10 && len([]rune(a.Title)) <= 70, 10)
	add(len([]rune(a.Description)) >= 50 && len([]rune(a.Description)) <= 170, 10)
	add(a.H1 == 1, 5)
	add(a.Canonical, 5)
	add(a.OpenGraph, 5)
	add(len(a.Schema) > 0, 10)
	add(!a.Noindex, 5)
	add(a.Year >= now.Year()-1, 5)

	return s
}
