// Sesión de la aplicación: menú de usuario, cerrar sesión, cambio de contraseña y
// verificación en dos pasos. Si el servidor responde 401 (sesión caducada o
// cerrada en otro sitio) se vuelve a la pantalla de acceso.
"use strict";

(function () {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const r = await fetchOriginal(...args);
    const url = String(args[0] && args[0].url ? args[0].url : args[0]);
    if (r.status === 401 && !url.includes("/api/v1/sesion")) irAlAcceso("caducada=1");
    return r;
  };
})();

function irAlAcceso(q) {
  try { if (location.hash) sessionStorage.setItem("b2b.volver", location.hash); } catch (e) { /* sin almacenamiento */ }
  location.replace("/login" + (q ? "?" + q : ""));
}

const escS = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iconosS = () => { try { lucide.createIcons(); } catch (e) { /* sin iconos */ } };

async function sesionAPI(url, metodo = "POST", datos) {
  const r = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: datos ? JSON.stringify(datos) : undefined });
  let j = {};
  try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  if (!r.ok) throw new Error(j.message || "No se pudo completar la operación");
  return j;
}

async function cerrarSesion(todas) {
  try { await fetch("/api/v1/sesion" + (todas ? "?todas=1" : ""), { method: "DELETE", credentials: "same-origin" }); } catch (e) { /* se sale igualmente */ }
  try { sessionStorage.removeItem("b2b.volver"); } catch (e) { /* sin almacenamiento */ }
  location.replace("/login?salida=1");
}

let estadoSesion = null;

