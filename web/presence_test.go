package web

import (
	"reflect"
	"testing"
)

func TestExtractSocials(t *testing.T) {
	body := `
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Compartir</a>
<a href="https://www.facebook.com/elmonobandido/">Facebook</a>
<a href="https://www.instagram.com/p/Cxyz123/">post</a>
<a href="https://www.instagram.com/matissepeluqueria/">Instagram</a>
<a href="https://www.tiktok.com/@elcielorestaurant?lang=es">TikTok</a>
<a href="https://www.youtube.com/watch?v=abc">vídeo</a>
<a href="https://www.youtube.com/@ElCieloRestaurant">YouTube</a>
<a href="https://co.linkedin.com/company/harry-sasson">LinkedIn</a>
<a href="https://twitter.com/intent/tweet?text=x">tuit</a>
<a href="https://x.com/HarrySasson">X</a>
<a href="https://api.whatsapp.com/send?phone=573001112233&text=Hola">WhatsApp</a>`

	want := map[string]string{
		"facebook":  "https://www.facebook.com/elmonobandido",
		"instagram": "https://www.instagram.com/matissepeluqueria/",
		"tiktok":    "https://www.tiktok.com/@elcielorestaurant",
		"youtube":   "https://www.youtube.com/@ElCieloRestaurant",
		"linkedin":  "https://www.linkedin.com/company/harry-sasson",
		"x":         "https://x.com/HarrySasson",
		"whatsapp":  "https://wa.me/573001112233",
	}

	if got := extractSocials(body); !reflect.DeepEqual(got, want) {
		t.Errorf("extractSocials:\n got %v\nwant %v", got, want)
	}

	if got := extractSocials(`<a href="https://www.facebook.com/sharer.php?u=1">x</a>`); len(got) != 0 {
		t.Errorf("share links must not count as profiles: %v", got)
	}
}

func TestParseCount(t *testing.T) {
	cases := map[string]int64{
		"19 864": 19864, "19.864": 19864, "1,2 mil": 1200, "3,4 M": 3400000, "12K": 12000,
		"513": 513, "2,5 millones": 2500000, "179": 179,
	}

	for in, want := range cases {
		if got := parseCount(in); got != want {
			t.Errorf("parseCount(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestFacebookDescription(t *testing.T) {
	desc := "El Mono Bandido. 19 864 seguidores · 3 personas están hablando de esto · 8040 personas han estado aquí. Chapinero - Cra 4 # 54-85"
	if f := firstCount(reFBFollow, desc); f != 19864 {
		t.Errorf("followers = %d", f)
	}

	if h := firstCount(reFBHere, desc); h != 8040 {
		t.Errorf("check-ins = %d", h)
	}

	if tk := firstCount(reFBTalk, desc); tk != 3 {
		t.Errorf("talking = %d", tk)
	}
}

func TestDetectChats(t *testing.T) {
	low := `<script src="https://code.tidio.co/abc.js"></script><script src="https://www.chatbase.co/embed.min.js"></script><div class="joinchat">`
	got := detectChats(low)
	want := []ChatTool{{"Chatbase", "ia"}, {"Tidio", "chat"}, {"Joinchat (WhatsApp)", "whatsapp"}}

	if !reflect.DeepEqual(got, want) {
		t.Errorf("detectChats = %v, want %v", got, want)
	}
}
