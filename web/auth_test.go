package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
)

type clienteAcceso struct {
	t      *testing.T
	h      http.Handler
	cookie *http.Cookie
}

func (c *clienteAcceso) pedir(metodo, ruta, cuerpo string, cab ...string) *httptest.ResponseRecorder {
	c.t.Helper()

	req := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	req.Header.Set("Content-Type", "application/json")

	for i := 0; i+1 < len(cab); i += 2 {
		req.Header.Set(cab[i], cab[i+1])
	}

	if c.cookie != nil {
		req.AddCookie(c.cookie)
	}

	rec := httptest.NewRecorder()
	c.h.ServeHTTP(rec, req)

	for _, ck := range rec.Result().Cookies() {
		if ck.Name == cookieLocal {
			if ck.MaxAge < 0 {
				c.cookie = nil
			} else {
				c.cookie = ck
			}
		}
	}

	return rec
}

func claveInicial(t *testing.T, dir string) string {
	t.Helper()

	b, err := os.ReadFile(filepath.Join(dir, "acceso-inicial.txt"))
	if err != nil {
		t.Fatal(err)
	}

	m := regexp.MustCompile(`contraseña: (\S+)`).FindStringSubmatch(string(b))
	if m == nil {
		t.Fatalf("sin contraseña inicial: %s", b)
	}

	return m[1]
}

func servidorAcceso(t *testing.T) (*Server, string) {
	t.Helper()

	dir := t.TempDir()

	srv, err := New(NewService(&mockJobRepo{}, dir), ":0")
	if err != nil {
		t.Fatal(err)
	}

	return srv, dir
}

func TestAccesoFlujoCompleto(t *testing.T) {
	srv, dir := servidorAcceso(t)
	c := &clienteAcceso{t: t, h: srv.srv.Handler}

	// Sin sesión: la aplicación redirige al acceso y la API responde 401.
	if r := c.pedir("GET", "/", ""); r.Code != http.StatusSeeOther || r.Header().Get("Location") != "/login" {
		t.Fatalf("/ sin sesión: %d %s", r.Code, r.Header().Get("Location"))
	}

	if r := c.pedir("GET", "/api/v1/jobs", ""); r.Code != http.StatusUnauthorized {
		t.Fatalf("API sin sesión: %d", r.Code)
	}

	if r := c.pedir("GET", "/static/app/index.html", ""); r.Code != http.StatusSeeOther {
		t.Fatalf("estáticos sin sesión: %d", r.Code)
	}

	if r := c.pedir("GET", "/login", ""); r.Code != http.StatusOK || !strings.Contains(r.Body.String(), "Iniciar sesión") {
		t.Fatalf("pantalla de acceso: %d", r.Code)
	}

	// Contraseña incorrecta.
	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"mal"}`); r.Code != http.StatusUnauthorized {
		t.Fatalf("clave incorrecta: %d", r.Code)
	}

	inicial := claveInicial(t, dir)

	r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"Admin","contrasena":"`+inicial+`"}`)
	if r.Code != http.StatusOK || !strings.Contains(r.Body.String(), `"debe_cambiar":true`) || c.cookie == nil {
		t.Fatalf("acceso inicial: %d %s", r.Code, r.Body.String())
	}

	if !c.cookie.HttpOnly || c.cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie insegura: %+v", c.cookie)
	}

	// Con la contraseña inicial no se puede usar la aplicación.
	if r := c.pedir("GET", "/api/v1/jobs", ""); r.Code != http.StatusUnauthorized {
		t.Fatalf("debe cambiar la clave primero: %d", r.Code)
	}

	if r := c.pedir("POST", "/api/v1/sesion/contrasena", `{"actual":"`+inicial+`","nueva":"corta1"}`); r.Code != http.StatusBadRequest {
		t.Fatalf("clave débil aceptada: %d", r.Code)
	}

	nueva := "Horno-Sanbrandan-2026"
	if r := c.pedir("POST", "/api/v1/sesion/contrasena", `{"actual":"`+inicial+`","nueva":"`+nueva+`"}`); r.Code != http.StatusOK {
		t.Fatalf("cambio de clave: %d %s", r.Code, r.Body.String())
	}

	if _, err := os.Stat(filepath.Join(dir, "acceso-inicial.txt")); !os.IsNotExist(err) {
		t.Fatal("el archivo de acceso inicial debe borrarse tras el cambio")
	}

	if r := c.pedir("GET", "/api/v1/jobs", ""); r.Code != http.StatusOK {
		t.Fatalf("con sesión: %d", r.Code)
	}

	// Petición desde otra web (CSRF).
	if r := c.pedir("DELETE", "/api/v1/jobs/00000000-0000-0000-0000-000000000001", "", "Origin", "https://malicioso.example"); r.Code != http.StatusForbidden {
		t.Fatalf("CSRF por Origin: %d", r.Code)
	}

	if r := c.pedir("POST", "/api/v1/jobs", "{}", "Sec-Fetch-Site", "cross-site"); r.Code != http.StatusForbidden {
		t.Fatalf("CSRF por Sec-Fetch-Site: %d", r.Code)
	}

	// Cerrar sesión invalida el token en el servidor, aunque se reutilice la cookie.
	vieja := c.cookie
	if r := c.pedir("DELETE", "/api/v1/sesion", ""); r.Code != http.StatusNoContent {
		t.Fatalf("cerrar sesión: %d", r.Code)
	}

	c.cookie = vieja
	if r := c.pedir("GET", "/api/v1/jobs", ""); r.Code != http.StatusUnauthorized {
		t.Fatalf("token reutilizado tras cerrar sesión: %d", r.Code)
	}

	// La contraseña antigua ya no vale; la nueva sí.
	c.cookie = nil
	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+inicial+`"}`); r.Code != http.StatusUnauthorized {
		t.Fatalf("clave antigua aceptada: %d", r.Code)
	}

	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+nueva+`"}`); r.Code != http.StatusOK || strings.Contains(r.Body.String(), `"debe_cambiar":true`) {
		t.Fatalf("acceso con la nueva: %d %s", r.Code, r.Body.String())
	}

	// Los datos guardados no contienen la contraseña ni el token en claro.
	b, _ := os.ReadFile(filepath.Join(dir, "usuarios.json"))
	s, _ := os.ReadFile(filepath.Join(dir, "sesiones.json"))

	if strings.Contains(string(b), nueva) || strings.Contains(string(s), c.cookie.Value) {
		t.Fatal("secretos en claro en disco")
	}

	if st, _ := os.Stat(filepath.Join(dir, "usuarios.json")); st.Mode().Perm() != 0o600 {
		t.Fatalf("permisos de usuarios.json: %v", st.Mode().Perm())
	}
}

