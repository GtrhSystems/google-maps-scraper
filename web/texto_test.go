package web

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const frase = "Peluquerías en Chamberí, Logroño y A Coruña: ¿pingüinos? ¡Sí!"

func TestTextoUTF8(t *testing.T) {
	cp1252 := string([]byte{'C', 'h', 'a', 'm', 'b', 'e', 'r', 0xED, ' ', 'e', 0xF1, 'e', ' ', 0xBF, 'q', 'u', 0xE9, '?'})
	nfd := "Chambérí y Año"

	casos := map[string]string{
		frase:  frase,
		cp1252: "Chamberí eñe ¿qué?",
		nfd:    "Chambérí y Año",
	}

	for in, want := range casos {
		if got := textoUTF8(in); got != want {
			t.Errorf("textoUTF8(%q) = %q; quiero %q", in, got, want)
		}
	}
}

func TestNormalizeText(t *testing.T) {
	j := Job{Name: "  Búsquedá ", Data: JobData{Keywords: []string{string([]byte{'N', 'i', 0xF1, 'o', 's'}), " café "}}}
	j.normalizeText()

	if j.Name != "Búsquedá" || j.Data.Keywords[0] != "Niños" || j.Data.Keywords[1] != "café" {
		t.Fatalf("normalizeText: %q %q", j.Name, j.Data.Keywords)
	}
}

func TestUTF8Body(t *testing.T) {
	var recibido string

	h := utf8Body(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		recibido = string(b)
	}))

	for _, body := range []string{
		`{"name":"` + frase + `"}`,
		string([]byte(`{"name":"Chamber`)) + string([]byte{0xED}) + `"}`,
	} {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/jobs", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(httptest.NewRecorder(), r)

		if strings.ContainsRune(recibido, '�') || !strings.Contains(recibido, "í") {
			t.Errorf("cuerpo %q → %q", body, recibido)
		}
	}
}

func TestWithBOM(t *testing.T) {
	const bom = "\xEF\xBB\xBF"

	for _, in := range []string{"título;año\n", bom + "título;año\n", "a", ""} {
		b, _ := io.ReadAll(withBOM(strings.NewReader(in)))
		want := bom + strings.TrimPrefix(in, bom)

		if string(b) != want {
			t.Errorf("withBOM(%q) = %q; quiero %q", in, b, want)
		}
	}
}

func TestRenderJSONCharset(t *testing.T) {
	w := httptest.NewRecorder()
	renderJSON(w, http.StatusOK, map[string]string{"q": frase})

	if ct := w.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}

	if !strings.Contains(w.Body.String(), frase) {
		t.Errorf("cuerpo = %q", w.Body.String())
	}
}
