package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Comparador de competencia: análisis profundo de las webs elegidas, voz del
// cliente de sus reseñas (con ampliación opcional) y exportación a PDF.

// EstadoComparador se guarda como {id}.comparador.json.
type EstadoComparador struct {
	Estado      string                  `json:"estado"` // inactivo | analizando | listo
	Hechos      int                     `json:"hechos"`
	Total       int                     `json:"total"`
	Webs        map[string]*WebProfunda `json:"webs"`
	Actualizado string                  `json:"actualizado,omitempty"`
}

var (
	compMu      sync.Mutex
	compEnCurso = map[string]*EstadoComparador{}
)

func (s *Service) compPath(id string) (string, error) {
	p, err := s.csvPath(id)
	if err != nil {
		return "", err
	}

	return strings.TrimSuffix(p, ".csv") + ".comparador.json", nil
}

// EstadoComp devuelve el estado en memoria (si se está analizando) o el guardado.
func (s *Service) EstadoComp(id string) (*EstadoComparador, error) {
	compMu.Lock()
	if e, ok := compEnCurso[id]; ok {
		cp := *e
		cp.Webs = make(map[string]*WebProfunda, len(e.Webs))

		for k, v := range e.Webs {
			cp.Webs[k] = v
		}
		compMu.Unlock()

		return &cp, nil
	}
	compMu.Unlock()

	p, err := s.compPath(id)
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return &EstadoComparador{Estado: "inactivo", Webs: map[string]*WebProfunda{}}, nil
	}

	if err != nil {
		return nil, err
	}

	var e EstadoComparador
	if err := json.Unmarshal(data, &e); err != nil {
		return nil, err
	}

	if e.Webs == nil {
		e.Webs = map[string]*WebProfunda{}
	}

	return &e, nil
}

func (s *Service) guardarComp(id string, e *EstadoComparador) {
	data, _ := json.Marshal(e)
	if p, err := s.compPath(id); err == nil {
		_ = os.WriteFile(p, data, 0o600)
	}
}

// IniciarComp analiza en segundo plano las webs que aún no estén analizadas (o
// todas si forzar).
func (s *Service) IniciarComp(id string, webs []string, forzar bool) (*EstadoComparador, error) {
	e, err := s.EstadoComp(id)
	if err != nil {
		return nil, err
	}

	pendientes := []string{}

	for _, w := range uniq(webs) {
		if prev, ok := e.Webs[w]; forzar || !ok || prev.Estado != "ok" {
			pendientes = append(pendientes, w)
		}
	}

	compMu.Lock()
	if _, ok := compEnCurso[id]; ok || len(pendientes) == 0 {
		compMu.Unlock()

		return s.EstadoComp(id)
	}

	e.Estado, e.Hechos, e.Total = "analizando", 0, len(pendientes)
	compEnCurso[id] = e
	compMu.Unlock()

	go func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		var wg sync.WaitGroup

		sem := make(chan struct{}, 3)

		for _, w := range pendientes {
			wg.Add(1)
			sem <- struct{}{}

			go func(w string) {
				defer func() { <-sem; wg.Done() }()

				r := analizarWebProfunda(c, w)

				compMu.Lock()
				e.Webs[w] = r
				e.Hechos++
				compMu.Unlock()
			}(w)
		}

		wg.Wait()

		compMu.Lock()
		e.Estado, e.Actualizado = "listo", time.Now().UTC().Format(time.RFC3339)
		delete(compEnCurso, id)
		compMu.Unlock()

		s.guardarComp(id, e)
	}()

	return s.EstadoComp(id)
}

// Negocio que se compara: su enlace de Google Maps identifica sus reseñas.
type NegocioComp struct {
	Link   string `json:"link"`
	Titulo string `json:"titulo"`
}

type RespuestaComp struct {
	*EstadoComparador
	Resenas map[string]AnalisisResenas `json:"resenas"`
	Senales map[string]string          `json:"senales"`
}

// DatosComp reúne las webs analizadas y la voz del cliente de cada negocio, con
// las reseñas de la búsqueda más las ampliadas cuando ya están.
func (s *Service) DatosComp(ctx context.Context, id string, negocios []NegocioComp) (*RespuestaComp, error) {
	e, err := s.EstadoComp(id)
	if err != nil {
		return nil, err
	}

	res := &RespuestaComp{EstadoComparador: e, Resenas: map[string]AnalisisResenas{}, Senales: NombresSenales()}

	porFicha := map[string][]Resena{}

	cargar := func(jobID string) {
		p, err := s.csvPath(jobID)
		if err != nil {
			return
		}

		rs, err := leerResenas(p)
		if err != nil {
			return
		}

		for k, v := range rs {
			visto := map[string]bool{}
			for _, r := range porFicha[k] {
				visto[r.ID+"|"+r.Texto] = true
			}

			for _, r := range v {
				if !visto[r.ID+"|"+r.Texto] {
					porFicha[k] = append(porFicha[k], r)
				}
			}
		}
	}

	cargar(id)

	hoy := time.Now().UTC()

	for _, n := range negocios {
		res.Resenas[n.Link] = analizarResenas(porFicha[claveFicha(n.Link, n.Titulo)], hoy)
	}

	return res, nil
}