func TestAccesoBloqueoPorIntentos(t *testing.T) {
	srv, dir := servidorAcceso(t)
	c := &clienteAcceso{t: t, h: srv.srv.Handler}
	inicial := claveInicial(t, dir)

	for i := range fallosUsuario {
		if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"x`+string(rune('a'+i))+`"}`); r.Code != http.StatusUnauthorized {
			t.Fatalf("intento %d: %d", i, r.Code)
		}
	}

	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+inicial+`"}`); r.Code != http.StatusTooManyRequests {
		t.Fatalf("cuenta sin bloquear tras %d fallos: %d", fallosUsuario, r.Code)
	}

	// Pasado el bloqueo vuelve a funcionar.
	srv.auth.ahora = func() time.Time { return time.Now().Add(bloqueo + time.Minute) }
	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+inicial+`"}`); r.Code != http.StatusOK {
		t.Fatalf("tras el bloqueo: %d", r.Code)
	}

	// Un usuario inexistente responde igual que una contraseña incorrecta.
	c2 := &clienteAcceso{t: t, h: srv.srv.Handler}

	r := c2.pedir("POST", "/api/v1/sesion", `{"usuario":"nadie","contrasena":"x"}`)
	if r.Code != http.StatusUnauthorized || !strings.Contains(r.Body.String(), "Usuario o contraseña incorrectos") {
		t.Fatalf("usuario inexistente: %d %s", r.Code, r.Body.String())
	}
}

