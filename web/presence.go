package web

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Social profiles linked from a website
// ---------------------------------------------------------------------------

var (
	reFacebook  = regexp.MustCompile(`(?i)(?:https?:)?//(?:www\.|m\.|web\.|es-la\.|es-es\.)?(?:facebook|fb)\.com/((?:profile\.php\?id=\d+)|(?:pages/[^"'\s<>?#]+/\d+)|[A-Za-z0-9.\-_%]{2,80})`)
	reInstagram = regexp.MustCompile(`(?i)(?:https?:)?//(?:www\.)?instagram\.com/([A-Za-z0-9._]{2,30})`)
	reTikTokURL = regexp.MustCompile(`(?i)(?:https?:)?//(?:www\.)?tiktok\.com/@([A-Za-z0-9._]{2,30})`)
	reYouTube   = regexp.MustCompile(`(?i)(?:https?:)?//(?:www\.|m\.)?youtube\.com/((?:@[\w.\-]{2,60})|(?:channel/[\w-]{10,40})|(?:c/[\w.\-]{2,60})|(?:user/[\w.\-]{2,60}))`)
	reLinkedURL = regexp.MustCompile(`(?i)(?:https?:)?//(?:[a-z]{2,3}\.)?linkedin\.com/(company|in|school)/([\w\-%.]{2,100})`)
	reXURL      = regexp.MustCompile(`(?i)(?:https?:)?//(?:www\.)?(?:twitter|x)\.com/([A-Za-z0-9_]{1,15})(?:[/"'?#\s]|$)`)
	reWhatsApp  = regexp.MustCompile(`(?i)(?:wa\.me/|api\.whatsapp\.com/send/?\?(?:[^"'\s]*&)?phone=|web\.whatsapp\.com/send\?phone=)\+?(\d{7,15})`)

	fbReserved = map[string]bool{
		"sharer": true, "sharer.php": true, "share": true, "share.php": true, "plugins": true, "dialog": true, "tr": true,
		"login": true, "login.php": true, "policies": true, "privacy": true, "help": true, "legal": true, "business": true,
		"ads": true, "watch": true, "hashtag": true, "events": true, "photo": true, "photo.php": true, "groups": true,
		"home.php": true, "settings": true, "marketplace": true, "gaming": true, "reel": true, "story.php": true, "l.php": true,
		"permalink.php": true, "2008": true, "people": true, "public": true, "search": true, "fbml": true, "connect": true,
	}
	igReserved = map[string]bool{
		"p": true, "reel": true, "reels": true, "explore": true, "stories": true, "accounts": true, "tv": true, "direct": true,
		"developer": true, "about": true, "legal": true, "web": true, "embed.js": true, "static": true,
	}
	xReserved = map[string]bool{
		"share": true, "intent": true, "home": true, "i": true, "search": true, "hashtag": true, "widgets": true, "privacy": true, "tos": true,
	}
)

// Networks in display order.
var networks = []string{"facebook", "instagram", "tiktok", "youtube", "linkedin", "x", "whatsapp"}

// extractSocials returns the first real profile per network linked from a page.
func extractSocials(body string) map[string]string {
	body = strings.ReplaceAll(body, `\/`, `/`)
	out := map[string]string{}

	first := func(net string, re *regexp.Regexp, ok func(m []string) (string, bool)) {
		for _, m := range re.FindAllStringSubmatch(body, -1) {
			if u, good := ok(m); good {
				out[net] = u

				return
			}
		}
	}

	first("facebook", reFacebook, func(m []string) (string, bool) {
		seg := strings.ToLower(strings.SplitN(m[1], "/", 2)[0])
		if fbReserved[seg] || strings.HasSuffix(seg, ".php") && !strings.HasPrefix(seg, "profile.php") {
			return "", false
		}

		return "https://www.facebook.com/" + strings.TrimSuffix(m[1], "/"), true
	})
	first("instagram", reInstagram, func(m []string) (string, bool) {
		if igReserved[strings.ToLower(m[1])] {
			return "", false
		}

		return "https://www.instagram.com/" + m[1] + "/", true
	})
	first("tiktok", reTikTokURL, func(m []string) (string, bool) {
		return "https://www.tiktok.com/@" + m[1], true
	})
	first("youtube", reYouTube, func(m []string) (string, bool) {
		return "https://www.youtube.com/" + m[1], true
	})
	first("linkedin", reLinkedURL, func(m []string) (string, bool) {
		return "https://www.linkedin.com/" + strings.ToLower(m[1]) + "/" + m[2], true
	})
	first("x", reXURL, func(m []string) (string, bool) {
		if xReserved[strings.ToLower(m[1])] {
			return "", false
		}

		return "https://x.com/" + m[1], true
	})
	first("whatsapp", reWhatsApp, func(m []string) (string, bool) {
		return "https://wa.me/" + m[1], true
	})

	return out
}

