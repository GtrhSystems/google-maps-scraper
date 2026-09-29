package web

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Lead is one business as the Spanish UI shows it: only the fields useful
// for prospecting, already decoded from the CSV's JSON-encoded columns.
type Lead struct {
	Title        string              `json:"title"`
	Category     string              `json:"category"`
	Address      string              `json:"address"`
	City         string              `json:"city"`
	Borough      string              `json:"borough"`
	Phone        string              `json:"phone"`
	Website      string              `json:"website"`
	Emails       []string            `json:"emails"`
	Rating       float64             `json:"rating"`
	Reviews      int                 `json:"reviews"`
	PriceRange   string              `json:"price_range"`
	Description  string              `json:"description"`
	Hours        map[string][]string `json:"hours"`
	Link         string              `json:"link"`
	Thumbnail    string              `json:"thumbnail"`
	Latitude     float64             `json:"latitude"`
	Longitude    float64             `json:"longitude"`
	Reservations []linkSource        `json:"reservations"`
	OrderOnline  []linkSource        `json:"order_online"`
	Menu         string              `json:"menu"`
	Claimed      bool                `json:"claimed"`
	Grupo        string              `json:"grupo,omitempty"` // consulta que lo encontró (input_id): su competencia directa
}

type linkSource struct {
	Link   string `json:"link"`
	Source string `json:"source"`
}

// GetLeads parses a job's CSV output into leads.
func (s *Service) GetLeads(id string) ([]Lead, error) {
	path, err := s.csvPath(id)
	if err != nil {
		return nil, err
	}

	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrPlacesNotFound
		}

		return nil, err
	}

	defer func() {
		_ = f.Close()
	}()

	return parseLeads(f)
}

func parseLeads(r io.Reader) ([]Lead, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true

	header, err := reader.Read()
	if err != nil {
		if errors.Is(err, io.EOF) {
			return []Lead{}, nil
		}

		return nil, err
	}

	col := make(map[string]int, len(header))
	for i, name := range header {
		col[name] = i
	}

	get := func(row []string, name string) string {
		idx, ok := col[name]
		if !ok || idx >= len(row) {
			return ""
		}

		return strings.TrimSpace(row[idx])
	}

	leads := []Lead{}

	for {
		row, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}

		if err != nil {
			return nil, err
		}

		lead := Lead{
			Title:       get(row, "title"),
			Category:    get(row, "category"),
			Address:     get(row, "address"),
			Phone:       get(row, "phone"),
			Website:     get(row, "website"),
			PriceRange:  get(row, "price_range"),
			Description: get(row, "descriptions"),
			Link:        get(row, "link"),
			Thumbnail:   get(row, "thumbnail"),
			Grupo:       get(row, "input_id"),
		}

		lead.Rating, _ = strconv.ParseFloat(get(row, "review_rating"), 64)
		if !finite(lead.Rating) {
			lead.Rating = 0
		}

		reviews, _ := strconv.ParseFloat(get(row, "review_count"), 64)
		if finite(reviews) {
			lead.Reviews = int(reviews)
		}

		lead.Latitude, _ = strconv.ParseFloat(get(row, "latitude"), 64)
		lead.Longitude, _ = strconv.ParseFloat(get(row, "longitude"), 64)

		for _, e := range strings.Split(get(row, "emails"), ",") {
			if e = strings.TrimSpace(e); validEmail(e) {
				lead.Emails = append(lead.Emails, e)
			}
		}

		var addr struct {
			Borough string `json:"borough"`
			City    string `json:"city"`
		}

		_ = json.Unmarshal([]byte(get(row, "complete_address")), &addr)
		lead.City, lead.Borough = addr.City, addr.Borough

		_ = json.Unmarshal([]byte(get(row, "open_hours")), &lead.Hours)
		_ = json.Unmarshal([]byte(get(row, "reservations")), &lead.Reservations)
		_ = json.Unmarshal([]byte(get(row, "order_online")), &lead.OrderOnline)
		lead.Reservations = cleanLinks(lead.Reservations)
		lead.OrderOnline = cleanLinks(lead.OrderOnline)

		var menu linkSource

		_ = json.Unmarshal([]byte(get(row, "menu")), &menu)
		lead.Menu = menu.Link

		var owner struct {
			ID string `json:"id"`
		}

		_ = json.Unmarshal([]byte(get(row, "owner")), &owner)
		lead.Claimed = owner.ID != ""

		leads = append(leads, lead)
	}

	return leads, nil
}

var (
	reEmail      = regexp.MustCompile(`^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$`)
	reFakeDomain = regexp.MustCompile(`(?i)\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|css|js)$|@\dx\.|sentry|wixpress\.com$|example\.(com|org)$|domain\.com$`)
)

// validEmail rejects what the scraper picks up from image names (logo@2x.png)
// and placeholder or tracking addresses.
func validEmail(e string) bool {
	return reEmail.MatchString(e) && !reFakeDomain.MatchString(e)
}

// cleanLinks drops empty entries and Google's own redirect links, which are
// not usable outside a Maps session.
func cleanLinks(in []linkSource) []linkSource {
	out := []linkSource{}

	for _, l := range in {
		if l.Link == "" || strings.HasPrefix(l.Link, "/url?") {
			continue
		}

		out = append(out, l)
	}

	return out
}

func (s *Server) apiGetLeads(w http.ResponseWriter, r *http.Request) {
	id, ok := getIDFromRequest(r)
	if !ok {
		renderJSON(w, http.StatusUnprocessableEntity, apiError{Code: http.StatusUnprocessableEntity, Message: "Invalid ID"})

		return
	}

	leads, err := s.svc.GetLeads(id.String())
	if err != nil {
		if errors.Is(err, ErrPlacesNotFound) {
			renderJSON(w, http.StatusOK, []Lead{})

			return
		}

		renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: err.Error()})

		return
	}

	renderJSON(w, http.StatusOK, leads)
}

// app serves the Spanish single-page UI.
// login sirve la pantalla de acceso (si ya hay sesión completa, va a la aplicación).
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if _, u := s.auth.sesionDe(tokenDe(r)); u != nil && !u.DebeCambiar {
		http.Redirect(w, r, "/", http.StatusSeeOther)

		return
	}

	page, err := static.ReadFile("static/app/login.html")
	if err != nil {
		http.Error(w, "missing login", http.StatusInternalServerError)

		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(page)
}

func (s *Server) app(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)

		return
	}

	page, err := static.ReadFile("static/app/index.html")
	if err != nil {
		http.Error(w, "missing app", http.StatusInternalServerError)

		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(page)
}
