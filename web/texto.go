package web

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/unicode/norm"
)

// Garantiza que los textos en español (ñ, tildes, ü, ¿, ¡…) se guarden bien
// aunque el cliente los envíe en la codificación antigua de Windows o con las
// tildes como carácter aparte (NFD, habitual en macOS).

// maxBody limita lo que se lee para revisar la codificación de una petición.
const maxBody = 10 << 20

// textoUTF8 devuelve s en UTF-8 y forma NFC. Si no es UTF-8 válido, se
// interpreta como Windows-1252, que incluye todos los caracteres del español.
func textoUTF8(s string) string {
	if !utf8.ValidString(s) {
		if d, err := charmap.Windows1252.NewDecoder().String(s); err == nil {
			s = d
		}
	}

	return norm.NFC.String(s)
}

// normalizeText deja el nombre y las palabras clave de la búsqueda en UTF-8 NFC.
func (j *Job) normalizeText() {
	j.Name = strings.TrimSpace(textoUTF8(j.Name))

	for i, k := range j.Data.Keywords {
		j.Data.Keywords[i] = strings.TrimSpace(textoUTF8(k))
	}
}

// utf8Body convierte a UTF-8 el cuerpo JSON de las peticiones que llegan en
// Windows-1252: el decodificador JSON sustituiría esos bytes por «�» y el
// texto se perdería. Los formularios se corrigen después, al leer cada campo.
func utf8Body(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body == nil || !strings.Contains(r.Header.Get("Content-Type"), "json") {
			next.ServeHTTP(w, r)

			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
		_ = r.Body.Close()

		if err != nil {
			http.Error(w, "no se pudo leer la petición", http.StatusBadRequest)

			return
		}

		if !utf8.Valid(body) {
			if d, err := charmap.Windows1252.NewDecoder().Bytes(body); err == nil {
				body = d
			}
		}

		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))

		next.ServeHTTP(w, r)
	})
}

// bomUTF8 hace que Excel abra el CSV como UTF-8 (sin él muestra «Ã±» en vez de «ñ»).
var bomUTF8 = []byte{0xEF, 0xBB, 0xBF}

// withBOM antepone el BOM al CSV si el fichero no lo trae ya.
func withBOM(f io.Reader) io.Reader {
	head := make([]byte, len(bomUTF8))
	n, _ := io.ReadFull(f, head)

	if n == len(bomUTF8) && bytes.Equal(head, bomUTF8) {
		return io.MultiReader(bytes.NewReader(head), f)
	}

	return io.MultiReader(bytes.NewReader(bomUTF8), bytes.NewReader(head[:n]), f)
}
