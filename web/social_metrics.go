package web

import (
	"context"
	"encoding/xml"
	"math"
	"regexp"
	"sort"
	"strconv"
	"time"
)

// postSample es una publicación reciente con sus interacciones públicas.
type postSample struct {
	At       time.Time
	Likes    int64
	Comments int64
	Views    int64
}

// applySamples calcula la actividad y la interacción a partir de las últimas
// publicaciones visibles del perfil. Solo usa datos públicos: si la red no los
// muestra, los campos quedan a cero y la interfaz lo indica como «sin datos».
func applySamples(st *SocialStats, posts []postSample, now time.Time) {
	if len(posts) == 0 {
		return
	}

	sort.Slice(posts, func(i, j int) bool { return posts[i].At.After(posts[j].At) })

	st.Sample = len(posts)
	st.LastPost = posts[0].At.UTC().Format("2006-01-02")

	var likes, comments, views int64

	hayVistas := 0

	for _, p := range posts {
		likes += p.Likes
		comments += p.Comments

		if p.Views > 0 {
			views += p.Views
			hayVistas++
		}

		if now.Sub(p.At) <= 30*24*time.Hour {
			st.Recent30++
		}

		if now.Sub(p.At) <= 90*24*time.Hour {
			st.Recent90++
		}
	}

	n := float64(len(posts))
	st.AvgLikes = round1(float64(likes) / n)
	st.AvgComments = round1(float64(comments) / n)

	if hayVistas > 0 {
		st.AvgViews = round1(float64(views) / float64(hayVistas))
	}

	if st.Followers > 0 {
		st.Engagement = round2((float64(likes) + float64(comments)) / n / float64(st.Followers) * 100)
	}

	// Frecuencia: publicaciones de la muestra repartidas entre la más antigua y hoy.
	span := now.Sub(posts[len(posts)-1].At).Hours() / 24
	if span < 1 {
		span = 1
	}

	st.PostsMonth = round1(n / span * 30)
}

func round1(f float64) float64 { return math.Round(f*10) / 10 }
func round2(f float64) float64 { return math.Round(f*100) / 100 }

// ---------------------------------------------------------------------------
// YouTube: el feed público del canal trae los 15 últimos vídeos con visitas y «me gusta».
// ---------------------------------------------------------------------------

var reYTChannelID = regexp.MustCompile(`"(?:externalId|channelId)":"(UC[\w-]{22})"|youtube\.com/channel/(UC[\w-]{22})`)

type ytFeed struct {
	Entries []struct {
		Published string `xml:"published"`
		Group     struct {
			Community struct {
				StarRating struct {
					Count int64 `xml:"count,attr"`
				} `xml:"starRating"`
				Statistics struct {
					Views int64 `xml:"views,attr"`
				} `xml:"statistics"`
			} `xml:"community"`
		} `xml:"group"`
	} `xml:"entry"`
}

func parseYouTubeFeed(body string) []postSample {
	var f ytFeed
	if xml.Unmarshal([]byte(body), &f) != nil {
		return nil
	}

	var out []postSample

	for _, e := range f.Entries {
		at, err := time.Parse(time.RFC3339, e.Published)
		if err != nil {
			continue
		}

		out = append(out, postSample{At: at, Likes: e.Group.Community.StarRating.Count, Views: e.Group.Community.Statistics.Views})
	}

	return out
}

func youTubeRecent(ctx context.Context, page string) []postSample {
	m := reYTChannelID.FindStringSubmatch(page)
	if m == nil {
		return nil
	}

	id := m[1]
	if id == "" {
		id = m[2]
	}

	code, body, err := getWithUA(ctx, "https://www.youtube.com/feeds/videos.xml?channel_id="+id, techUA, nil)
	if err != nil || code >= 400 {
		return nil
	}

	return parseYouTubeFeed(body)
}

// ---------------------------------------------------------------------------
// TikTok: si la página incluye vídeos recientes, trae su fecha y sus contadores.
// ---------------------------------------------------------------------------

var (
	reTTCreate = regexp.MustCompile(`"createTime":"?(\d{10})"?`)
	reTTStats  = regexp.MustCompile(`"stats":\{([^}]*)\}`)
	reTTStat   = regexp.MustCompile(`"(diggCount|commentCount|playCount)":"?(\d+)`)
)

// parseTikTokItems lee cada vídeo del JSON de la página: su fecha y, en el
// mismo elemento (antes del siguiente createTime), su bloque de contadores.
func parseTikTokItems(body string) []postSample {
	var out []postSample

	seen := map[string]bool{}
	locs := reTTCreate.FindAllStringSubmatchIndex(body, 40)

	for i, l := range locs {
		ts := body[l[2]:l[3]]
		if seen[ts] {
			continue
		}

		end := len(body)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}

		sm := reTTStats.FindStringSubmatch(body[l[1]:end])
		if sm == nil {
			continue
		}

		v := map[string]int64{}

		for _, m := range reTTStat.FindAllStringSubmatch(sm[1], -1) {
			v[m[1]], _ = strconv.ParseInt(m[2], 10, 64)
		}

		// El perfil también tiene createTime (alta de la cuenta) y un bloque stats,
		// pero sin reproducciones: solo los vídeos traen playCount.
		if _, ok := v["playCount"]; !ok {
			continue
		}

		seen[ts] = true

		sec, _ := strconv.ParseInt(ts, 10, 64)
		out = append(out, postSample{At: time.Unix(sec, 0), Likes: v["diggCount"], Comments: v["commentCount"], Views: v["playCount"]})
	}

	return out
}
