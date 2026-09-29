package web

// Acceso propio de la aplicación: usuarios con contraseña argon2id, sesiones de
// servidor con cookie segura, bloqueo por intentos fallidos, verificación en dos
// pasos (TOTP) con códigos de recuperación y registro de accesos. Todo se guarda
// en la carpeta de datos con permisos 0600.

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/argon2"
)

const (
	sesionInactiva  = 8 * time.Hour  // sin actividad
	sesionMaxima    = 24 * time.Hour // desde el inicio de sesión
	fallosUsuario   = 5              // intentos seguidos antes de bloquear la cuenta
	fallosIP        = 20             // intentos de una IP antes de bloquearla
	bloqueo         = 15 * time.Minute
	ventanaFallos   = 15 * time.Minute
	longitudMinima  = 12
	emisorTOTP      = "B2B SystemIA"
	cookieSegura    = "__Host-b2b_sesion"
	cookieLocal     = "b2b_sesion"
	codigosRecupera = 8
)


type usuarioAcceso struct {
	Usuario       string    `json:"usuario"`
	Hash          string    `json:"hash"`
	TOTP          string    `json:"totp,omitempty"`
	TOTPPendiente string    `json:"totp_pendiente,omitempty"`
	UltimoPaso    int64     `json:"ultimo_paso,omitempty"`
	Recuperacion  []string  `json:"recuperacion,omitempty"` // sha256 de cada código
	DebeCambiar   bool      `json:"debe_cambiar,omitempty"`
	Creado        time.Time `json:"creado"`
	CambioClave   time.Time `json:"cambio_clave"`
}

type sesionAcceso struct {
	Usuario string    `json:"usuario"`
	Creada  time.Time `json:"creada"`
	Vista   time.Time `json:"vista"`
	IP      string    `json:"ip"`
	Agente  string    `json:"agente"`
}

type intentos struct {
	n       int
	primero time.Time
	hasta   time.Time
}

type Auth struct {
	mu       sync.Mutex
	dir      string
	usuarios map[string]*usuarioAcceso
	sesiones map[string]*sesionAcceso // clave: sha256 del token
	fallos   map[string]*intentos
	guardado time.Time
	ahora    func() time.Time
}

// NewAuth carga los usuarios y sesiones de la carpeta de datos. La primera vez crea
// el usuario «admin» con una contraseña aleatoria que debe cambiarse al entrar; la
// deja en acceso-inicial.txt (0600) hasta ese cambio.
func NewAuth(dir string) (*Auth, error) {
	a := &Auth{dir: dir, usuarios: map[string]*usuarioAcceso{}, sesiones: map[string]*sesionAcceso{}, fallos: map[string]*intentos{}, ahora: time.Now}

	if err := leerJSON(a.ruta("usuarios.json"), &a.usuarios); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("usuarios: %w", err)
	}

	if err := leerJSON(a.ruta("sesiones.json"), &a.sesiones); err != nil && !errors.Is(err, os.ErrNotExist) {
		a.sesiones = map[string]*sesionAcceso{}
	}

	if len(a.usuarios) == 0 {
		clave, err := claveAleatoria(20)
		if err != nil {
			return nil, err
		}

		now := a.ahora()
		a.usuarios["admin"] = &usuarioAcceso{Usuario: "admin", Hash: hashClave(clave), DebeCambiar: true, Creado: now, CambioClave: now}

		if err := a.guardarUsuarios(); err != nil {
			return nil, err
		}

		txt := fmt.Sprintf("Acceso inicial a B2B (cámbiala al entrar; este archivo se borra solo)\nusuario: admin\ncontraseña: %s\n", clave)
		if err := escribirPrivado(a.ruta("acceso-inicial.txt"), []byte(txt)); err != nil {
			return nil, err
		}

		log.Printf("acceso: usuario inicial creado; credenciales en %s", a.ruta("acceso-inicial.txt"))
	}

	return a, nil
}

