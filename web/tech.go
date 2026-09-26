package web

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Tech is what a business's website reveals about its marketing: the ad and
// analytics tags it carries and the platform it is built on.
type Tech struct {
	Status      string   `json:"status"` // ok | social | error
	Error       string   `json:"error,omitempty"`
	FinalURL    string   `json:"final_url,omitempty"`
	MetaPixel   bool     `json:"meta_pixel"`
	MetaIDs     []string `json:"meta_ids,omitempty"`
	MetaViaGTM  bool     `json:"meta_via_gtm,omitempty"`
	GoogleAds   bool     `json:"google_ads"`
	GoogleAdsID []string `json:"google_ads_ids,omitempty"`
	Analytics   bool     `json:"analytics"`
	TagManager  bool     `json:"tag_manager"`
	TikTok      bool     `json:"tiktok"`
	LinkedIn    bool     `json:"linkedin"`
	Platform    string   `json:"platform,omitempty"`
	Unsure      string   `json:"unsure,omitempty"` // why a missing pixel cannot be confirmed
	Social      string   `json:"social,omitempty"` // the "website" is really a social profile
}

// TechScan is the per-job analysis state, persisted as {id}.tech.json.
type TechScan struct {
	Status  string           `json:"status"` // idle | running | done
	Done    int              `json:"done"`
	Total   int              `json:"total"`
	Results map[string]*Tech `json:"results"`
}

var (
	reMetaScript = regexp.MustCompile(`connect\.facebook\.net/[\w_-]+/fbevents\.js|fbq\(\s*['"]init['"]|facebook\.com/tr\?id=|facebook\.com/tr/\?id=`)
	reMetaID     = regexp.MustCompile(`fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{8,20})|facebook\.com/tr/?\?id=(\d{8,20})|"facebookPixelId"\s*:\s*"(\d{8,20})"`)
	reGTM        = regexp.MustCompile(`GTM-[A-Z0-9]{4,10}`)
	reGA4        = regexp.MustCompile(`googletagmanager\.com/gtag/js\?id=(G|UA)-|gtag\(\s*['"]config['"]\s*,\s*['"](G|UA)-|google-analytics\.com/(analytics|ga)\.js`)
	reAWID       = regexp.MustCompile(`AW-\d{6,12}`)
	// Shopify stores keep the pixel in their web-pixels config (escaped JSON).
	reShopifyMeta = regexp.MustCompile(`pixel_id\\*"\s*:\s*\\*"(\d{8,20})\\*"\s*,\s*\\*"pixel_type\\*"\s*:\s*\\*"facebook_pixel`)
	reTikTok      = regexp.MustCompile(`analytics\.tiktok\.com|ttq\.load\(`)
	reLinkedIn    = regexp.MustCompile(`snap\.licdn\.com|_linkedin_partner_id`)

	platforms = []struct{ name, marker string }{
		{"Shopify", "cdn.shopify.com"},
		{"Wix", "static.wixstatic.com"},
		{"Squarespace", "static1.squarespace.com"},
		{"Webflow", "assets.website-files.com"},
		{"Webflow", "cdn.prod.website-files.com"},
		{"Jimdo", "jimdo"},
		{"PrestaShop", "prestashop"},
		{"WordPress", "/wp-content/"},
		{"WordPress", "/wp-includes/"},
	}

	socialHosts = map[string]string{
		"facebook.com": "Facebook", "m.facebook.com": "Facebook", "fb.com": "Facebook",
		"instagram.com": "Instagram", "wa.me": "WhatsApp", "api.whatsapp.com": "WhatsApp",
		"linktr.ee": "Linktree", "tiktok.com": "TikTok", "twitter.com": "X", "x.com": "X",
	}

	techMu    sync.Mutex
	techScans = map[string]*TechScan{}
)

const techUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

func techClient() *http.Client {
	return &http.Client{Timeout: 15 * time.Second}
}

