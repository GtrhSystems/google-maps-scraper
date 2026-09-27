package web

import (
	"fmt"
	"testing"
	"time"
)

var ahora = time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)

func TestApplySamples(t *testing.T) {
	st := &SocialStats{Followers: 1000}
	applySamples(st, []postSample{
		{At: ahora.Add(-2 * 24 * time.Hour), Likes: 40, Comments: 10},
		{At: ahora.Add(-20 * 24 * time.Hour), Likes: 20, Comments: 0, Views: 500},
		{At: ahora.Add(-60 * 24 * time.Hour), Likes: 30, Comments: 5},
	}, ahora)

	if st.Sample != 3 || st.Recent30 != 2 || st.Recent90 != 3 || st.LastPost != "2026-09-25" {
		t.Fatalf("recuentos: %+v", st)
	}

	// (90 me gusta + 15 comentarios) / 3 / 1000 seguidores = 3,5 %
	if st.AvgLikes != 30 || st.AvgComments != 5 || st.AvgViews != 500 || st.Engagement != 3.5 {
		t.Errorf("medias: likes=%v comentarios=%v vistas=%v engagement=%v", st.AvgLikes, st.AvgComments, st.AvgViews, st.Engagement)
	}

	// 3 publicaciones en 60 días → 1,5 al mes
	if st.PostsMonth != 1.5 {
		t.Errorf("ritmo = %v; quiero 1.5", st.PostsMonth)
	}
}

func TestApplySamplesSinDatos(t *testing.T) {
	st := &SocialStats{Followers: 10}
	applySamples(st, nil, ahora)

	if st.Sample != 0 || st.Engagement != 0 || st.LastPost != "" {
		t.Fatalf("sin muestras no debe inventar datos: %+v", st)
	}
}

func TestParseInstagramProfile(t *testing.T) {
	ts := func(d int) int64 { return ahora.Add(-time.Duration(d) * 24 * time.Hour).Unix() }
	body := fmt.Sprintf(`{"data":{"user":{"full_name":"Peluquería Niña","biography":"Cortes y color ✂️",
	"is_business_account":true,"category_name":"Peluquería","business_email":"hola@nina.es","business_phone_number":"+34600000000",
	"external_url":"https://nina.es","edge_followed_by":{"count":2000},"edge_follow":{"count":150},
	"edge_owner_to_timeline_media":{"count":320,"edges":[
	 {"node":{"taken_at_timestamp":%d,"edge_liked_by":{"count":80},"edge_media_to_comment":{"count":20}}},
	 {"node":{"taken_at_timestamp":%d,"edge_media_preview_like":{"count":40},"edge_media_to_comment":{"count":0},"video_view_count":900}}]}}}}`, ts(1), ts(10))

	st := &SocialStats{}
	if !parseInstagramProfile(body, st, ahora) {
		t.Fatal("no leyó el perfil")
	}

	if st.Name != "Peluquería Niña" || st.Email != "hola@nina.es" || st.Phone != "+34600000000" || st.Website != "https://nina.es" || !st.Business {
		t.Errorf("perfil: %+v", st)
	}

	// (120 me gusta + 20 comentarios) / 2 / 2000 = 3,5 %
	if st.Followers != 2000 || st.Posts != 320 || st.Sample != 2 || st.Engagement != 3.5 || st.AvgViews != 900 || st.Recent30 != 2 {
		t.Errorf("métricas: %+v", st)
	}
}

func TestParseYouTubeFeed(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry><published>2026-09-20T10:00:00+00:00</published><media:group><media:community>
  <media:starRating count="12" average="5.00" min="1" max="5"/><media:statistics views="340"/></media:community></media:group></entry>
 <entry><published>2026-08-01T10:00:00+00:00</published><media:group><media:community>
  <media:starRating count="8" average="5.00" min="1" max="5"/><media:statistics views="160"/></media:community></media:group></entry>
</feed>`

	posts := parseYouTubeFeed(feed)
	if len(posts) != 2 || posts[0].Likes != 12 || posts[0].Views != 340 || posts[1].Views != 160 {
		t.Fatalf("feed: %+v", posts)
	}

	st := &SocialStats{Followers: 100}
	applySamples(st, posts, ahora)

	if st.AvgViews != 250 || st.LastPost != "2026-09-20" {
		t.Errorf("youtube: %+v", st)
	}
}

func TestParseTikTokItems(t *testing.T) {
	body := `"itemList":[{"id":"1","createTime":1790000000,"author":{},"stats":{"diggCount":120,"shareCount":3,"commentCount":7,"playCount":5400}},` +
		`{"id":"2","createTime":"1789000000","stats":{"diggCount":60,"shareCount":1,"commentCount":2,"playCount":2100}}]`

	posts := parseTikTokItems(body)
	if len(posts) != 2 || posts[0].Likes != 120 || posts[0].Comments != 7 || posts[1].Views != 2100 {
		t.Fatalf("tiktok: %+v", posts)
	}
}

// Caso real (Cleardent): los canales recomendados aparecen antes con sus propios
// suscriptores; el del canal está en la cabecera (metadataParts).
func TestYTHeaderIgnoraCanalesRecomendados(t *testing.T) {
	body := `"videoCountText":{"runs":[{"text":"7"},{"text":" vídeos"}]},"subscriberCountText":{"simpleText":"11 suscriptores"},` +
		`{"metadataParts":[{"text":{"content":"@clinicascleardent"}}]},` +
		`{"metadataParts":[{"text":{"content":"5,67 K suscriptores"},"accessibilityLabel":"5,67 mil suscriptores"},{"text":{"content":"440 vídeos"}}]}],"delimiter":"•"`

	head := ytHeader(body)
	if f, p := firstCount(reYTSubs, head), firstCount(reYTVideos, head); f != 5670 || p != 440 {
		t.Fatalf("suscriptores = %d, vídeos = %d; quiero 5670 y 440", f, p)
	}

	if ytHeader(`"subscriberCountText":{"simpleText":"11 suscriptores"}`) != "" {
		t.Fatal("sin cabecera no debe tomar los suscriptores de otro canal")
	}
}

// Caso real (Cleardent): sin vídeos en la página, el createTime del perfil (alta
// de la cuenta) no es una publicación.
func TestParseTikTokIgnoraAltaDeCuenta(t *testing.T) {
	body := `"user":{"createTime":1661847155,"nickname":"Clínicas Cleardent"},"stats":{"followerCount":2368,"heartCount":68000,"videoCount":335,"diggCount":0}`
	if posts := parseTikTokItems(body); len(posts) != 0 {
		t.Fatalf("tomó el alta de la cuenta como publicación: %+v", posts)
	}
}