func (a *Auth) ruta(n string) string { return filepath.Join(a.dir, n) }

/* ---------------- contraseñas ---------------- */

func hashClave(clave string) string {
	sal := make([]byte, 16)
	_, _ = rand.Read(sal)
	h := argon2.IDKey([]byte(clave), sal, 3, 64*1024, 2, 32)

	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s", base64.RawStdEncoding.EncodeToString(sal), base64.RawStdEncoding.EncodeToString(h))
}

func verificarClave(hash, clave string) bool {
	p := strings.Split(hash, "$")
	if len(p) != 6 || p[1] != "argon2id" {
		return false
	}

	var m, t uint32

	var par uint8
	if _, err := fmt.Sscanf(p[3], "m=%d,t=%d,p=%d", &m, &t, &par); err != nil {
		return false
	}

	sal, err1 := base64.RawStdEncoding.DecodeString(p[4])
	want, err2 := base64.RawStdEncoding.DecodeString(p[5])

	if err1 != nil || err2 != nil {
		return false
	}

	got := argon2.IDKey([]byte(clave), sal, t, m, par, uint32(len(want))) //nolint:gosec // longitud de 32 bytes

	return subtle.ConstantTimeCompare(got, want) == 1
}

// Hash de relleno para usuarios inexistentes: el tiempo de respuesta es el mismo.
var hashRelleno = hashClave("relleno-para-igualar-tiempos")

func validarNuevaClave(usuario, clave string) error {
	if len([]rune(clave)) < longitudMinima {
		return fmt.Errorf("la contraseña debe tener al menos %d caracteres", longitudMinima)
	}

	var letra, otro bool

	for _, r := range clave {
		if unicode.IsLetter(r) {
			letra = true
		} else {
			otro = true
		}
	}

	if !letra || !otro {
		return errors.New("la contraseña debe combinar letras con números o símbolos")
	}

	if strings.Contains(strings.ToLower(clave), strings.ToLower(usuario)) {
		return errors.New("la contraseña no puede contener el nombre de usuario")
	}

	return nil
}

func claveAleatoria(n int) (string, error) {
	const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

	b := make([]byte, n)

	for i := range b {
		k, err := rand.Int(rand.Reader, big.NewInt(int64(len(alfabeto))))
		if err != nil {
			return "", err
		}

		b[i] = alfabeto[k.Int64()]
	}

	return string(b), nil
}

/* ---------------- verificación en dos pasos ---------------- */

var opcionesTOTP = totp.ValidateOpts{Period: 30, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1}

// codigoValido acepta el código del paso actual o de los contiguos (desfase de reloj)
// y nunca un paso ya usado (evita reutilizar un código interceptado).
func (u *usuarioAcceso) codigoValido(secreto, codigo string, ahora time.Time) bool {
	codigo = strings.ReplaceAll(strings.TrimSpace(codigo), " ", "")
	if len(codigo) != 6 {
		return false
	}

	paso := ahora.Unix() / 30

	for d := int64(-1); d <= 1; d++ {
		c, err := totp.GenerateCodeCustom(secreto, time.Unix((paso+d)*30, 0), opcionesTOTP)
		if err == nil && subtle.ConstantTimeCompare([]byte(c), []byte(codigo)) == 1 && paso+d > u.UltimoPaso {
			u.UltimoPaso = paso + d

			return true
		}
	}

	return false
}

func (u *usuarioAcceso) usarRecuperacion(codigo string) bool {
	h := sha256.Sum256([]byte(strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(codigo), "-", ""))))
	hx := hex.EncodeToString(h[:])

	for i, x := range u.Recuperacion {
		if subtle.ConstantTimeCompare([]byte(x), []byte(hx)) == 1 {
			u.Recuperacion = append(u.Recuperacion[:i], u.Recuperacion[i+1:]...)

			return true
		}
	}

	return false
}