func fetchBody(ctx context.Context, c *http.Client, u string) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", "", err
	}

	req.Header.Set("User-Agent", techUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
	req.Header.Set("Accept-Language", "es-ES,es;q=0.9")

	resp, err := c.Do(req)
	if err != nil {
		return "", "", err
	}

	defer func() {
		_ = resp.Body.Close()
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", "", err
	}

	if resp.StatusCode >= 400 {
		return string(body), resp.Request.URL.String(), errors.New(http.StatusText(resp.StatusCode))
	}

	return string(body), resp.Request.URL.String(), nil
}

func uniq(in []string) []string {
	seen := map[string]bool{}
	out := []string{}

	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}

	return out
}

func metaIDs(body string) []string {
	ids := []string{}

	for _, m := range reMetaID.FindAllStringSubmatch(body, -1) {
		for _, g := range m[1:] {
			ids = append(ids, g)
		}
	}

	for _, m := range reShopifyMeta.FindAllStringSubmatch(body, -1) {
		ids = append(ids, m[1])
	}

	return uniq(ids)
}

// analyzeSite inspects a website's home page and, when present, its Google
// Tag Manager containers (many sites load the Meta pixel only through GTM).
func analyzeSite(ctx context.Context, raw string) *Tech {
	t := &Tech{Status: "ok"}

	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return &Tech{Status: "error", Error: "Dirección no válida"}
	}

	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")

	// Instagram and Facebook wrap outbound links: analyse the real destination.
	if (host == "l.instagram.com" || host == "l.facebook.com" || host == "lm.facebook.com") && u.Query().Get("u") != "" {
		return analyzeSite(ctx, u.Query().Get("u"))
	}

	if name, ok := socialHosts[host]; ok {
		return &Tech{Status: "social", Social: name}
	}

	c := techClient()

	body, final, err := fetchBody(ctx, c, raw)
	if err != nil && body == "" {
		msg := "No responde"
		if strings.Contains(err.Error(), "certificate") || strings.Contains(err.Error(), "tls") {
			msg = "Certificado no válido"
		} else if strings.Contains(err.Error(), "no such host") {
			msg = "El dominio no existe"
		} else if strings.Contains(err.Error(), "Forbidden") || strings.Contains(err.Error(), "Too Many") {
			msg = "La web bloquea el análisis"
		}

		return &Tech{Status: "error", Error: msg}
	}

	t.FinalURL = final
	if fu, e := url.Parse(final); e == nil {
		if name, ok := socialHosts[strings.TrimPrefix(strings.ToLower(fu.Hostname()), "www.")]; ok {
			return &Tech{Status: "social", Social: name}
		}
	}

	low := strings.ToLower(body)

	t.MetaIDs = metaIDs(body)
	t.MetaPixel = reMetaScript.MatchString(body) || len(t.MetaIDs) > 0
	t.Analytics = reGA4.MatchString(body)
	t.GoogleAdsID = uniq(reAWID.FindAllString(body, -1))
	t.TikTok = reTikTok.MatchString(body)
	t.LinkedIn = reLinkedIn.MatchString(body)

	for _, p := range platforms {
		if strings.Contains(low, p.marker) {
			t.Platform = p.name

			break
		}
	}

	gtms := uniq(reGTM.FindAllString(body, -1))
	t.TagManager = len(gtms) > 0

	for i, id := range gtms {
		if i >= 3 {
			break
		}

		js, _, err := fetchBody(ctx, c, "https://www.googletagmanager.com/gtm.js?id="+id)
		if err != nil {
			continue
		}

		if reMetaScript.MatchString(js) || strings.Contains(js, "fbevents.js") || (strings.Contains(js, "__cvt_") && strings.Contains(js, "facebook")) {
			if !t.MetaPixel {
				t.MetaViaGTM = true
			}

			t.MetaPixel = true
			t.MetaIDs = uniq(append(t.MetaIDs, metaIDs(js)...))
		}

		t.GoogleAdsID = uniq(append(t.GoogleAdsID, reAWID.FindAllString(js, -1)...))
		t.Analytics = t.Analytics || (strings.Contains(js, "G-") && strings.Contains(js, "google-analytics"))
		t.TikTok = t.TikTok || reTikTok.MatchString(js)
		t.LinkedIn = t.LinkedIn || reLinkedIn.MatchString(js)
	}

	t.GoogleAds = len(t.GoogleAdsID) > 0

	// Wix injects marketing tags from the browser, so plain HTML cannot prove
	// their absence.
	if t.Platform == "Wix" && !t.MetaPixel {
		t.Unsure = "Wix carga el píxel desde el navegador: no se puede confirmar que no lo tenga"
	}

	return t
}