// socialFromURL classifies a URL that is itself a social profile (a business
// whose "website" in Google Maps is its Instagram, for example).
func socialFromURL(raw string) map[string]string {
	s := extractSocials(raw + `"`)
	if len(s) == 0 {
		return nil
	}

	return s
}

// ---------------------------------------------------------------------------
// Chat widgets and AI agents on a website
// ---------------------------------------------------------------------------

// ChatTool is a conversation tool found on a website.
type ChatTool struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // ia | chat | whatsapp
}

var chatSignatures = []struct {
	name, kind string
	markers    []string
}{
	// Agentes IA y constructores de chatbots
	{"Chatbase", "ia", []string{"chatbase.co/embed", "www.chatbase.co/"}},
	{"Botpress", "ia", []string{"cdn.botpress.cloud", "mediafiles.botpress.cloud", "botpress.cloud/webchat"}},
	{"Voiceflow", "ia", []string{"cdn.voiceflow.com", "voiceflow.com/widget"}},
	{"Landbot", "ia", []string{"cdn.landbot.io", "static.landbot.io"}},
	{"Dialogflow", "ia", []string{"df-messenger", "gstatic.com/dialogflow-console"}},
	{"Chatling", "ia", []string{"chatling.ai/js"}},
	{"CustomGPT", "ia", []string{"customgpt.ai"}},
	{"Chatfuel", "ia", []string{"chatfuel.com"}},
	{"ManyChat", "ia", []string{"widget.manychat.com", "mccdn.me"}},
	{"Tars", "ia", []string{"hellotars.com"}},
	{"Kommunicate", "ia", []string{"widget.kommunicate.io"}},
	{"Watson Assistant", "ia", []string{"web-chat.global.assistant.watson"}},
	{"Microsoft Copilot Studio", "ia", []string{"botframework-webchat", "cdn.botframework.com"}},
	{"Elfsight AI Chatbot", "ia", []string{"elfsight-app-", "ai-chatbot"}},
	{"GoHighLevel (Conversation AI)", "ia", []string{"widgets.leadconnectorhq.com", "leadconnectorhq.com/loader.js"}},
	{"Yellow.ai", "ia", []string{"cdn.yellowmessenger.com", "yellow.ai"}},
	{"Aivo", "ia", []string{"aivo.co", "agentbot"}},
	{"Treble", "ia", []string{"treble.ai"}},
	// Chat en vivo (varios ofrecen IA opcional: Tidio Lyro, Intercom Fin, Zendesk AI...)
	{"Tidio", "chat", []string{"code.tidio.co"}},
	{"Intercom", "chat", []string{"widget.intercom.io", "js.intercomcdn.com"}},
	{"Drift", "chat", []string{"js.driftt.com"}},
	{"Crisp", "chat", []string{"client.crisp.chat"}},
	{"Tawk.to", "chat", []string{"embed.tawk.to"}},
	{"LiveChat", "chat", []string{"cdn.livechatinc.com"}},
	{"Zendesk Chat", "chat", []string{"static.zdassets.com/ekr/snippet.js", "v2.zopim.com"}},
	{"HubSpot Chat", "chat", []string{"js.usemessages.com"}},
	{"Freshchat", "chat", []string{"wchat.freshchat.com", "freshchat.com/js"}},
	{"JivoChat", "chat", []string{"code.jivosite.com", "code.jivo.ru"}},
	{"Smartsupp", "chat", []string{"smartsuppchat.com"}},
	{"Olark", "chat", []string{"static.olark.com"}},
	{"Chatwoot", "chat", []string{"chatwootsdk", "/packs/js/sdk.js"}},
	{"Zoho SalesIQ", "chat", []string{"salesiq.zoho"}},
	{"Messenger (chat de Facebook)", "chat", []string{"fb-customerchat", "xfbml.customerchat"}},
	{"Respond.io", "chat", []string{"cdn.respond.io"}},
	{"Wati", "chat", []string{"wati-integration", "wati.io"}},
	{"Callbell", "chat", []string{"dash.callbell.eu"}},
	// Botones de WhatsApp
	{"Joinchat (WhatsApp)", "whatsapp", []string{"joinchat"}},
	{"Click to Chat (WhatsApp)", "whatsapp", []string{"ht-ctc", "ht_ctc"}},
	{"GetButton (WhatsApp)", "whatsapp", []string{"getbutton.io"}},
	{"WhatsApp flotante", "whatsapp", []string{"whatsapp-float", "floating-whatsapp", "wa-float", "btn-whatsapp", "whatsapp-button", "boton-whatsapp", "whatsapp_float"}},
}