/* ---------------- intentos fallidos ---------------- */

func (a *Auth) bloqueado(k string, now time.Time) bool {
	f := a.fallos[k]

	return f != nil && now.Before(f.hasta)
}

func (a *Auth) fallo(k string, limite int, now time.Time) {
	f := a.fallos[k]
	if f == nil || now.Sub(f.primero) > ventanaFallos {
		f = &intentos{primero: now}
		a.fallos[k] = f
	}

	f.n++
	if f.n >= limite {
		f.hasta = now.Add(bloqueo)
		f.n = 0
		f.primero = now
	}
}

/* ---------------- sesiones ---------------- */

func claveSesion(token string) string {
	h := sha256.Sum256([]byte(token))

	return hex.EncodeToString(h[:])
}

func (a *Auth) nuevaSesion(usuario, ip, agente string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}

	token := base64.RawURLEncoding.EncodeToString(b)
	now := a.ahora()
	a.sesiones[claveSesion(token)] = &sesionAcceso{Usuario: usuario, Creada: now, Vista: now, IP: ip, Agente: recortar(agente, 200)}

	return token, a.guardarSesiones()
}

// sesionDe devuelve la sesión válida del token (y la renueva) o nil.
func (a *Auth) sesionDe(token string) (*sesionAcceso, *usuarioAcceso) {
	if token == "" {
		return nil, nil
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	k := claveSesion(token)
	s := a.sesiones[k]

	if s == nil {
		return nil, nil
	}

	now := a.ahora()
	u := a.usuarios[s.Usuario]

	if u == nil || now.Sub(s.Vista) > sesionInactiva || now.Sub(s.Creada) > sesionMaxima || s.Creada.Before(u.CambioClave) {
		delete(a.sesiones, k)
		_ = a.guardarSesiones()

		return nil, nil
	}

	if now.Sub(s.Vista) > time.Minute {
		s.Vista = now
		if now.Sub(a.guardado) > 5*time.Minute {
			_ = a.guardarSesiones()
		}
	}

	return s, u
}

func (a *Auth) cerrarSesiones(usuario, excepto string) {
	for k, s := range a.sesiones {
		if s.Usuario == usuario && k != excepto {
			delete(a.sesiones, k)
		}
	}
}

/* ---------------- persistencia ---------------- */

func (a *Auth) guardarUsuarios() error { return guardarJSON(a.ruta("usuarios.json"), a.usuarios) }

func (a *Auth) guardarSesiones() error {
	a.guardado = a.ahora()

	return guardarJSON(a.ruta("sesiones.json"), a.sesiones)
}

func leerJSON(ruta string, v any) error {
	b, err := os.ReadFile(ruta)
	if err != nil {
		return err
	}

	return json.Unmarshal(b, v)
}

func guardarJSON(ruta string, v any) error {
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		return err
	}

	return escribirPrivado(ruta, b)
}

// escribirPrivado escribe de forma atómica con permisos 0600.
func escribirPrivado(ruta string, b []byte) error {
	tmp := ruta + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}

	return os.Rename(tmp, ruta)
}

func (a *Auth) registrar(evento, usuario, ip string) {
	f, err := os.OpenFile(a.ruta("accesos.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}

	defer func() { _ = f.Close() }()

	b, _ := json.Marshal(map[string]string{"fecha": a.ahora().UTC().Format(time.RFC3339), "evento": evento, "usuario": recortar(usuario, 64), "ip": ip})
	_, _ = f.Write(append(b, '\n'))
}

func recortar(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}

	return s
}

/* ---------------- HTTP ---------------- */

// ipCliente: la IP real que pasa Caddy si la petición llega desde la red interna.
func ipCliente(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}

	if ip := net.ParseIP(host); ip != nil && (ip.IsPrivate() || ip.IsLoopback()) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}

	return host
}

func esHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