async function pintarUsuario() {
  try { estadoSesion = await sesionAPI("/api/v1/sesion", "GET"); } catch (e) { return; }
  const tema = document.getElementById("themeBtn");
  if (!tema || document.getElementById("userBtn")) return;
  const w = document.createElement("div");
  w.className = "usr";
  w.innerHTML = `<button class="btn btn-ghost btn-sm" id="userBtn" aria-haspopup="menu" aria-expanded="false" title="Tu cuenta"><i data-lucide="circle-user-round"></i><span>${escS(estadoSesion.usuario)}</span><i data-lucide="chevron-down"></i></button>
    <div class="usr-menu" id="userMenu" role="menu" hidden>
      <div class="usr-h"><b>${escS(estadoSesion.usuario)}</b><span>${estadoSesion.dos_pasos ? "Verificación en dos pasos activa" : "Sin verificación en dos pasos"}</span></div>
      <button role="menuitem" id="uSeg"><i data-lucide="shield-check"></i>Seguridad de la cuenta</button>
      <button role="menuitem" id="uTodas"><i data-lucide="monitor-x"></i>Cerrar sesión en todos los dispositivos</button>
      <button role="menuitem" id="uSalir" class="peligro"><i data-lucide="log-out"></i>Cerrar sesión</button>
    </div>`;
  tema.parentNode.insertBefore(w, tema);
  iconosS();
  const b = document.getElementById("userBtn"), m = document.getElementById("userMenu");
  const abrir = (si) => { m.hidden = !si; b.setAttribute("aria-expanded", si); };
  b.onclick = (e) => { e.stopPropagation(); abrir(m.hidden); };
  document.addEventListener("click", (e) => { if (!w.contains(e.target)) abrir(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { abrir(false); cerrarSeguridad(); } });
  document.getElementById("uSalir").onclick = () => cerrarSesion(false);
  document.getElementById("uTodas").onclick = () => cerrarSesion(true);
  document.getElementById("uSeg").onclick = () => { abrir(false); abrirSeguridad(); };
}

function cerrarSeguridad() { const s = document.getElementById("segModal"); if (s) s.remove(); }

function abrirSeguridad() {
  cerrarSeguridad();
  const s = estadoSesion || {};
  const fecha = (d) => (d ? new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d)) : "—");
  const div = document.createElement("div");
  div.className = "modal-bg open";
  div.id = "segModal";
  div.innerHTML = `<div class="modal seg" role="dialog" aria-modal="true" aria-labelledby="segT">
    <div class="seg-h"><i data-lucide="shield-check"></i><h3 id="segT">Seguridad de la cuenta</h3><button class="btn btn-icon btn-ghost" id="segX" aria-label="Cerrar"><i data-lucide="x"></i></button></div>
    <div class="seg-b">
      <div class="seg-kpi"><div><span>Usuario</span><b>${escS(s.usuario)}</b></div><div><span>Sesiones abiertas</span><b>${s.sesiones ?? "—"}</b></div><div><span>Esta sesión caduca</span><b>${fecha(s.caduca)}</b></div></div>
      <section><h4><i data-lucide="key-round"></i>Cambiar contraseña</h4>
        <form id="fClave" class="seg-f" autocomplete="on">
          <input type="text" autocomplete="username" value="${escS(s.usuario)}" hidden>
          <input class="field" type="password" id="cAct" placeholder="Contraseña actual" autocomplete="current-password">
          <input class="field" type="password" id="cNue" placeholder="Nueva contraseña (12+ caracteres, letras y números o símbolos)" autocomplete="new-password">
          <input class="field" type="password" id="cRep" placeholder="Repite la nueva contraseña" autocomplete="new-password">
          <button class="btn btn-primary btn-sm">Cambiar contraseña</button>
          <p class="hint">Al cambiarla se cierran las demás sesiones abiertas.</p>
        </form></section>
      <section><h4><i data-lucide="smartphone"></i>Verificación en dos pasos</h4><div id="dosPasos"></div></section>
      <div class="seg-msg" id="segMsg" role="status"></div>
    </div></div>`;
  document.body.appendChild(div);
  iconosS();
  const msg = (t, ok) => { const e = document.getElementById("segMsg"); e.className = "seg-msg " + (t ? (ok ? "ok" : "err") : ""); e.textContent = t || ""; };
  document.getElementById("segX").onclick = cerrarSeguridad;
  div.onclick = (e) => { if (e.target === div) cerrarSeguridad(); };

  document.getElementById("fClave").onsubmit = async (e) => {
    e.preventDefault(); msg("");
    const a = document.getElementById("cAct").value, n = document.getElementById("cNue").value, r = document.getElementById("cRep").value;
    if (!a || !n) return msg("Rellena la contraseña actual y la nueva.");
    if (n !== r) return msg("Las contraseñas nuevas no coinciden.");
    try { await sesionAPI("/api/v1/sesion/contrasena", "POST", { actual: a, nueva: n }); e.target.reset(); msg("Contraseña cambiada. Las demás sesiones se han cerrado.", true); estadoSesion.sesiones = 1; }
    catch (err) { msg(err.message); }
  };

  const dp = document.getElementById("dosPasos");
  const pintarDP = () => {
    if (estadoSesion.dos_pasos) {
      dp.innerHTML = `<p class="seg-ok"><i data-lucide="circle-check"></i>Activa. Te quedan ${estadoSesion.codigos_recuperacion} códigos de recuperación.</p>
        <form id="fDes" class="seg-f"><input class="field" type="password" id="dClave" placeholder="Contraseña" autocomplete="current-password"><input class="field" id="dCod" placeholder="Código de 6 cifras" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button class="btn btn-sm btn-danger">Desactivar</button></form>`;
      iconosS();
      document.getElementById("fDes").onsubmit = async (e) => {
        e.preventDefault(); msg("");
        try { await sesionAPI("/api/v1/sesion/2fa/desactivar", "POST", { contrasena: document.getElementById("dClave").value, codigo: document.getElementById("dCod").value }); estadoSesion.dos_pasos = false; pintarDP(); msg("Verificación en dos pasos desactivada.", true); }
        catch (err) { msg(err.message); }
      };
    } else {
      dp.innerHTML = `<p class="hint">Protege la cuenta aunque alguien conozca tu contraseña: además pedirá un código de tu móvil (Google Authenticator, Microsoft Authenticator, 1Password…).</p><button class="btn btn-sm btn-primary" id="dIni"><i data-lucide="qr-code"></i>Activar</button>`;
      iconosS();
      document.getElementById("dIni").onclick = async () => {
        msg("");
        try {
          const k = await sesionAPI("/api/v1/sesion/2fa/iniciar");
          dp.innerHTML = `<div class="seg-qr"><img src="${k.qr}" alt="Código QR para la aplicación de autenticación" width="180" height="180"><div>
            <ol><li>Escanea el código con tu aplicación de autenticación.</li><li>Si no puedes escanear, escribe esta clave: <code>${escS(k.secreto.replace(/(.{4})/g, "$1 ").trim())}</code></li><li>Escribe el código de 6 cifras que muestra.</li></ol>
            <form id="fAct" class="seg-f"><input class="field" id="aCod" placeholder="Código de 6 cifras" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button class="btn btn-sm btn-primary">Confirmar y activar</button></form></div></div>`;
          document.getElementById("aCod").focus();
          document.getElementById("fAct").onsubmit = async (e) => {
            e.preventDefault(); msg("");
            try {
              const r = await sesionAPI("/api/v1/sesion/2fa/activar", "POST", { codigo: document.getElementById("aCod").value });
              estadoSesion.dos_pasos = true; estadoSesion.codigos_recuperacion = r.recuperacion.length;
              dp.innerHTML = `<p class="seg-ok"><i data-lucide="circle-check"></i>Verificación en dos pasos activada.</p>
                <p><b>Guarda estos códigos de recuperación</b> en un lugar seguro. Cada uno sirve una sola vez si pierdes el móvil. No se volverán a mostrar.</p>
                <pre class="seg-cod" id="rCod">${r.recuperacion.map(escS).join("\n")}</pre><button class="btn btn-sm" id="rCop"><i data-lucide="copy"></i>Copiar códigos</button>`;
              iconosS();
              document.getElementById("rCop").onclick = () => navigator.clipboard && navigator.clipboard.writeText(r.recuperacion.join("\n")).then(() => msg("Códigos copiados.", true));
            } catch (err) { msg(err.message); }
          };
        } catch (err) { msg(err.message); }
      };
    }
  };
  pintarDP();
  document.getElementById("cAct").focus();
}

document.addEventListener("DOMContentLoaded", pintarUsuario);