func detectChats(low string) []ChatTool {
	out := []ChatTool{}
	seen := map[string]bool{}

	for _, s := range chatSignatures {
		for _, m := range s.markers {
			if strings.Contains(low, m) && !seen[s.name] {
				seen[s.name] = true
				out = append(out, ChatTool{Name: s.name, Kind: s.kind})

				break
			}
		}
	}

	return out
}

// ---------------------------------------------------------------------------
// Public data of social profiles (on demand)
// ---------------------------------------------------------------------------

// SocialStats is what a profile shows publicly without logging in.
type SocialStats struct {
	Network   string `json:"network"`
	URL       string `json:"url"`
	Status    string `json:"status"` // ok | limited | error | unsupported
	Message   string `json:"message,omitempty"`
	Name      string `json:"name,omitempty"`
	Followers int64  `json:"followers,omitempty"`
	Following int64  `json:"following,omitempty"`
	Posts     int64  `json:"posts,omitempty"`
	Likes     int64  `json:"likes,omitempty"`
	CheckIns  int64  `json:"checkins,omitempty"`
	Talking   int64  `json:"talking,omitempty"`
	Verified  bool   `json:"verified,omitempty"`
	Business  bool   `json:"business,omitempty"`
	Category  string `json:"category,omitempty"`
	Bio       string `json:"bio,omitempty"`
	LastPost  string `json:"last_post,omitempty"`

	// Actividad e interacción de las últimas publicaciones visibles.
	Sample      int     `json:"sample,omitempty"`       // publicaciones analizadas
	Recent30    int     `json:"recent_30,omitempty"`    // de ellas, en los últimos 30 días
	Recent90    int     `json:"recent_90,omitempty"`    // y en los últimos 90
	PostsMonth  float64 `json:"posts_month,omitempty"`  // ritmo de publicación estimado
	AvgLikes    float64 `json:"avg_likes,omitempty"`    // «me gusta» medios por publicación
	AvgComments float64 `json:"avg_comments,omitempty"` // comentarios medios
	AvgViews    float64 `json:"avg_views,omitempty"`    // reproducciones medias (vídeo)
	Engagement  float64 `json:"engagement,omitempty"`   // (me gusta + comentarios) medios / seguidores, en %

	// Contacto público de las cuentas de empresa.
	Email   string `json:"email,omitempty"`
	Phone   string `json:"phone,omitempty"`
	Website string `json:"website,omitempty"`
}

// SocialScan is the per-job profile lookup, persisted as {id}.social.json.
type SocialScan struct {
	Status  string                  `json:"status"`
	Done    int                     `json:"done"`
	Total   int                     `json:"total"`
	Results map[string]*SocialStats `json:"results"`
}