func tokenDe(r *http.Request) string {
	for _, n := range []string{cookieSegura, cookieLocal} {
		if c, err := r.Cookie(n); err == nil {
			return c.Value
		}
	}

	return ""
}

func ponerCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int) {
	nombre := cookieLocal
	if esHTTPS(r) {
		nombre = cookieSegura
	}

	http.SetCookie(w, &http.Cookie{Name: nombre, Value: token, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: esHTTPS(r), SameSite: http.SameSiteStrictMode})
}

// mismoOrigen rechaza peticiones que modifican datos desde otra web (CSRF).
func mismoOrigen(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}

	if s := r.Header.Get("Sec-Fetch-Site"); s != "" && s != "same-origin" && s != "none" {
		return false
	}

	if o := r.Header.Get("Origin"); o != "" {
		u, err := url.Parse(o)
		if err != nil || u.Host != r.Host {
			return false
		}
	}

	return true
}

type ctxSesion struct{}

// Proteger exige sesión en toda la aplicación salvo la pantalla de acceso.
func (a *Auth) Proteger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !mismoOrigen(r) {
			renderJSON(w, http.StatusForbidden, apiError{Code: http.StatusForbidden, Message: "Petición rechazada: origen no permitido"})

			return
		}

		p := r.URL.Path
		if p == "/login" || p == "/api/v1/sesion" || p == "/favicon.ico" {
			next.ServeHTTP(w, r)

			return
		}

		_, u := a.sesionDe(tokenDe(r))
		api := strings.HasPrefix(p, "/api/")

		// Con la contraseña inicial solo se puede cambiar la contraseña.
		if u != nil && u.DebeCambiar && p != "/api/v1/sesion/contrasena" {
			u = nil
		}

		if u == nil {
			if api || r.Method != http.MethodGet {
				renderJSON(w, http.StatusUnauthorized, apiError{Code: http.StatusUnauthorized, Message: "Sesión no iniciada o caducada"})

				return
			}

			http.Redirect(w, r, "/login", http.StatusSeeOther)

			return
		}

		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

type datosAcceso struct {
	Usuario    string `json:"usuario"`
	Contrasena string `json:"contrasena"`
	Codigo     string `json:"codigo"`
}

// apiSesion: GET estado · POST iniciar · DELETE cerrar (?todas=1 cierra todas).
func (a *Auth) apiSesion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")

	switch r.Method {
	case http.MethodGet:
		s, u := a.sesionDe(tokenDe(r))
		if u == nil {
			renderJSON(w, http.StatusUnauthorized, apiError{Code: http.StatusUnauthorized, Message: "Sesión no iniciada"})

			return
		}

		a.mu.Lock()
		n := 0

		for _, x := range a.sesiones {
			if x.Usuario == u.Usuario {
				n++
			}
		}

		resp := map[string]any{"usuario": u.Usuario, "dos_pasos": u.TOTP != "", "debe_cambiar": u.DebeCambiar, "caduca": s.Creada.Add(sesionMaxima),
			"sesiones": n, "codigos_recuperacion": len(u.Recuperacion), "cambio_clave": u.CambioClave}
		a.mu.Unlock()

		renderJSON(w, http.StatusOK, resp)
	case http.MethodPost:
		a.iniciarSesion(w, r)
	case http.MethodDelete:
		token := tokenDe(r)
		s, u := a.sesionDe(token)

		if u != nil {
			a.mu.Lock()
			if r.URL.Query().Get("todas") == "1" {
				a.cerrarSesiones(u.Usuario, "")
			} else {
				delete(a.sesiones, claveSesion(token))
			}

			_ = a.guardarSesiones()
			a.mu.Unlock()
			a.registrar(map[bool]string{true: "cierre_todas", false: "cierre"}[r.URL.Query().Get("todas") == "1"], s.Usuario, ipCliente(r))
		}

		ponerCookie(w, r, "", -1)
		w.WriteHeader(http.StatusNoContent)
	default:
		renderJSON(w, http.StatusMethodNotAllowed, apiError{Code: http.StatusMethodNotAllowed, Message: methodNotAllowedMessage})
	}
}

