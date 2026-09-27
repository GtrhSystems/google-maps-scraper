package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func primero(t *testing.T, cc, q string) Lugar {
	t.Helper()

	res, err := buscarLugares(cc, q, 10)
	if err != nil || len(res) == 0 {
		t.Fatalf("%s %q: sin resultados (%v)", cc, q, err)
	}

	return res[0]
}

func TestBuscarLugares(t *testing.T) {
	casos := []struct{ cc, q, tipo, nombre, ctx, codigo string }{
		{"ES", "chamberi", "barrio", "Chamberí", "Madrid", "28079"},
		{"ES", "28010", "cp", "28010", "Madrid", "28079"},
		{"ES", "logrono", "municipio", "Logroño", "La Rioja", "26089"},
		{"ES", "el ballestero", "municipio", "El Ballestero", "Albacete", "02014"},
		{"ES", "rozas de madrid", "municipio", "Las Rozas de Madrid", "Madrid", "28127"},
		{"MX", "miguel hidalgo ciudad de mexico", "municipio", "Miguel Hidalgo", "Ciudad de México", "09016"},
		{"CO", "medellin", "municipio", "Medellín", "Antioquia", "05001"},
		{"PE", "miraflores lima", "municipio", "Miraflores", "Lima", "150122"},
		{"CL", "chillan", "municipio", "Chillán", "Región de Ñuble", "16101"},
		{"AR", "palermo", "municipio", "Palermo", "Ciudad Autónoma de Buenos Aires", ""},
		{"CO", "chapinero", "barrio", "Chapinero", "Bogotá", "11001"},
		{"CO", "el poblado", "barrio", "El Poblado", "Medellín", "05001"},
	}

	for _, c := range casos {
		l := primero(t, c.cc, c.q)
		if l.Tipo != c.tipo || l.Nombre != c.nombre || !strings.Contains(l.Contexto, c.ctx) || (c.codigo != "" && !strings.Contains(l.Codigo, c.codigo)) {
			t.Errorf("%s %q → %s %q [%s] cód %s; quiero %s %q [%s] cód %s", c.cc, c.q, l.Tipo, l.Nombre, l.Contexto, l.Codigo, c.tipo, c.nombre, c.ctx, c.codigo)
		}
	}
}

func TestLugarConsultaYEncuadre(t *testing.T) {
	cham := primero(t, "ES", "chamberi")
	if cham.Consulta != "Chamberí, Madrid, Comunidad de Madrid, España" {
		t.Errorf("consulta = %q", cham.Consulta)
	}

	cp := primero(t, "ES", "28010")
	if cp.Consulta != "28010, Madrid, Comunidad de Madrid, España" || cp.Etiqueta != "Código postal" {
		t.Errorf("cp: %q / %q", cp.Consulta, cp.Etiqueta)
	}

	// Madrid tiene su término oficial (CartoCiudad): encuadre de ciudad y radio acorde.
	mad := primero(t, "ES", "madrid")
	if mad.Tipo != "municipio" || len(mad.BBox) != 4 || mad.Zoom < 9 || mad.Zoom > 12 || mad.RadioKm < 15 || mad.RadioKm > 40 {
		t.Errorf("Madrid: tipo=%s bbox=%v zoom=%d radio=%v", mad.Tipo, mad.BBox, mad.Zoom, mad.RadioKm)
	}

	if cham.Zoom != 15 {
		t.Errorf("barrio: zoom %d", cham.Zoom)
	}
}

func TestBuscarLugaresSinResultadosNiPaisDesconocido(t *testing.T) {
	if res, _ := buscarLugares("ES", "xqzwv inventado", 10); len(res) != 0 {
		t.Errorf("un lugar inventado no debe dar resultados: %+v", res)
	}

	if _, err := buscarLugares("XX", "paris", 10); err == nil {
		t.Error("un país sin catálogo debe dar error")
	}
}