var (
	socialMu    sync.Mutex
	socialScans = map[string]*SocialScan{}

	reOG       = regexp.MustCompile(`<meta\s+(?:property|name)="og:(title|description)"\s+content="([^"]*)"`)
	reNum      = `(\d[\d\s\x{a0}\x{202f}.,]*\s*(?:mil|k|m|mill\.?|millones)?)`
	reFBFollow = regexp.MustCompile(`(?i)` + reNum + `\s*(?:seguidores|followers)`)
	reFBLikes  = regexp.MustCompile(`(?i)` + reNum + `\s*(?:me gusta|likes)`)
	reFBHere   = regexp.MustCompile(`(?i)` + reNum + `\s*(?:personas han estado aquí|were here)`)
	reFBTalk   = regexp.MustCompile(`(?i)` + reNum + `\s*(?:personas? están? hablando de esto|talking about this)`)
	reYTSubs   = regexp.MustCompile(`(?i)` + reNum + `\s*(?:de\s+)?(?:suscriptores|subscribers)`)
	reYTVideos = regexp.MustCompile(`(?i)"` + reNum + `\s*(?:vídeos|videos)"`)
	reTTJSON   = regexp.MustCompile(`"(followerCount|followingCount|heartCount|videoCount)":(\d+)`)
	reTTName   = regexp.MustCompile(`"nickname":"([^"]{0,120})"`)
	reTTBio    = regexp.MustCompile(`"signature":"([^"]{0,300})"`)
	reTTVer    = regexp.MustCompile(`"verified":(true|false)`)
)

// parseCount understands "19 864", "19.864", "1,2 mil", "3,4 M", "12K".
func parseCount(s string) int64 {
	s = strings.ToLower(strings.TrimSpace(s))
	for _, sp := range []string{" ", " ", " "} {
		s = strings.ReplaceAll(s, sp, "")
	}

	mult := 1.0

	switch {
	case strings.HasSuffix(s, "millones"):
		mult, s = 1e6, strings.TrimSuffix(s, "millones")
	case strings.HasSuffix(s, "mill."):
		mult, s = 1e6, strings.TrimSuffix(s, "mill.")
	case strings.HasSuffix(s, "mil"):
		mult, s = 1e3, strings.TrimSuffix(s, "mil")
	case strings.HasSuffix(s, "k"):
		mult, s = 1e3, strings.TrimSuffix(s, "k")
	case strings.HasSuffix(s, "m"):
		mult, s = 1e6, strings.TrimSuffix(s, "m")
	}

	if mult == 1 {
		s = strings.NewReplacer(".", "", ",", "").Replace(s)
	} else {
		s = strings.ReplaceAll(s, ",", ".")
	}

	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}

	return int64(f*mult + 0.5)
}

func firstCount(re *regexp.Regexp, s string) int64 {
	if m := re.FindStringSubmatch(s); m != nil {
		return parseCount(m[1])
	}

	return 0
}

func getWithUA(ctx context.Context, u, ua string, extra map[string]string) (int, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, "", err
	}

	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept-Language", "es-ES,es;q=0.9")

	for k, v := range extra {
		req.Header.Set(k, v)
	}

	c := &http.Client{Timeout: 20 * time.Second}

	resp, err := c.Do(req)
	if err != nil {
		return 0, "", err
	}

	defer func() {
		_ = resp.Body.Close()
	}()

	b := make([]byte, 0, 1<<20)
	buf := make([]byte, 32<<10)

	for len(b) < 6<<20 {
		n, rerr := resp.Body.Read(buf)
		b = append(b, buf[:n]...)

		if rerr != nil {
			break
		}
	}

	return resp.StatusCode, string(b), nil
}

func fetchFacebook(ctx context.Context, u string) *SocialStats {
	st := &SocialStats{Network: "facebook", URL: u}

	code, body, err := getWithUA(ctx, u, "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", nil)
	if err != nil || code >= 400 {
		st.Status, st.Message = "error", "Facebook no respondió"

		return st
	}

	og := map[string]string{}
	for _, m := range reOG.FindAllStringSubmatch(body, -1) {
		og[m[1]] = html.UnescapeString(m[2])
	}

	desc := og["description"]
	if desc == "" {
		st.Status, st.Message = "limited", "La página no muestra datos públicos sin iniciar sesión"

		return st
	}

	st.Status = "ok"
	st.Name = strings.TrimSpace(strings.SplitN(og["title"], "|", 2)[0])
	st.Followers = firstCount(reFBFollow, desc)
	st.Likes = firstCount(reFBLikes, desc)
	st.CheckIns = firstCount(reFBHere, desc)
	st.Talking = firstCount(reFBTalk, desc)

	// Lo que sigue a los contadores es la descripción de la página.
	if parts := strings.Split(desc, ". "); len(parts) > 1 {
		bio := parts[len(parts)-1]
		if !reFBFollow.MatchString(bio) && !reFBHere.MatchString(bio) {
			st.Bio = bio
		}
	}

	return st
}