func (a *Auth) iniciarSesion(w http.ResponseWriter, r *http.Request) {
	var d datosAcceso
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&d); err != nil {
		renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "Datos no válidos"})

		return
	}

	ip := ipCliente(r)
	nombre := strings.ToLower(strings.TrimSpace(d.Usuario))
	now := a.ahora()

	a.mu.Lock()
	defer a.mu.Unlock()

	if a.bloqueado("ip:"+ip, now) || a.bloqueado("u:"+nombre, now) {
		a.registrar("bloqueado", nombre, ip)
		renderJSON(w, http.StatusTooManyRequests, apiError{Code: http.StatusTooManyRequests, Message: "Demasiados intentos fallidos. Espera 15 minutos y vuelve a intentarlo."})

		return
	}

	u := a.usuarios[nombre]
	hash := hashRelleno

	if u != nil {
		hash = u.Hash
	}

	ok := verificarClave(hash, d.Contrasena) && u != nil
	if !ok {
		a.fallo("ip:"+ip, fallosIP, now)
		a.fallo("u:"+nombre, fallosUsuario, now)
		a.registrar("fallo", nombre, ip)
		renderJSON(w, http.StatusUnauthorized, apiError{Code: http.StatusUnauthorized, Message: "Usuario o contraseña incorrectos"})

		return
	}

	if u.TOTP != "" {
		if strings.TrimSpace(d.Codigo) == "" {
			renderJSON(w, http.StatusOK, map[string]any{"requiere_codigo": true})

			return
		}

		if !u.codigoValido(u.TOTP, d.Codigo, now) && !u.usarRecuperacion(d.Codigo) {
			a.fallo("ip:"+ip, fallosIP, now)
			a.fallo("u:"+nombre, fallosUsuario, now)
			a.registrar("fallo_codigo", nombre, ip)
			renderJSON(w, http.StatusUnauthorized, apiError{Code: http.StatusUnauthorized, Message: "Código de verificación incorrecto o ya usado"})

			return
		}

		_ = a.guardarUsuarios() // último paso o código de recuperación consumido
	}

	delete(a.fallos, "u:"+nombre)

	token, err := a.nuevaSesion(u.Usuario, ip, r.UserAgent())
	if err != nil {
		renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: "No se pudo iniciar la sesión"})

		return
	}

	a.registrar("inicio", u.Usuario, ip)
	ponerCookie(w, r, token, int(sesionMaxima.Seconds()))
	renderJSON(w, http.StatusOK, map[string]any{"ok": true, "debe_cambiar": u.DebeCambiar})
}

type datosClave struct {
	Actual string `json:"actual"`
	Nueva  string `json:"nueva"`
}

// apiCambiarClave cambia la contraseña y cierra las demás sesiones.
func (a *Auth) apiCambiarClave(w http.ResponseWriter, r *http.Request) {
	token := tokenDe(r)

	s, u := a.sesionDe(token)
	if u == nil {
		renderJSON(w, http.StatusUnauthorized, apiError{Code: http.StatusUnauthorized, Message: "Sesión no iniciada"})

		return
	}

	var d datosClave
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&d); err != nil {
		renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "Datos no válidos"})

		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	now := a.ahora()
	if a.bloqueado("u:"+u.Usuario, now) {
		renderJSON(w, http.StatusTooManyRequests, apiError{Code: http.StatusTooManyRequests, Message: "Demasiados intentos fallidos. Espera 15 minutos."})

		return
	}

	if !verificarClave(u.Hash, d.Actual) {
		a.fallo("u:"+u.Usuario, fallosUsuario, now)
		renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "La contraseña actual no es correcta"})

		return
	}

	if d.Nueva == d.Actual {
		renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "La nueva contraseña debe ser distinta de la actual"})

		return
	}

	if err := validarNuevaClave(u.Usuario, d.Nueva); err != nil {
		renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: err.Error()})

		return
	}

	u.Hash = hashClave(d.Nueva)
	u.DebeCambiar = false
	u.CambioClave = now
	s.Creada = now // la sesión actual sigue válida; las demás caducan por CambioClave
	s.Vista = now

	a.cerrarSesiones(u.Usuario, claveSesion(token))

	if err := a.guardarUsuarios(); err != nil {
		renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: "No se pudo guardar la contraseña"})

		return
	}

	_ = a.guardarSesiones()
	_ = os.Remove(a.ruta("acceso-inicial.txt"))
	a.registrar("cambio_clave", u.Usuario, ipCliente(r))
	renderJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type datosDosPasos struct {
	Codigo     string `json:"codigo"`
	Contrasena string `json:"contrasena"`
}