// ---------------------------------------------------------------------------
// PDF con el navegador del propio servidor (sin JavaScript y sin red)
// ---------------------------------------------------------------------------

func navegadorPDF() string {
	var patrones []string

	for _, base := range []string{os.Getenv("PLAYWRIGHT_BROWSERS_PATH"), "/opt/browsers", filepath.Join(os.Getenv("HOME"), ".cache", "ms-playwright")} {
		if base == "" {
			continue
		}

		patrones = append(patrones,
			filepath.Join(base, "chromium_headless_shell-*", "chrome-headless-shell-linux64", "chrome-headless-shell"),
			filepath.Join(base, "chromium-*", "chrome-linux*", "chrome"))
	}

	for _, p := range patrones {
		if m, _ := filepath.Glob(p); len(m) > 0 {
			return m[len(m)-1]
		}
	}

	return ""
}

// htmlAPDF imprime el HTML a PDF. El informe es autocontenido (estilos e
// imágenes incrustados): se bloquea toda la red y se desactiva JavaScript.
func htmlAPDF(ctx context.Context, doc []byte) ([]byte, error) {
	nav := navegadorPDF()
	if nav == "" {
		return nil, errors.New("no hay navegador disponible para generar el PDF")
	}

	dir, err := os.MkdirTemp("", "informe-*")
	if err != nil {
		return nil, err
	}

	defer func() { _ = os.RemoveAll(dir) }()

	// Política de seguridad por delante de todo: sin scripts, sin conexiones y solo
	// imágenes y fuentes incrustadas. (Desactivar JavaScript por parámetro impide
	// al navegador imprimir, así que se bloquea con CSP y con la red cortada.)
	const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`
	if i := strings.Index(strings.ToLower(string(doc)), "<head>"); i >= 0 {
		doc = []byte(string(doc[:i+6]) + csp + string(doc[i+6:]))
	} else {
		doc = append([]byte(csp), doc...)
	}

	entrada, salida := filepath.Join(dir, "informe.html"), filepath.Join(dir, "informe.pdf")
	if err := os.WriteFile(entrada, doc, 0o600); err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, nav, "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
		"--no-pdf-header-footer", "--print-to-pdf-no-header", "--print-to-pdf="+salida,
		"--host-resolver-rules=MAP * ~NOTFOUND",
		"--run-all-compositor-stages-before-draw", "--virtual-time-budget=3000", "--user-data-dir="+filepath.Join(dir, "perfil"),
		"file://"+entrada)

	if out, err := cmd.CombinedOutput(); err != nil {
		if _, e2 := os.Stat(salida); e2 != nil {
			return nil, fmt.Errorf("el navegador no pudo generar el PDF: %v %s", err, recorte(string(out), 300))
		}
	}

	return os.ReadFile(salida)
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

func (s *Server) apiComparadorIniciar(w http.ResponseWriter, r *http.Request) {
	id, ok := getIDFromRequest(r)
	if !ok {
		renderJSON(w, http.StatusUnprocessableEntity, apiError{Code: http.StatusUnprocessableEntity, Message: "Invalid ID"})

		return
	}

	var req struct {
		Webs   []string `json:"webs"`
		Forzar bool     `json:"forzar"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Webs) > 5 {
		renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "petición no válida (máximo 5 negocios)"})

		return
	}

	for _, u := range req.Webs {
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "dirección no válida: " + u})

			return
		}
	}

	e, err := s.svc.IniciarComp(id.String(), req.Webs, req.Forzar)
	if err != nil {
		renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: err.Error()})

		return
	}

	renderJSON(w, http.StatusOK, e)
}

func (s *Server) apiComparadorDatos(w http.ResponseWriter, r *http.Request) {
	id, ok := getIDFromRequest(r)
	if !ok {
		renderJSON(w, http.StatusUnprocessableEntity, apiError{Code: http.StatusUnprocessableEntity, Message: "Invalid ID"})

		return
	}

	var req struct {
		Negocios []NegocioComp `json:"negocios"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Negocios) > 5 {
		renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "petición no válida (máximo 5 negocios)"})

		return
	}

	res, err := s.svc.DatosComp(r.Context(), id.String(), req.Negocios)
	if err != nil {
		renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: err.Error()})

		return
	}

	renderJSON(w, http.StatusOK, res)
}

func (s *Server) apiPDF(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, methodNotAllowedMessage, http.StatusMethodNotAllowed)

		return
	}

	doc, err := io.ReadAll(io.LimitReader(r.Body, 25<<20))
	if err != nil || len(doc) == 0 {
		renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "falta el informe"})

		return
	}

	pdf, err := htmlAPDF(r.Context(), doc)
	if err != nil {
		renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: err.Error()})

		return
	}

	nombre := strings.Map(func(c rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, c) || c < 32 {
			return '-'
		}

		return c
	}, r.URL.Query().Get("nombre"))
	if nombre == "" {
		nombre = "informe"
	}

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.pdf"; filename*=UTF-8''%s.pdf`, "informe", url.PathEscape(nombre)))
	_, _ = w.Write(pdf)
}