func fetchTikTok(ctx context.Context, u string) *SocialStats {
	st := &SocialStats{Network: "tiktok", URL: u}

	code, body, err := getWithUA(ctx, u, techUA, nil)
	if err != nil || code >= 400 {
		st.Status, st.Message = "error", "TikTok no respondió"

		return st
	}

	vals := map[string]int64{}
	for _, m := range reTTJSON.FindAllStringSubmatch(body, -1) {
		if _, ok := vals[m[1]]; !ok {
			vals[m[1]], _ = strconv.ParseInt(m[2], 10, 64)
		}
	}

	if len(vals) == 0 {
		st.Status, st.Message = "limited", "TikTok no mostró los datos (perfil privado o bloqueo temporal)"

		return st
	}

	st.Status = "ok"
	st.Followers, st.Following, st.Likes, st.Posts = vals["followerCount"], vals["followingCount"], vals["heartCount"], vals["videoCount"]

	if m := reTTName.FindStringSubmatch(body); m != nil {
		st.Name = unescapeJSON(m[1])
	}

	if m := reTTBio.FindStringSubmatch(body); m != nil {
		st.Bio = unescapeJSON(m[1])
	}

	if m := reTTVer.FindStringSubmatch(body); m != nil {
		st.Verified = m[1] == "true"
	}

	applySamples(st, parseTikTokItems(body), time.Now())

	return st
}

func unescapeJSON(s string) string {
	var out string
	if json.Unmarshal([]byte(`"`+s+`"`), &out) == nil {
		return out
	}

	return s
}

func fetchYouTube(ctx context.Context, u string) *SocialStats {
	st := &SocialStats{Network: "youtube", URL: u}

	code, body, err := getWithUA(ctx, u, techUA, map[string]string{"Cookie": "CONSENT=YES+1; SOCS=CAI"})
	if err != nil || code >= 400 {
		st.Status, st.Message = "error", "YouTube no respondió"

		return st
	}

	head := ytHeader(body)
	st.Followers = firstCount(reYTSubs, head)
	st.Posts = firstCount(reYTVideos, head)

	for _, m := range reOG.FindAllStringSubmatch(body, -1) {
		if m[1] == "title" {
			st.Name = html.UnescapeString(m[2])
		} else if st.Bio == "" {
			st.Bio = html.UnescapeString(m[2])
		}
	}

	if st.Followers == 0 && st.Name == "" {
		st.Status, st.Message = "limited", "YouTube no mostró los datos del canal"

		return st
	}

	st.Status = "ok"

	applySamples(st, youTubeRecent(ctx, body), time.Now())

	return st
}

// ytHeader devuelve el bloque de la cabecera del canal («5,67 mil suscriptores •
// 440 vídeos»). La página también lista canales recomendados con sus propios
// suscriptores (subscriberCountText), que no deben confundirse con los del canal.
func ytHeader(body string) string {
	rest := body

	for {
		i := strings.Index(rest, `"metadataParts":[`)
		if i < 0 {
			return ""
		}

		rest = rest[i:]

		end := strings.Index(rest, `"delimiter"`)
		if end < 0 || end > 3000 {
			end = min(len(rest), 3000)
		}

		if reYTSubs.MatchString(rest[:end]) {
			return rest[:end]
		}

		rest = rest[len(`"metadataParts":[`):]
	}
}