func (s *Service) techPath(id string) (string, error) {
	p, err := s.csvPath(id)
	if err != nil {
		return "", err
	}

	return strings.TrimSuffix(p, ".csv") + ".tech.json", nil
}

// TechState returns the analysis for a job: in memory while it runs, from
// disk once done, or idle when never started.
func (s *Service) TechState(id string) (*TechScan, error) {
	techMu.Lock()
	if sc, ok := techScans[id]; ok {
		cp := *sc
		cp.Results = make(map[string]*Tech, len(sc.Results))

		for k, v := range sc.Results {
			cp.Results[k] = v
		}
		techMu.Unlock()

		return &cp, nil
	}
	techMu.Unlock()

	p, err := s.techPath(id)
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return &TechScan{Status: "idle", Results: map[string]*Tech{}}, nil
		}

		return nil, err
	}

	var sc TechScan
	if err := json.Unmarshal(data, &sc); err != nil {
		return nil, err
	}

	return &sc, nil
}

// StartTech analyses every distinct website of a job in the background.
func (s *Service) StartTech(id string) error {
	leads, err := s.GetLeads(id)
	if err != nil {
		return err
	}

	sites := []string{}
	for _, l := range leads {
		if l.Website != "" {
			sites = append(sites, l.Website)
		}
	}

	sites = uniq(sites)

	techMu.Lock()
	if sc, ok := techScans[id]; ok && sc.Status == "running" {
		techMu.Unlock()

		return nil
	}

	sc := &TechScan{Status: "running", Total: len(sites), Results: map[string]*Tech{}}
	techScans[id] = sc
	techMu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		sem := make(chan struct{}, 8)
		var wg sync.WaitGroup

		for _, site := range sites {
			wg.Add(1)
			sem <- struct{}{}

			go func(site string) {
				defer func() { <-sem; wg.Done() }()

				res := analyzeSite(ctx, site)

				techMu.Lock()
				sc.Results[site] = res
				sc.Done++
				techMu.Unlock()
			}(site)
		}

		wg.Wait()

		techMu.Lock()
		sc.Status = "done"
		data, _ := json.Marshal(sc)
		delete(techScans, id)
		techMu.Unlock()

		if p, err := s.techPath(id); err == nil {
			_ = os.MkdirAll(filepath.Dir(p), 0o755)
			_ = os.WriteFile(p, data, 0o600)
		}
	}()

	return nil
}

func (s *Server) apiTech(w http.ResponseWriter, r *http.Request) {
	id, ok := getIDFromRequest(r)
	if !ok {
		renderJSON(w, http.StatusUnprocessableEntity, apiError{Code: http.StatusUnprocessableEntity, Message: "Invalid ID"})

		return
	}

	if r.Method == http.MethodPost {
		if err := s.svc.StartTech(id.String()); err != nil {
			renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: err.Error()})

			return
		}
	}

	sc, err := s.svc.TechState(id.String())
	if err != nil {
		renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: err.Error()})

		return
	}

	renderJSON(w, http.StatusOK, sc)
}