// apiDosPasos: POST iniciar (secreto + QR) · activar (código) · desactivar (contraseña + código).
func (a *Auth) apiDosPasos(w http.ResponseWriter, r *http.Request) {
	_, u := a.sesionDe(tokenDe(r))
	if u == nil {
		renderJSON(w, http.StatusUnauthorized, apiError{Code: http.StatusUnauthorized, Message: "Sesión no iniciada"})

		return
	}

	var d datosDosPasos
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&d)

	a.mu.Lock()
	defer a.mu.Unlock()

	now := a.ahora()
	ip := ipCliente(r)

	switch r.PathValue("accion") {
	case "iniciar":
		key, err := totp.Generate(totp.GenerateOpts{Issuer: emisorTOTP, AccountName: u.Usuario})
		if err != nil {
			renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: "No se pudo generar el secreto"})

			return
		}

		img, err := key.Image(220, 220)
		if err != nil {
			renderJSON(w, http.StatusInternalServerError, apiError{Code: http.StatusInternalServerError, Message: "No se pudo generar el código QR"})

			return
		}

		var buf bytes.Buffer
		_ = png.Encode(&buf, img)

		u.TOTPPendiente = key.Secret()
		_ = a.guardarUsuarios()

		renderJSON(w, http.StatusOK, map[string]string{"secreto": key.Secret(), "qr": "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())})
	case "activar":
		if u.TOTPPendiente == "" || !u.codigoValido(u.TOTPPendiente, d.Codigo, now) {
			renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "El código no es correcto. Revisa la hora del móvil y vuelve a intentarlo."})

			return
		}

		codigos := make([]string, codigosRecupera)
		u.Recuperacion = nil

		for i := range codigos {
			c, _ := claveAleatoria(10)
			c = strings.ToUpper(c)
			codigos[i] = c[:5] + "-" + c[5:]
			h := sha256.Sum256([]byte(c))
			u.Recuperacion = append(u.Recuperacion, hex.EncodeToString(h[:]))
		}

		u.TOTP, u.TOTPPendiente = u.TOTPPendiente, ""
		_ = a.guardarUsuarios()
		a.registrar("2fa_activado", u.Usuario, ip)
		renderJSON(w, http.StatusOK, map[string]any{"ok": true, "recuperacion": codigos})
	case "desactivar":
		if !verificarClave(u.Hash, d.Contrasena) || u.TOTP == "" || !u.codigoValido(u.TOTP, d.Codigo, now) {
			a.fallo("u:"+u.Usuario, fallosUsuario, now)
			renderJSON(w, http.StatusBadRequest, apiError{Code: http.StatusBadRequest, Message: "Contraseña o código incorrectos"})

			return
		}

		u.TOTP, u.Recuperacion = "", nil
		_ = a.guardarUsuarios()
		a.registrar("2fa_desactivado", u.Usuario, ip)
		renderJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		http.NotFound(w, r)
	}
}