func TestAccesoDosPasosYCaducidad(t *testing.T) {
	srv, dir := servidorAcceso(t)
	c := &clienteAcceso{t: t, h: srv.srv.Handler}
	inicial := claveInicial(t, dir)
	clave := "Clave-Segura-2026"

	c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+inicial+`"}`)
	c.pedir("POST", "/api/v1/sesion/contrasena", `{"actual":"`+inicial+`","nueva":"`+clave+`"}`)

	r := c.pedir("POST", "/api/v1/sesion/2fa/iniciar", "")

	var k struct{ Secreto, QR string }
	if err := json.Unmarshal(r.Body.Bytes(), &k); err != nil || k.Secreto == "" || !strings.HasPrefix(k.QR, "data:image/png;base64,") {
		t.Fatalf("iniciar 2FA: %d %s", r.Code, r.Body.String())
	}

	// El paso siguiente al actual: así el código de acceso no es el mismo que el de activación.
	ahora := time.Now()
	codigo, _ := totp.GenerateCode(k.Secreto, ahora)

	r = c.pedir("POST", "/api/v1/sesion/2fa/activar", `{"codigo":"`+codigo+`"}`)

	var act struct{ Recuperacion []string }
	if err := json.Unmarshal(r.Body.Bytes(), &act); err != nil || len(act.Recuperacion) != codigosRecupera {
		t.Fatalf("activar 2FA: %d %s", r.Code, r.Body.String())
	}

	c.pedir("DELETE", "/api/v1/sesion", "")

	// Contraseña correcta sin código: pide el código y no abre sesión.
	r = c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+clave+`"}`)
	if !strings.Contains(r.Body.String(), `"requiere_codigo":true`) || c.cookie != nil {
		t.Fatalf("sin código: %s", r.Body.String())
	}

	// Reutilizar el código ya usado: rechazado.
	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+clave+`","codigo":"`+codigo+`"}`); r.Code != http.StatusUnauthorized {
		t.Fatalf("código reutilizado: %d", r.Code)
	}

	siguiente := ahora.Add(30 * time.Second)
	srv.auth.ahora = func() time.Time { return siguiente }
	cod2, _ := totp.GenerateCode(k.Secreto, siguiente)

	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+clave+`","codigo":"`+cod2+`"}`); r.Code != http.StatusOK {
		t.Fatalf("código válido: %d %s", r.Code, r.Body.String())
	}

	c.pedir("DELETE", "/api/v1/sesion", "")

	// Código de recuperación: sirve una sola vez.
	rec := act.Recuperacion[0]
	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+clave+`","codigo":"`+strings.ToLower(rec)+`"}`); r.Code != http.StatusOK {
		t.Fatalf("código de recuperación: %d", r.Code)
	}

	c.pedir("DELETE", "/api/v1/sesion", "")

	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+clave+`","codigo":"`+rec+`"}`); r.Code != http.StatusUnauthorized {
		t.Fatalf("recuperación reutilizada: %d", r.Code)
	}

	// Caducidad por inactividad.
	cod3, _ := totp.GenerateCode(k.Secreto, siguiente.Add(30*time.Second))
	srv.auth.ahora = func() time.Time { return siguiente.Add(30 * time.Second) }

	if r := c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+clave+`","codigo":"`+cod3+`"}`); r.Code != http.StatusOK {
		t.Fatalf("acceso: %d", r.Code)
	}

	srv.auth.ahora = func() time.Time { return siguiente.Add(sesionInactiva + time.Hour) }
	if r := c.pedir("GET", "/api/v1/jobs", ""); r.Code != http.StatusUnauthorized {
		t.Fatalf("sesión inactiva no caducó: %d", r.Code)
	}
}

func TestAccesoSesionesSobrevivenAlReinicio(t *testing.T) {
	srv, dir := servidorAcceso(t)
	c := &clienteAcceso{t: t, h: srv.srv.Handler}
	inicial := claveInicial(t, dir)

	c.pedir("POST", "/api/v1/sesion", `{"usuario":"admin","contrasena":"`+inicial+`"}`)
	c.pedir("POST", "/api/v1/sesion/contrasena", `{"actual":"`+inicial+`","nueva":"Otra-Clave-2026"}`)

	// Un despliegue reinicia el servidor: la sesión sigue abierta.
	srv2, err := New(NewService(&mockJobRepo{}, dir), ":0")
	if err != nil {
		t.Fatal(err)
	}

	c.h = srv2.srv.Handler
	if r := c.pedir("GET", "/api/v1/jobs", ""); r.Code != http.StatusOK {
		t.Fatalf("sesión perdida tras reiniciar: %d", r.Code)
	}
}