// instagramLimited is set once Instagram rate-limits this IP, so the rest of a
// scan does not keep knocking (which would extend the block).
func fetchInstagram(ctx context.Context, u string, limited *bool) *SocialStats {
	st := &SocialStats{Network: "instagram", URL: u}
	msg := "Instagram limita las consultas sin iniciar sesión desde esta conexión. Abre el perfil con el enlace."

	if *limited {
		st.Status, st.Message = "limited", msg

		return st
	}

	user := strings.Trim(strings.TrimPrefix(strings.TrimPrefix(u, "https://www.instagram.com/"), "https://instagram.com/"), "/")

	code, body, err := getWithUA(ctx, "https://i.instagram.com/api/v1/users/web_profile_info/?username="+url.QueryEscape(user), techUA,
		map[string]string{"x-ig-app-id": "936619743392459", "Accept": "*/*"})
	if err != nil || code == http.StatusTooManyRequests || code == http.StatusUnauthorized || code == http.StatusForbidden || !strings.HasPrefix(strings.TrimSpace(body), "{") {
		*limited = true
		st.Status, st.Message = "limited", msg

		return st
	}

	if !parseInstagramProfile(body, st, time.Now()) {
		st.Status, st.Message = "error", "El perfil no existe o es privado"
	}

	return st
}

type igCount struct {
	Count int64 `json:"count"`
}

// parseInstagramProfile lee la respuesta de web_profile_info: datos del perfil,
// contacto de empresa y las últimas publicaciones con sus interacciones.
func parseInstagramProfile(body string, st *SocialStats, now time.Time) bool {
	var r struct {
		Data struct {
			User *struct {
				FullName    string  `json:"full_name"`
				Biography   string  `json:"biography"`
				IsVerified  bool    `json:"is_verified"`
				IsBusiness  bool    `json:"is_business_account"`
				Category    string  `json:"category_name"`
				Email       string  `json:"business_email"`
				Phone       string  `json:"business_phone_number"`
				ExternalURL string  `json:"external_url"`
				FollowedBy  igCount `json:"edge_followed_by"`
				Follow      igCount `json:"edge_follow"`
				Media       struct {
					Count int64 `json:"count"`
					Edges []struct {
						Node struct {
							TakenAt  int64   `json:"taken_at_timestamp"`
							Liked    igCount `json:"edge_liked_by"`
							Preview  igCount `json:"edge_media_preview_like"`
							Comments igCount `json:"edge_media_to_comment"`
							Views    int64   `json:"video_view_count"`
						} `json:"node"`
					} `json:"edges"`
				} `json:"edge_owner_to_timeline_media"`
			} `json:"user"`
		} `json:"data"`
	}

	if json.Unmarshal([]byte(body), &r) != nil || r.Data.User == nil {
		return false
	}

	p := r.Data.User
	st.Status = "ok"
	st.Name, st.Bio, st.Verified, st.Business, st.Category = p.FullName, p.Biography, p.IsVerified, p.IsBusiness, p.Category
	st.Followers, st.Following, st.Posts = p.FollowedBy.Count, p.Follow.Count, p.Media.Count
	st.Email, st.Phone, st.Website = p.Email, p.Phone, p.ExternalURL

	var posts []postSample

	for _, e := range p.Media.Edges {
		n := e.Node
		if n.TakenAt == 0 {
			continue
		}

		likes := n.Liked.Count
		if likes == 0 {
			likes = n.Preview.Count
		}

		posts = append(posts, postSample{At: time.Unix(n.TakenAt, 0), Likes: likes, Comments: n.Comments.Count, Views: n.Views})
	}

	applySamples(st, posts, now)

	return true
}

func (s *Service) socialPath(id string) (string, error) {
	p, err := s.csvPath(id)
	if err != nil {
		return "", err
	}

	return strings.TrimSuffix(p, ".csv") + ".social.json", nil
}

// SocialState mirrors TechState for the social lookup.
func (s *Service) SocialState(id string) (*SocialScan, error) {
	socialMu.Lock()
	if sc, ok := socialScans[id]; ok {
		cp := *sc
		cp.Results = make(map[string]*SocialStats, len(sc.Results))

		for k, v := range sc.Results {
			cp.Results[k] = v
		}
		socialMu.Unlock()

		return &cp, nil
	}
	socialMu.Unlock()

	p, err := s.socialPath(id)
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return &SocialScan{Status: "idle", Results: map[string]*SocialStats{}}, nil
		}

		return nil, err
	}

	var sc SocialScan
	if err := json.Unmarshal(data, &sc); err != nil {
		return nil, err
	}

	return &sc, nil
}