func TestValidarZonas(t *testing.T) {
	ok := primero(t, "ES", "chamberi")

	zs, err := validarZonas([]Lugar{ok})
	if err != nil || len(zs) != 1 || zs[0].Codigo != "28079" {
		t.Fatalf("zona válida rechazada: %v", err)
	}

	// Una zona manipulada (nombre o código que no existen) se rechaza.
	for _, mal := range []Lugar{
		{Pais: "ES", Tipo: ok.Tipo, Nombre: "Chamberí Norte", Contexto: ok.Contexto, Codigo: ok.Codigo},
		{Pais: "ES", Tipo: ok.Tipo, Nombre: ok.Nombre, Contexto: ok.Contexto, Codigo: "99999"},
		{Pais: "XX", Tipo: "municipio", Nombre: "Madrid"},
	} {
		if _, err := validarZonas([]Lugar{mal}); err == nil {
			t.Errorf("zona manipulada aceptada: %+v", mal)
		}
	}

	// Las coordenadas enviadas (verificadas en CartoCiudad) se conservan solo si están cerca.
	lejos := ok
	lejos.Lat, lejos.Lon = 10, 10

	if zs, _ := validarZonas([]Lugar{lejos}); zs[0].Lat != ok.Lat {
		t.Error("aceptó coordenadas lejanas a la zona oficial")
	}
}

func TestVerificarCPEspana(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id") == "28010" {
			_, _ = w.Write([]byte(`{"id":"28010","type":"Codpost","postalCode":"28010","lat":40.4329,"lng":-3.6968}`))

			return
		}

		_, _ = w.Write([]byte(`{"id":"28999","type":"Codpost","postalCode":null,"lat":0.0,"lng":0.0}`))
	}))
	defer srv.Close()

	orig := cartoCiudadURL
	cartoCiudadURL = srv.URL
	defer func() { cartoCiudadURL = orig }()

	if v := verificarCPEspana(context.Background(), "28010"); !v.OK || v.Lat != 40.4329 {
		t.Errorf("28010: %+v", v)
	}

	for _, cp := range []string{"28999", "99001", "2801", "abcde"} {
		if v := verificarCPEspana(context.Background(), cp); v.OK {
			t.Errorf("%s no debería verificarse: %+v", cp, v)
		}
	}
}

func TestValidarGeoConsulta(t *testing.T) {
	for _, ok := range []string{"dentistas en Chamberí", "dentistas en Chamberí, Madrid #@40.43404,-3.70379,15", "cafés #@-33.4,-70.6,12"} {
		if err := validarGeoConsulta(ok); err != nil {
			t.Errorf("%q: %v", ok, err)
		}
	}

	for _, mal := range []string{"x #@95,0,15", "x #@40,-200,12", "x #@40,-3,0", "x #@40,-3", "x #@abc", " #@40,-3,12"} {
		if err := validarGeoConsulta(mal); err == nil {
			t.Errorf("%q debería rechazarse", mal)
		}
	}
}

// Todo el mundo: 247 países; los principales con fuentes oficiales (EE. UU. con el Censo)
// y el resto con GeoNames, buscando también por el nombre en español.
func TestLugaresMundo(t *testing.T) {
	if len(paisesLugares) < 200 {
		t.Fatalf("solo %d países en el índice", len(paisesLugares))
	}

	if p := paisesLugares[7]; p.CC != "US" || !p.Principal {
		t.Errorf("EE. UU. debe ser principal: %+v", p)
	}

	casos := []struct{ cc, q, nombre, ctx string }{
		{"US", "brooklyn", "Brooklyn", "New York"},
		{"US", "10001", "10001", "New York"},
		{"US", "miami", "Miami", "Florida"},
		{"VE", "chacao", "Chacao", "Miranda"},
		{"VE", "caracas", "Caracas", ""},
		{"GB", "londres", "London", "England"},
		{"DE", "munich", "Munich", "Bavaria"},
		{"FR", "paris", "Paris", "Île-de-France"},
		{"BR", "sao paulo", "São Paulo", ""},
	}

	for _, c := range casos {
		l := primero(t, c.cc, c.q)
		if l.Nombre != c.nombre || !strings.Contains(l.Contexto, c.ctx) {
			t.Errorf("%s %q → %s %q [%s]; quiero %q [%s]", c.cc, c.q, l.Tipo, l.Nombre, l.Contexto, c.nombre, c.ctx)
		}
	}

	// Radio por superficie oficial del Censo (Miami ~ 145 km²: unos 7 km).
	if m := primero(t, "US", "miami"); m.RadioKm < 4 || m.RadioKm > 15 || m.Zoom < 11 || m.Zoom > 14 {
		t.Errorf("Miami: radio %v km, zoom %d", m.RadioKm, m.Zoom)
	}
}