// StartSocial looks up every social profile found by the website analysis.
// With retry, only the profiles that gave no data last time are asked again
// and the rest of the previous results are kept.
func (s *Service) StartSocial(id string, retry bool) error {
	tech, err := s.TechState(id)
	if err != nil {
		return err
	}

	if tech.Status != "done" {
		return errors.New("primero hay que terminar de analizar las webs")
	}

	var profiles []string

	for _, t := range tech.Results {
		for _, n := range []string{"facebook", "instagram", "tiktok", "youtube"} {
			if u := t.Socials[n]; u != "" {
				profiles = append(profiles, u)
			}
		}
	}

	profiles = uniq(profiles)

	prev := map[string]*SocialStats{}

	if retry {
		if old, err := s.SocialState(id); err == nil && old.Status == "done" {
			pending := []string{}

			for _, p := range profiles {
				if r := old.Results[p]; r != nil && r.Status == "ok" {
					prev[p] = r
				} else {
					pending = append(pending, p)
				}
			}

			profiles = pending
		}
	}

	socialMu.Lock()
	if sc, ok := socialScans[id]; ok && sc.Status == "running" {
		socialMu.Unlock()

		return nil
	}

	sc := &SocialScan{Status: "running", Total: len(profiles) + len(prev), Done: len(prev), Results: prev}
	socialScans[id] = sc
	socialMu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Minute)
		defer cancel()

		var igMu, fbMu sync.Mutex
		igLimited := false
		sem := make(chan struct{}, 3)
		var wg sync.WaitGroup

		for _, p := range profiles {
			wg.Add(1)
			sem <- struct{}{}

			go func(p string) {
				defer func() { <-sem; wg.Done() }()

				var st *SocialStats

				switch {
				case strings.Contains(p, "facebook.com"):
					// Facebook throttles its preview crawler quickly: one at a time.
					fbMu.Lock()
					st = fetchFacebook(ctx, p)
					time.Sleep(2500 * time.Millisecond)
					fbMu.Unlock()
				case strings.Contains(p, "tiktok.com"):
					st = fetchTikTok(ctx, p)
				case strings.Contains(p, "youtube.com"):
					st = fetchYouTube(ctx, p)
				case strings.Contains(p, "instagram.com"):
					// Instagram, one at a time and spaced out.
					igMu.Lock()
					st = fetchInstagram(ctx, p, &igLimited)
					time.Sleep(1500 * time.Millisecond)
					igMu.Unlock()
				}

				// A short pause per request keeps us under the networks' radar.
				time.Sleep(700 * time.Millisecond)

				socialMu.Lock()
				sc.Results[p] = st
				sc.Done++
				socialMu.Unlock()
			}(p)
		}

		wg.Wait()

		socialMu.Lock()
		sc.Status = "done"
		data, _ := json.Marshal(sc)
		delete(socialScans, id)
		socialMu.Unlock()

		if p, err := s.socialPath(id); err == nil {
			_ = os.WriteFile(p, data, 0o600)
		}
	}()

	return nil
}

func (s *Server) apiSocial(w http.ResponseWriter, r *http.Request) {
	id, ok := getIDFromRequest(r)
	if !ok {
		renderJSON(w, http.StatusUnprocessableEntity, apiError{Code: http.StatusUnprocessableEntity, Message: "Invalid ID"})

		return
	}

	if r.Method == http.MethodPost {
		if err := s.svc.StartSocial(id.String(), r.URL.Query().Get("reintentar") == "1"); err != nil {
			renderJSON(w, http.StatusConflict, apiError{Code: http.StatusConflict, Message: err.Error()})

			return
		}
	}

	sc, err := s.svc.SocialState(id.String())
	if err != nil {
		renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: err.Error()})

		return
	}

	renderJSON(w, http.StatusOK, sc)
}
