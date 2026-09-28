// Comparador de competencia: elige tu empresa y hasta 4 competidores, analiza a
// fondo sus webs y sus reseñas, y genera un informe corporativo con tu marca
// (vista en la app, HTML autónomo y PDF). Usa utilidades de index.html y analitica.js.
"use strict";

const COMP_MAX = 4;
const minus = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);
const pl = (n, uno, varios) => `${fmtN(n)} ${n === 1 ? uno : varios}`;
const clavePref = (id) => `gmaps.comp.${id}`;

function compEstado() {
  const id = S.res.job.ID;
  if (!S.res.comp) {
    let g = {};
    try { g = JSON.parse(localStorage.getItem(clavePref(id))) || {}; } catch (e) { g = {}; }
    S.res.comp = { mia: g.mia || "", rivales: g.rivales || null, criterio: g.criterio || "score", ambito: g.ambito || "consulta",
      marca: g.marca || {}, datos: null, cargando: false };
  }
  return S.res.comp;
}

function compGuardar() {
  const c = compEstado();
  c.consultado = false; // la selección ha cambiado: hay que traer sus datos
  localStorage.setItem(clavePref(S.res.job.ID), JSON.stringify({ mia: c.mia, rivales: c.rivales, criterio: c.criterio, ambito: c.ambito, marca: c.marca }));
}

const CRITERIOS = {
  score: ["Presencia digital", (m) => m.score],
  reputacion: ["Reputación (valoración × reseñas)", (m) => (m.l.rating || 0) * Math.log10((m.l.reviews || 0) + 1)],
  resenas: ["Nº de reseñas", (m) => m.l.reviews || 0],
};

// Ranking del mercado: los negocios de la búsqueda (de la misma categoría que el tuyo, si se pide).
function compRanking() {
  const c = compEstado();
  const todas = posiciones(S.res.leads.map(metricas));
  const mia = todas.find((m) => m.l.link === c.mia);
  let base = todas;
  // Competencia directa: los negocios que salieron en la misma consulta (mismo tipo de
  // negocio y zona), o los de su misma categoría de Google, o toda la búsqueda.
  if (mia && c.ambito !== "todos") {
    const f = c.ambito === "consulta" && mia.l.grupo ? (m) => m.l.grupo === mia.l.grupo : (m) => m.l.category === mia.l.category;
    const misma = todas.filter(f);
    if (misma.length >= 2) base = misma;
  }
  const f = CRITERIOS[c.criterio][1];
  return { mia, ranking: [...base].sort((a, b) => f(b) - f(a) || (b.l.reviews || 0) - (a.l.reviews || 0)) };
}

// Predeterminado: el nº 1 de la lista y los 3 inmediatamente por encima de ti;
// si no hay tantos (vas entre los primeros), los más cercanos por debajo.
function compPredeterminados() {
  const { mia, ranking } = compRanking();
  if (!mia) return [];
  const p = ranking.indexOf(mia);
  const sel = [];
  const add = (m) => { if (m && m !== mia && !sel.includes(m) && sel.length < COMP_MAX) sel.push(m); };
  add(ranking[0]);
  for (let i = p - 1; i >= Math.max(0, p - 3); i--) add(ranking[i]);
  for (let i = p + 1; sel.length < COMP_MAX && i < ranking.length; i++) add(ranking[i]);
  return sel.map((m) => m.l.link);
}

function compSeleccion() {
  const c = compEstado();
  const porLink = new Map(S.res.leads.map((l) => [l.link, l]));
  if (c.mia && !c.rivales) { c.rivales = compPredeterminados(); compGuardar(); }
  return { mia: porLink.get(c.mia) || null, rivales: (c.rivales || []).map((k) => porLink.get(k)).filter(Boolean) };
}

/* ================= vista de configuración ================= */
function pintarComparador() {
  const c = compEstado();
  if (!c.consultado && c.mia) { c.consultado = true; compSondear(true); }
  const { mia, rivales } = compSeleccion();
  const { ranking } = compRanking();
  const pos = (l) => { const i = ranking.findIndex((m) => m.l === l); return i >= 0 ? `#${i + 1}` : ""; };
  const d = c.datos;
  const analizando = d && d.estado === "analizando";
  const marca = marcaEfectiva();

  $("#panel").innerHTML = `
  <div class="cmp">
    <div class="cmp-cfg">
      <div class="cmp-blq">
        <h4>1 · Tu empresa</h4>
        <div class="ac"><input class="field" id="cmpMia" placeholder="Busca tu empresa en esta búsqueda…" value="${mia ? esc(mia.title) : ""}" autocomplete="off"><ul class="ac-list" id="cmpMiaL" hidden></ul></div>
        ${mia ? `<div class="hint">${esc(mia.category || "")} · ${esc(mia.address || "")} · posición ${pos(mia)} de ${ranking.length} por ${esc(CRITERIOS[c.criterio][0].toLowerCase())}</div>` : `<div class="hint">Elige tu negocio para compararlo con su competencia.</div>`}
      </div>
      <div class="cmp-blq">
        <h4>2 · Competencia <span class="none">(${rivales.length} de ${COMP_MAX}; mínimo 1)</span></h4>
        <div class="cmp-fila">
          <label class="lbl-in">Ordenar por <select class="field" id="cmpCrit">${Object.entries(CRITERIOS).map(([k, [t]]) => `<option value="${k}"${k === c.criterio ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label class="lbl-in">Entre <select class="field" id="cmpAmb">${[["consulta", "su misma consulta"], ["categoria", "su categoría de Google"], ["todos", "toda la búsqueda"]].map(([k, t]) => `<option value="${k}"${k === c.ambito ? " selected" : ""}>${t}</option>`).join("")}</select></label>
          <button class="btn btn-sm btn-ghost" id="cmpPred" title="El nº 1 de la lista y los 3 que están inmediatamente por encima de tu empresa"><i data-lucide="rotate-ccw"></i>Predeterminados</button>
        </div>
        <div class="cmp-rivales">${rivales.map((l) => `<span class="zona-chip"><span class="ac-t">${pos(l)}</span><b>${esc(l.title)}</b><span class="ac-c">${esc(l.category || "")} · ${l.rating ? num1(l.rating) + " ★ · " + fmtN(l.reviews) + " reseñas" : "sin reseñas"}</span>
          <button type="button" class="btn btn-icon btn-ghost" data-quitar-riv="${esc(l.link)}" title="Quitar"${rivales.length <= 1 ? " disabled" : ""}><i data-lucide="x"></i></button></span>`).join("") || `<p class="none" style="margin:0">Elige primero tu empresa.</p>`}</div>
        ${mia && rivales.length < COMP_MAX ? `<div class="ac" style="margin-top:8px"><input class="field" id="cmpAdd" placeholder="Añadir competidor…" autocomplete="off"><ul class="ac-list" id="cmpAddL" hidden></ul></div>` : ""}
      </div>
      <div class="cmp-blq">
        <h4>3 · Tu marca en el informe</h4>
        <div class="cmp-marca">
          <div class="cmp-logo" style="background:${marca.tono === "claro" ? marca.c1 : "#fff"}">${marca.logo ? `<img src="${marca.logo}" alt="">` : `<span class="none">Sin logo</span>`}</div>
          <div class="cmp-campos">
            <input class="field" id="cmpNombre" placeholder="Nombre de la empresa" value="${esc(marca.nombre)}">
            <div class="cmp-fila">
              <label class="lbl-in">Color principal <input type="color" id="cmpC1" value="${marca.c1}"></label>
              <label class="lbl-in">Secundario <input type="color" id="cmpC2" value="${marca.c2}"></label>
              <label class="btn btn-sm btn-ghost" style="margin:0"><i data-lucide="image-up"></i>Subir logo<input type="file" id="cmpLogo" accept="image/*" hidden></label>
            </div>
            <input class="field" id="cmpPor" placeholder="Preparado por (opcional)" value="${esc(c.marca.por || "")}">
          </div>
        </div>
        <div class="hint">El logotipo y los colores se detectan en tu web al analizar; puedes cambiarlos.</div>
      </div>
      <div class="cmp-acc">
        <button class="btn btn-primary" id="cmpGo"${!mia || !rivales.length || analizando ? " disabled" : ""}><i data-lucide="${analizando ? "loader-circle" : "scan-search"}"${analizando ? ' class="spin"' : ""}></i>${analizando ? `Analizando webs ${d.hechos} de ${d.total}…` : d ? "Actualizar análisis" : "Analizar y generar informe"}</button>
      </div>
    </div>
    <div class="cmp-inf" id="cmpInf">${mia && rivales.length ? (analizando ? `<div class="empty"><div class="ico"><i data-lucide="loader-circle" class="spin"></i></div><h3>Analizando a fondo las webs</h3><p>${d.hechos} de ${d.total} webs revisadas. El informe aparecerá al terminar, con todos los datos.</p></div>` : d ? `<div class="cmp-bar"><b>Informe</b><span class="none">Vista previa · así se descarga</span>
        <button class="btn btn-sm" id="cmpHTML"><i data-lucide="file-code"></i>Descargar HTML</button>
        <button class="btn btn-sm btn-primary" id="cmpPDF"><i data-lucide="file-text"></i>Descargar PDF</button></div>
        <iframe id="cmpFrame" title="Informe de competencia"></iframe>` : `<div class="empty"><div class="ico"><i data-lucide="scale"></i></div><h3>Listo para comparar</h3><p>Pulsa «Analizar y generar informe»: se revisarán a fondo las webs y las reseñas de los ${rivales.length + 1} negocios.</p></div>`)
      : `<div class="empty"><div class="ico"><i data-lucide="scale"></i></div><h3>Comparador de competencia</h3><p>Elige tu empresa: se propondrán como competencia el nº 1 de la lista y los 3 negocios inmediatamente por encima de ti.</p></div>`}</div>
  </div>`;
  icons();
  enlazarComparador();
  if (d && mia && rivales.length && !analizando) {
    const doc = informeHTML(modeloInforme());
    const fr = $("#cmpFrame");
    fr.srcdoc = doc;
    fr.onload = () => { try { fr.style.height = fr.contentDocument.documentElement.scrollHeight + 20 + "px"; } catch (e) { /* vista previa sin autoajuste */ } };
    $("#cmpHTML").onclick = () => descargar(new Blob([doc], { type: "text/html;charset=utf-8" }), nombreInforme() + ".html");
    $("#cmpPDF").onclick = () => descargarPDF(doc);
  }
}

function buscadorNegocios(inp, lista, excluir, alElegir) {
  if (!inp) return;
  const pintar = () => {
    const q = plano(inp.value.trim());
    const res = S.res.leads.filter((l) => !excluir.includes(l.link) && (!q || plano(l.title + " " + (l.category || "") + " " + (l.address || "")).includes(q))).slice(0, 10);
    lista.hidden = false;
    lista.innerHTML = res.map((l) => `<li data-link="${esc(l.link)}"><b>${esc(l.title)}</b><span class="ac-c">${esc(l.category || "")} · ${esc(l.address || "")}</span></li>`).join("") || `<li class="none">Sin coincidencias en esta búsqueda</li>`;
    lista.querySelectorAll("li[data-link]").forEach((li) => (li.onmousedown = (e) => { e.preventDefault(); lista.hidden = true; alElegir(li.dataset.link); }));
  };
  inp.onfocus = inp.oninput = pintar;
  inp.onblur = () => setTimeout(() => (lista.hidden = true), 150);
}

function enlazarComparador() {
  const c = compEstado();
  const rep = () => pintarComparador();
  buscadorNegocios($("#cmpMia"), $("#cmpMiaL"), [], (link) => { c.mia = link; c.rivales = null; c.datos = null; c.marca = { por: c.marca.por }; compGuardar(); rep(); });
  buscadorNegocios($("#cmpAdd"), $("#cmpAddL"), [c.mia, ...(c.rivales || [])], (link) => {
    if ((c.rivales || []).length >= COMP_MAX) return toast(`Máximo ${COMP_MAX} competidores`, true);
    c.rivales = [...(c.rivales || []), link]; compGuardar(); rep();
  });
  document.querySelectorAll("[data-quitar-riv]").forEach((b) => (b.onclick = () => {
    if (c.rivales.length <= 1) return toast("Tiene que quedar al menos un competidor", true);
    c.rivales = c.rivales.filter((k) => k !== b.dataset.quitarRiv); compGuardar(); rep();
  }));
  const crit = $("#cmpCrit"); if (crit) crit.onchange = () => { c.criterio = crit.value; c.rivales = null; compGuardar(); rep(); };
  const amb = $("#cmpAmb"); if (amb) amb.onchange = () => { c.ambito = amb.value; c.rivales = null; compGuardar(); rep(); };
  const pred = $("#cmpPred"); if (pred) pred.onclick = () => { c.rivales = null; compGuardar(); rep(); };
  const campo = (id, k) => { const el = $(id); if (el) el.onchange = () => { c.marca[k] = el.value; compGuardar(); rep(); }; };
  campo("#cmpNombre", "nombre"); campo("#cmpC1", "c1"); campo("#cmpC2", "c2"); campo("#cmpPor", "por");
  const logo = $("#cmpLogo");
  if (logo) logo.onchange = () => {
    const f = logo.files[0];
    if (!f) return;
    if (f.size > 600 * 1024) return toast("El logo debe pesar menos de 600 KB", true);
    const r = new FileReader();
    r.onload = () => { c.marca.logo = r.result; c.marca.tono = ""; compGuardar(); rep(); };
    r.readAsDataURL(f);
  };
  const go = $("#cmpGo"); if (go) go.onclick = () => compAnalizar();
}

/* ================= análisis ================= */
function compNegocios() {
  const { mia, rivales } = compSeleccion();
  return [mia, ...rivales].filter(Boolean);
}

async function compAnalizar() {
  const c = compEstado();
  const ns = compNegocios();
  const id = S.res.job.ID;
  try {
    await api(`/api/v1/jobs/${id}/comparador/iniciar`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webs: ns.map((l) => l.website).filter(Boolean), forzar: !!c.datos }) });
    // Datos de redes de todos (seguidores, actividad) si aún no se consultaron.
    if (S.res.social.status === "idle" && S.res.tech.status === "done") cargarSocial(id, true);
    compSondear(true);
  } catch (e) { toast("No se pudo iniciar el análisis: " + e.message, true); }
}

async function compSondear(repintar = false) {
  const c = compEstado();
  const id = S.res.job.ID;
  if (!S.res || S.res.job.ID !== id) return;
  try {
    const d = await api(`/api/v1/jobs/${id}/comparador/datos`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ negocios: compNegocios().map((l) => ({ link: l.link, titulo: l.title })) }) });
    if (!S.res || S.res.job.ID !== id) return;
    const antes = c.datos && JSON.stringify([c.datos.estado, c.datos.hechos, c.datos.estado_resenas]);
    // Sin análisis previo de esta búsqueda: se espera a que el usuario lo lance.
    c.datos = d.estado === "inactivo" && !Object.keys(d.webs || {}).length && !d.job_resenas ? null : d;
    c.cargando = false;
    if (S.res.tab === "comparador" && (repintar || antes !== JSON.stringify([d.estado, d.hechos, d.estado_resenas]))) pintarComparador();
    if (d.estado === "analizando" || ["pending", "working"].includes(d.estado_resenas)) setTimeout(() => compSondear(), 3000);
  } catch (e) { toast("No se pudo leer el análisis: " + e.message, true); }
}

/* ================= marca ================= */
function marcaEfectiva() {
  const c = compEstado();
  const { mia } = compSeleccion();
  const web = mia && c.datos && c.datos.webs && c.datos.webs[mia.website];
  const det = (web && web.marca) || {};
  const cols = det.colores || [];
  return {
    nombre: c.marca.nombre || (mia ? mia.title : ""),
    c1: c.marca.c1 || cols[0] || "#0f4c81",
    c2: c.marca.c2 || cols[1] || cols[0] || "#5b8def",
    logo: c.marca.logo || det.logo || "",
    tono: c.marca.logo ? c.marca.tono || "" : det.tono || "",
    por: c.marca.por || "",
  };
}

const lum = (hex) => {
  const v = parseInt(hex.slice(1), 16), f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(v >> 16 & 255) + 0.7152 * f(v >> 8 & 255) + 0.0722 * f(v & 255);
};
// Tono de marca oscurecido hasta que el texto blanco encima cumpla contraste 4,5:1.
function tonoLegible(hex) {
  let v = parseInt(hex.slice(1), 16), r = v >> 16 & 255, g = v >> 8 & 255, b = v & 255;
  for (let i = 0; i < 20 && 1.05 / (lum("#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)) + 0.05) < 4.5; i++) { r = Math.round(r * 0.88); g = Math.round(g * 0.88); b = Math.round(b * 0.88); }
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/* ================= modelo del informe ================= */
// Horas abiertas por semana a partir del horario de Google («9:00–14:00, 16:00–20:00», «9 a. m.–5 p. m.», «Abierto 24 horas»).
function horasSemana(hours) {
  if (!hours || !Object.keys(hours).length) return null;
  // Google lista los 7 días (los cerrados como «Cerrado»): si faltan días, el horario está incompleto.
  if (Object.keys(hours).length < 7) return { incompleto: true };
  let total = 0, dias = 0;
  const hora = (s) => {
    const m = plano(s).replace(/\s/g, "").match(/(\d{1,2})(?::(\d{2}))?(a\.?m\.?|p\.?m\.?)?/);
    if (!m) return null;
    let h = +m[1] + (m[2] ? +m[2] / 60 : 0);
    if (m[3] && m[3][0] === "p" && h < 12) h += 12;
    if (m[3] && m[3][0] === "a" && h === 12) h = 0;
    return h;
  };
  for (const v of Object.values(hours)) {
    const t = (v || []).join(",");
    if (/24\s*hor|24\s*hours|open 24/i.test(t)) { total += 24; dias++; continue; }
    let d = 0;
    for (const tramo of t.split(/,|;/)) {
      const [a, b] = tramo.split(/[–—-]|\sa\s(?=\d)|\bto\b/);
      if (!a || !b) continue;
      let ha = hora(a), hb = hora(b);
      if (ha == null || hb == null) continue;
      if (hb <= ha) hb += 24;
      d += hb - ha;
    }
    if (d > 0) { total += d; dias++; }
  }
  return { horas: Math.round(total * 10) / 10, dias };
}

function modeloInforme() {
  const c = compEstado();
  const { mia, rivales } = compSeleccion();
  const d = c.datos || { webs: {}, resenas: {}, senales: {} };
  const todas = posiciones(S.res.leads.map(metricas));
  const mDe = (l) => todas.find((m) => m.l === l);
  const { ranking } = compRanking();
  const neg = (l, i) => {
    const m = mDe(l);
    const w = d.webs[l.website] || null;
    const r = d.resenas[l.link] || { muestra: 0, aspectos: [], distribucion: [0, 0, 0, 0, 0], autenticidad: {} };
    const hs = horasSemana(l.hours);
    const tech = m.t && m.t.status === "ok" ? m.t : null;
    const senales = { ...((w && w.senales) || {}) };
    if (tech && (tech.chats || []).some((x) => x.kind !== "whatsapp")) senales.chat = (tech.chats || []).map((x) => x.name).join(", ");
    if (tech && (tech.chats || []).some((x) => x.kind === "ia")) senales.agente_ia = (tech.chats || []).filter((x) => x.kind === "ia").map((x) => x.name).join(", ");
    if ((l.reservations || []).length && !senales.reserva_online) senales.reserva_online = "Reservas desde Google: " + l.reservations.map((x) => x.source).join(", ");
    if ((l.order_online || []).length && !senales.delivery) senales.delivery = "Pedidos desde Google: " + l.order_online.map((x) => x.source).join(", ");
    if (esMovil(l.phone) && !senales.whatsapp) senales.whatsapp = "Teléfono móvil (WhatsApp) en Google";
    return {
      i, l, m, w, r, hs, senales, esMia: i === 0, nombre: l.title,
      posicion: ranking.findIndex((x) => x.l === l) + 1,
      negPct: r.muestra ? Math.round(((r.distribucion[0] + r.distribucion[1]) / r.muestra) * 1000) / 10 : null,
    };
  };
  const ns = [mia, ...rivales].map(neg);
  return { c, d, ns, marca: marcaEfectiva(), fecha: new Date(), totalMercado: ranking.length, busqueda: S.res.job, criterio: CRITERIOS[c.criterio][0], mercado: todas };
}

/* ---------- métricas comparables y diferencias significativas ---------- */
// alto: más es mejor; bajo: menos es mejor. sig(a, b): ¿diferencia significativa?
const METRICAS = [
  { g: "Reputación", k: "rating", t: "Valoración en Google", f: (n) => n.l.rating || null, fmt: (v) => num1(v) + " ★", alto: true, sig: (a, b, na, nb) => Math.abs(a - b) >= 0.2 && na.l.reviews >= 20 && nb.l.reviews >= 20 },
  { g: "Reputación", k: "reviews", t: "Nº de reseñas en Google", f: (n) => n.l.reviews || 0, fmt: (v) => fmtN(v), alto: true, sig: (a, b) => Math.max(a, b) >= 30 && Math.max(a, b) / Math.max(1, Math.min(a, b)) >= 1.5 },
  { g: "Reputación", k: "respuesta", t: "Reseñas respondidas por el propietario", f: (n) => (n.r.muestra ? n.r.pct_respuesta : null), fmt: (v) => pctTxt(v), alto: true, sig: (a, b) => Math.abs(a - b) >= 25 },
  { g: "Reputación", k: "negativas", t: "Reseñas negativas (1-2 ★) en la muestra", f: (n) => n.negPct, fmt: (v) => pctTxt(v), alto: false, sig: (a, b) => Math.abs(a - b) >= 10 },
  { g: "Presencia digital", k: "score", t: "Puntuación de presencia digital", f: (n) => n.m.score, fmt: (v) => v + "/100", alto: true, sig: (a, b) => Math.abs(a - b) >= 10 },
  { g: "Web", k: "webscore", t: "Salud técnica y SEO de la web", f: (n) => n.m.webScore, fmt: (v) => v + "/100", alto: true, sig: (a, b) => Math.abs(a - b) >= 15 },
  { g: "Web", k: "velocidad", t: "Tiempo de respuesta de la web", f: (n) => (n.m.w ? n.m.w.response_ms : null), fmt: (v) => fmtN(v) + " ms", alto: false, sig: (a, b) => Math.max(a, b) >= 1000 && Math.max(a, b) / Math.max(1, Math.min(a, b)) >= 1.5 },
  { g: "Marketing", k: "etiquetas", t: "Etiquetas de medición y publicidad", f: (n) => (n.m.webOk ? n.m.etiquetas : null), fmt: (v) => fmtN(v), alto: true, sig: (a, b) => Math.abs(a - b) >= 3 },
  { g: "Marketing", k: "publicidad", t: "Píxeles de publicidad instalados", f: (n) => (n.m.webOk ? n.m.publicidad : null), fmt: (v) => fmtN(v), alto: true, sig: (a, b) => (a === 0) !== (b === 0) || Math.abs(a - b) >= 2 },
  { g: "Redes", k: "seguidores", t: "Seguidores en redes", f: (n) => n.m.seguidores || null, fmt: (v) => fmtK(v), alto: true, sig: (a, b) => Math.max(a, b) >= 500 && Math.max(a, b) / Math.max(1, Math.min(a, b)) >= 2 },
  { g: "Redes", k: "dias", t: "Días desde su última publicación", f: (n) => n.m.dias, fmt: (v) => fmtN(v) + " días", alto: false, sig: (a, b) => (a <= 30) !== (b <= 30) || Math.abs(a - b) >= 60 },
  { g: "Redes", k: "engagement", t: "Engagement máximo", f: (n) => n.m.engMax, fmt: (v) => pctTxt(v), alto: true, sig: (a, b) => Math.max(a, b) >= 0.5 && Math.max(a, b) / Math.max(0.01, Math.min(a, b)) >= 2 },
  { g: "Oferta", k: "servicios", t: "Servicios publicados en su web", f: (n) => (n.w && n.w.estado === "ok" ? (n.w.servicios || []).length : null), fmt: (v) => fmtN(v), alto: true, sig: (a, b) => Math.abs(a - b) >= 5 },
  { g: "Oferta", k: "precios", t: "Precios publicados en su web", f: (n) => (n.w && n.w.estado === "ok" ? (n.w.precios || []).length : null), fmt: (v) => fmtN(v), alto: true, sig: (a, b) => (a === 0) !== (b === 0) },
  { g: "Modelo de trabajo", k: "senales", t: "Facilidades y herramientas detectadas", f: (n) => Object.keys(n.senales).length, fmt: (v) => fmtN(v), alto: true, sig: (a, b) => Math.abs(a - b) >= 3 },
  { g: "Modelo de trabajo", k: "horas", t: "Horas abiertas a la semana", f: (n) => (n.hs && !n.hs.incompleto ? n.hs.horas : null), fmt: (v) => num1(v) + " h", alto: true, sig: (a, b) => Math.abs(a - b) >= 8 },
];

function evaluar(mo) {
  const [yo, ...rv] = mo.ns;
  const filas = METRICAS.map((mt) => {
    const vals = mo.ns.map((n) => { const v = mt.f(n); return v == null || Number.isNaN(v) ? null : v; });
    const con = vals.filter((v) => v != null);
    const mejor = con.length ? (mt.alto ? Math.max(...con) : Math.min(...con)) : null;
    const peor = con.length ? (mt.alto ? Math.min(...con) : Math.max(...con)) : null;
    const vr = vals.slice(1).filter((v) => v != null);
    const media = vr.length ? vr.reduce((a, b) => a + b, 0) / vr.length : null;
    const yoV = vals[0];
    let estado = "sin datos";
    if (yoV != null && vr.length) {
      const mejorQue = (a, b) => (mt.alto ? a > b : a < b);
      const lider = rv.map((n, i) => ({ n, v: vals[i + 1] })).filter((x) => x.v != null).sort((a, b) => (mt.alto ? b.v - a.v : a.v - b.v))[0];
      const sigLider = lider && mt.sig(yoV, lider.v, yo, lider.n);
      if (yoV === mejor && (!lider || mejorQue(yoV, lider.v)) && sigLider) estado = "lidera";
      else if (yoV === mejor) estado = "a la par";
      else if (sigLider && mejorQue(lider.v, yoV)) estado = yoV === peor ? "último" : "por detrás";
      else estado = "a la par";
    }
    return { mt, vals, mejor, peor, media, estado };
  });
  return filas;
}

// Servicios parecidos entre webs (mismas palabras significativas): «Corte de pelo» ≈ «Corte pelo mujer».
function mismoServicio(a, b) {
  const ws = (s) => new Set(plano(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2 && !["con", "para", "los", "las", "del", "and", "the", "for", "your"].includes(w)));
  const A = ws(a), B = ws(b);
  if (!A.size || !B.size) return false;
  let comun = 0;
  A.forEach((w) => { if (B.has(w)) comun++; });
  return comun / Math.min(A.size, B.size) >= 0.67;
}

function diagnostico(mo, filas) {
  const [yo, ...rv] = mo.ns;
  const bueno = [], mejorar = [], innovar = [];
  const nomb = (xs) => xs.map((n) => n.nombre).join(", ");
  for (const f of filas) {
    const { mt, vals } = f;
    if (vals[0] == null) continue;
    const lider = rv.map((n, i) => ({ n, v: vals[i + 1] })).filter((x) => x.v != null).sort((a, b) => (mt.alto ? b.v - a.v : a.v - b.v))[0];
    if (!lider) continue;
    if (f.estado === "lidera") bueno.push({ p: 2, t: `Lideras en ${minus(mt.t)}`, d: `${mt.fmt(vals[0])} frente a ${mt.fmt(lider.v)} de ${lider.n.nombre}, el mejor de tu competencia.` });
    if (f.estado === "último" || f.estado === "por detrás") mejorar.push({ p: f.estado === "último" ? 1 : 2, t: `${mt.t}: ${f.estado === "último" ? "eres el último" : "por detrás"}`, d: `Tienes ${mt.fmt(vals[0])}; ${lider.n.nombre} alcanza ${mt.fmt(lider.v)}${f.media != null ? ` (media de tu competencia: ${mt.fmt(Math.round(f.media * 10) / 10)})` : ""}.` });
  }
  // Voz del cliente: aspectos que te distinguen y quejas.
  const pctPos = (a) => (a && a.menciones ? a.positivas / a.menciones : null);
  const aspectoDe = (n, k) => (n.r.aspectos || []).find((a) => a.clave === k);
  const claves = [...new Set(mo.ns.flatMap((n) => (n.r.aspectos || []).map((a) => a.clave)))];
  for (const k of claves) {
    const mio = aspectoDe(yo, k);
    const rivalesA = rv.map((n) => aspectoDe(n, k)).filter((a) => a && a.menciones >= 2);
    if (mio && mio.menciones >= 3) {
      const p = pctPos(mio), pm = rivalesA.length ? rivalesA.reduce((s, a) => s + pctPos(a), 0) / rivalesA.length : null;
      if (p >= 0.8 && (pm == null || p - pm >= 0.1)) bueno.push({ p: 2, t: `Tus clientes destacan: ${minus(mio.nombre)}`, d: `${Math.round(p * 100)} % de ${pl(mio.menciones, "mención", "menciones")} positivas${pm != null ? ` (competencia: ${Math.round(pm * 100)} %)` : ""}${mio.ejemplo_pos ? `. «${mio.ejemplo_pos}»` : "."}` });
      if (mio.negativas >= 2 || (mio.negativas >= 1 && pm != null && p < pm - 0.2)) mejorar.push({ p: 1, t: `Quejas sobre ${minus(mio.nombre)}`, d: `${mio.negativas} de ${pl(mio.menciones, "mención", "menciones")} ${mio.negativas === 1 ? "es negativa" : "son negativas"}${mio.ejemplo_neg ? `: «${mio.ejemplo_neg}»` : "."}` });
    }
  }
  if (yo.r.muestra && yo.r.pct_respuesta < 50 && rv.some((n) => n.r.pct_respuesta >= 50)) mejorar.push({ p: 1, t: "Responde a tus reseñas", d: `Respondes al ${pctTxt(yo.r.pct_respuesta)} de las reseñas analizadas; ${nomb(rv.filter((n) => n.r.pct_respuesta >= 50))} responden a la mayoría.` });
  // Herramientas y modelo de trabajo.
  const nombresS = { ...mo.d.senales, chat: "Chat en la web", agente_ia: "Agente IA en la web" };
  const todasS = Object.keys(nombresS);
  for (const k of todasS) {
    const tengo = !!yo.senales[k];
    const quienes = rv.filter((n) => n.senales[k]);
    if (tengo && quienes.length === 0) bueno.push({ p: 3, t: `Solo tú ofreces: ${minus(nombresS[k])}`, d: `Ninguno de tus ${rv.length} competidores lo muestra. ${yo.senales[k] ? `Evidencia: «${yo.senales[k]}».` : ""}` });
    if (!tengo && quienes.length >= Math.max(1, Math.ceil(rv.length / 2))) mejorar.push({ p: quienes.length === rv.length ? 1 : 2, t: `Te falta: ${minus(nombresS[k])}`, d: `Lo ofrecen ${quienes.length} de ${rv.length}: ${nomb(quienes)}.` });
  }
  // Servicios que la competencia publica y tú no.
  const misServ = (yo.w && yo.w.servicios) || [];
  const cuenta = [];
  rv.forEach((n) => ((n.w && n.w.servicios) || []).forEach((s) => {
    if (misServ.some((x) => mismoServicio(x, s))) return;
    const e = cuenta.find((x) => mismoServicio(x.s, s));
    if (e) { if (!e.q.includes(n)) e.q.push(n); } else cuenta.push({ s, q: [n] });
  }));
  cuenta.filter((x) => x.q.length >= 2).slice(0, 6).forEach((x) => mejorar.push({ p: 2, t: `Servicio que publican ${x.q.length} competidores y tú no: «${x.s}»`, d: `Lo ofrecen ${nomb(x.q)}. Si lo ofreces, publícalo en tu web; si no, valora incorporarlo.` }));
  // Innovar: lo que nadie del grupo tiene, adopción en el mercado y quejas del sector.
  const mercado = mo.mercado.filter((m) => m.webOk);
  const adop = (fn) => (mercado.length ? Math.round((mercado.filter(fn).length / mercado.length) * 100) : null);
  const sinNadie = todasS.filter((k) => !mo.ns.some((n) => n.senales[k]));
  const utiles = ["reserva_online", "agente_ia", "chat", "whatsapp", "pago_online", "presupuesto", "primera_gratis", "fidelizacion", "bonos", "regalo", "financiacion", "testimonios", "idiomas", "garantia", "domicilio", "tienda_online"];
  for (const k of utiles.filter((k) => sinNadie.includes(k)).slice(0, 5)) {
    const extra = k === "agente_ia" ? adop((m) => (m.t.chats || []).some((x) => x.kind === "ia")) : k === "chat" ? adop((m) => (m.t.chats || []).some((x) => x.kind !== "whatsapp")) : null;
    innovar.push({ p: 2, t: `Sé el primero: ${minus(nombresS[k])}`, d: `Ninguno de los ${mo.ns.length} negocios comparados lo ofrece${extra != null ? ` (en toda la búsqueda solo lo tiene el ${extra} % de las webs)` : ""}. Es una forma directa de diferenciarte.` });
  }
  const quejas = {};
  rv.forEach((n) => (n.r.aspectos || []).forEach((a) => { if (a.negativas >= 1) { quejas[a.clave] = quejas[a.clave] || { nombre: a.nombre, n: 0, quien: [] }; quejas[a.clave].n += a.negativas; quejas[a.clave].quien.push(n.nombre); } }));
  Object.values(quejas).filter((q) => q.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3).forEach((q) => innovar.push({ p: 1, t: `Convierte en ventaja: ${minus(q.nombre)}`, d: `Es una queja de los clientes de ${q.quien.join(", ")} (${pl(q.n, "mención negativa", "menciones negativas")}). Hazlo visible como compromiso propio en tu web, tus redes y tus respuestas.` }));
  if (!rv.concat(yo).some((n) => n.w && (n.w.precios || []).length)) innovar.push({ p: 2, t: "Transparencia de precios", d: "Nadie del grupo publica precios en su web. Publicar precios orientativos (o «desde») reduce la fricción y atrae a quien compara." });
  const orden = (a, b) => a.p - b.p;
  return { bueno: bueno.sort(orden), mejorar: mejorar.sort(orden), innovar: innovar.sort(orden) };
}

/* ================= visión ejecutiva: índice, brechas, recorrido y hoja de ruta ================= */
const acotar = (x) => Math.max(0, Math.min(1, x));
const tieneAlguna = (n, ks) => ks.some((k) => n.senales[k]);

// Seis áreas puntuadas de 0 a 100 con reglas fijas y públicas (ver metodología).
const AREAS = [
  { k: "reputacion", t: "Reputación en Google", s: "Reputación y reseñas", f: (n) => (n.l.rating || n.l.reviews ? Math.round(acotar(((n.l.rating || 0) - 3.5) / 1.5) * 60 + acotar(Math.log10((n.l.reviews || 0) + 1) / 3) * 40) : 0) },
  { k: "atencion", t: "Atención a los clientes", s: "Reputación y reseñas", f: (n) => (n.r.muestra ? Math.round((n.r.pct_respuesta / 100) * 60 + (1 - (n.negPct || 0) / 100) * 40) : null) },
  { k: "web", t: "Web y posicionamiento (SEO)", s: "Web, SEO y rendimiento", f: (n) => (!n.l.website ? 0 : n.w && n.w.estado === "plataforma" ? 15 : n.m.webScore) },
  { k: "marketing", t: "Medición y publicidad digital", s: "Medición y publicidad digital", f: (n) => {
    if (!n.l.website) return 0;
    if (!n.m.webOk) return null;
    const x = n.m.nombres, t = n.m.tags;
    return (n.m.medicion ? 25 : 0) + (x.has("Píxel de Meta") ? 25 : 0) + (t.some((g) => g.cat === "publicidad" && g.name !== "Píxel de Meta") ? 25 : 0) + (x.has("Google Tag Manager") ? 15 : 0) + (t.some((g) => g.cat === "comportamiento") ? 10 : 0);
  } },
  { k: "redes", t: "Redes sociales", s: "Redes sociales y contenidos", f: (n) => {
    if (!n.m.nRedes) return 0;
    return Math.round((Math.min(n.m.nRedes, 3) / 3) * 30 + acotar(Math.log10(n.m.seguidores + 1) / 4) * 35 + ({ activo: 35, poco: 18, inactivo: 0, sin: 10 }[n.m.actividad]));
  } },
  { k: "canales", t: "Canales de contacto y venta", s: "Atención y ventas conversacionales", f: (n) => {
    const grupos = [["reserva_online"], ["whatsapp"], ["chat", "agente_ia"], ["pago_online", "tienda_online"], ["presupuesto", "primera_gratis"], ["promociones", "fidelizacion", "bonos", "regalo"]];
    const horario = n.hs && !n.hs.incompleto && n.hs.horas >= 50 ? 1 : 0;
    return Math.round(((grupos.filter((g) => tieneAlguna(n, g)).length + horario) / 7) * 100);
  } },
];

function areasCompetitivas(mo) {
  const [yo, ...rv] = mo.ns;
  const res = AREAS.map((a) => {
    const vals = mo.ns.map((n) => { const v = a.f(n); return v == null || Number.isNaN(v) ? null : Math.max(0, Math.min(100, v)); });
    const riv = vals.slice(1).filter((v) => v != null);
    const mejor = riv.length ? Math.max(...riv) : null;
    const media = riv.length ? riv.reduce((s, v) => s + v, 0) / riv.length : null;
    const lider = riv.length ? rv[vals.slice(1).indexOf(mejor)] : null;
    let estado = "sin datos";
    if (vals[0] != null && media != null) estado = vals[0] >= mejor && vals[0] > media + 5 ? "ventaja" : vals[0] < media - 10 || vals[0] < mejor - 25 ? "desventaja" : "a la par";
    return { ...a, vals, mejor, media, lider, estado, brecha: vals[0] != null && mejor != null ? Math.round(mejor - vals[0]) : null };
  });
  const indice = (i) => { const v = res.map((a) => a.vals[i]).filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : 0; };
  const indices = mo.ns.map((_, i) => indice(i));
  return { areas: res, indices, yo, rv };
}

// Recorrido del cliente: en qué etapa ganas o pierdes clientes frente a tu competencia.
function recorrido(mo, ac) {
  const val = (k) => ac.areas.find((a) => a.k === k);
  const etapa = (t, sub, partes, extra) => {
    const us = partes.map((p) => p.vals[0]).filter((v) => v != null);
    const ms = partes.map((p) => p.media).filter((v) => v != null);
    const bs = partes.map((p) => p.mejor).filter((v) => v != null);
    const yo = us.length ? us.reduce((s, v) => s + v, 0) / us.length : null;
    const media = ms.length ? ms.reduce((s, v) => s + v, 0) / ms.length : null;
    const mejor = bs.length ? bs.reduce((s, v) => s + v, 0) / bs.length : null;
    const estado = yo == null || media == null ? "sin datos" : yo >= mejor && yo > media + 5 ? "ventaja" : yo < media - 10 || yo < mejor - 25 ? "desventaja" : "a la par";
    return { t, sub, estado, yo, media, extra: extra() };
  };
  const [yo, ...rv] = mo.ns;
  const cuantos = (fn) => rv.filter(fn).length;
  return [
    etapa("Te encuentran", "Google Maps y buscadores", [val("reputacion"), val("web")], () => `${fmtN(yo.l.reviews || 0)} reseñas frente a ${fmtN(Math.max(...rv.map((n) => n.l.reviews || 0)))} del más visible`),
    etapa("Te evalúan", "Web, reseñas y respuestas", [val("web"), val("atencion")], () => yo.r.muestra ? `Respondes al ${pctTxt(yo.r.pct_respuesta)} de las reseñas; ${cuantos((n) => n.r.pct_respuesta >= 50)} de ${rv.length} competidores responden a la mayoría` : "Sin reseñas con texto que analizar"),
    etapa("Te contactan", "WhatsApp, chat, reservas y horario", [val("canales")], () => `${cuantos((n) => tieneAlguna(n, ["reserva_online"]))} de ${rv.length} competidores permiten reservar online${yo.senales.reserva_online ? " (tú también)" : "; tú no"}`),
    etapa("Te eligen", "Precios, ofertas y pago", [val("canales"), val("marketing")], () => `${cuantos((n) => n.w && (n.w.precios || []).length)} de ${rv.length} publican precios${yo.w && (yo.w.precios || []).length ? " (tú también)" : "; tú no"}`),
    etapa("Vuelven y recomiendan", "Redes, fidelización y reputación", [val("redes"), val("atencion")], () => `Tu actividad en redes: ${ACTIVIDAD[yo.m.actividad].toLowerCase()}; ${cuantos((n) => n.m.actividad === "activo")} de ${rv.length} competidores han publicado en los últimos 30 días`),
  ];
}

// Acciones por área: horizonte, qué hacer, KPI objetivo y línea de servicio.
function hojaDeRuta(mo, ac) {
  const [yo] = mo.ns;
  const acciones = [];
  const a = Object.fromEntries(ac.areas.map((x) => [x.k, x]));
  const objetivo = (x) => (x.lider ? `igualar a ${x.lider.nombre} (${Math.round(x.mejor)}/100 en ${minus(x.t)})` : "situarse por encima de la media");
  const add = (h, area, t, kpi) => acciones.push({ h, area, t, kpi, s: a[area].s });
  if (a.atencion.estado === "desventaja" || (yo.r.muestra && yo.r.pct_respuesta < 80)) add(0, "atencion", "Responder a todas las reseñas en menos de 48 horas, con un protocolo para las negativas", `Tasa de respuesta del ${pctTxt(yo.r.pct_respuesta || 0)} al 100 %`);
  if (!yo.senales.whatsapp || !tieneAlguna(yo, ["chat", "agente_ia"])) add(0, "canales", "Activar WhatsApp Business y chat en la web para no perder ninguna consulta", "Responder cada consulta en menos de 5 minutos");
  if (a.marketing.estado !== "ventaja" && (a.marketing.vals[0] ?? 0) < 75) add(0, "marketing", "Instalar la medición completa: Google Analytics 4, Tag Manager y píxeles de Meta y Google Ads", `Pasar de ${a.marketing.vals[0] ?? 0}/100 a ≥ 75/100 en medición`);
  if (a.reputacion.estado !== "ventaja") add(1, "reputacion", "Programa sistemático de solicitud de reseñas a cada cliente satisfecho", `${objetivo(a.reputacion)}`);
  if (a.web.estado !== "ventaja" && (a.web.vals[0] ?? 0) < 90) add(1, "web", "Mejorar la web: velocidad, SEO local, datos estructurados y adaptación a móvil", `Salud web de ${a.web.vals[0] ?? 0}/100 a ≥ 90/100`);
  if (!yo.senales.reserva_online) add(1, "canales", "Reserva o cita online integrada en la web y en Google", "Reservas online activas en 30 días");
  if (!(yo.w && (yo.w.precios || []).length)) add(1, "canales", "Publicar servicios con precios «desde» para reducir la fricción al comparar", "Página de servicios y precios publicada");
  if (a.redes.estado !== "ventaja") add(1, "redes", "Calendario de contenidos: al menos 3 publicaciones a la semana en las redes con más público", `${objetivo(a.redes)}`);
  if (!yo.senales.agente_ia) add(2, "canales", "Agente de IA que atienda, cualifique y reserve 24/7 por web y WhatsApp", "Atención 24/7 sin aumentar plantilla");
  if (!tieneAlguna(yo, ["fidelizacion", "bonos", "regalo"])) add(2, "canales", "Programa de fidelización, bonos o tarjetas regalo para aumentar la recurrencia", "Clientes que repiten en 90 días");
  if (a.marketing.estado !== "ventaja") add(2, "marketing", "Campañas de captación medidas (Google y Meta) con el público de la zona", "Coste por cliente conocido y decreciente");
  add(2, "reputacion", "Repetir este análisis cada trimestre para medir el avance frente a la competencia", `Índice competitivo de ${ac.indices[0]} a ≥ ${Math.min(100, Math.max(...ac.indices) + 5)}`);
  return acciones;
}

const colorEstado = { ventaja: "var(--ok)", "a la par": "#b45309", desventaja: "var(--mal)", "sin datos": "#94a3b8" };
const textoEstado = { ventaja: "▲ Ventaja", "a la par": "● A la par", desventaja: "▼ Desventaja", "sin datos": "— Sin datos" };

// Mapa de brechas: por área, rango de la competencia, su media y tu posición (0-100).
function svgBrechas(mo, ac) {
  const W = 700, izq = 190, der = 110, fila = 46, H = ac.areas.length * fila + 40, x = (v) => izq + (v / 100) * (W - izq - der);
  const eje = [0, 25, 50, 75, 100].map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="10" y2="${H - 26}" stroke="#e2e8f0"/><text x="${x(v)}" y="${H - 10}" text-anchor="middle" class="ax">${v}</text>`).join("");
  const filas = ac.areas.map((a, i) => {
    const y = 26 + i * fila, riv = a.vals.slice(1).filter((v) => v != null), yo = a.vals[0];
    const rango = riv.length ? `<line x1="${x(Math.min(...riv))}" x2="${x(Math.max(...riv))}" y1="${y}" y2="${y}" stroke="#cbd5e1" stroke-width="8" stroke-linecap="round"/>` : "";
    const puntos = riv.map((v) => `<circle cx="${x(v)}" cy="${y}" r="4.5" fill="#94a3b8" stroke="#fff" stroke-width="2"/>`).join("");
    const media = a.media != null ? `<line x1="${x(a.media)}" x2="${x(a.media)}" y1="${y - 11}" y2="${y + 11}" stroke="#475569" stroke-width="2"/>` : "";
    const mio = yo != null ? `<circle cx="${x(yo)}" cy="${y}" r="8" fill="var(--m1)" stroke="#fff" stroke-width="2.5"><title>Tu empresa: ${yo}/100</title></circle><text x="${x(yo)}" y="${y - 14}" text-anchor="middle" class="vy">${yo}</text>` : `<text x="${izq}" y="${y + 4}" class="ax">sin datos</text>`;
    return `<text x="${izq - 12}" y="${y + 4}" text-anchor="end" class="lb">${eH(a.t)}</text>${rango}${puntos}${media}${mio}
      <text x="${W - der + 14}" y="${y + 4}" class="est" fill="${colorEstado[a.estado]}">${textoEstado[a.estado]}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Mapa de brechas por área">${eje}${filas}</svg>
    <div class="ley"><span><i class="c yo"></i>Tu empresa</span><span><i class="c riv"></i>Cada competidor</span><span><i class="r"></i>Rango de la competencia</span><span><i class="m"></i>Media de la competencia</span></div>`;
}

// Ranking del índice competitivo (0-100).
function svgRanking(mo, ac) {
  const orden = mo.ns.map((n, i) => ({ n, v: ac.indices[i] })).sort((a, b) => b.v - a.v);
  const W = 700, izq = 270, fila = 34, H = orden.length * fila + 8;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Ranking del índice competitivo">${orden.map((o, i) => {
    const y = i * fila + 6, w = Math.max(3, (o.v / 100) * (W - izq - 70));
    const nom = o.n.nombre.length > 32 ? o.n.nombre.slice(0, 31) + "…" : o.n.nombre;
    return `<text x="8" y="${y + 17}" class="pos">${i + 1}º</text><text x="${izq - 10}" y="${y + 17}" text-anchor="end" class="lb${o.n.esMia ? " yo" : ""}">${eH(nom)}</text>
      <path d="M${izq} ${y + 5}h${w - 4}a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-${w - 4}z" fill="${o.n.esMia ? "var(--m1)" : "#94a3b8"}"/><text x="${izq + w + 8}" y="${y + 18}" class="vy">${o.v}</text>`;
  }).join("")}</svg>`;
}

// Diagrama de flujo del recorrido del cliente (HTML: el texto se ajusta a cada caja).
function flujoRecorrido(etapas) {
  const cls = { ventaja: "ok", "a la par": "par", desventaja: "mal", "sin datos": "nd" };
  return `<div class="flujo">${etapas.map((e, i) => `<div class="paso ${cls[e.estado]}">
      <div class="pn">${i + 1}</div><b>${eH(e.t)}</b><span class="ps">${eH(e.sub)}</span>
      <span class="pe">${textoEstado[e.estado]}</span><p>${eH(e.extra)}</p></div>${i < etapas.length - 1 ? '<div class="flecha">➜</div>' : ""}`).join("")}</div>`;
}

// Ciclo de mejora continua.
function svgCiclo() {
  const pasos = [["Medir", "Datos reales"], ["Comparar", "Frente a los mejores"], ["Mejorar", "Acciones priorizadas"], ["Escalar", "Automatizar y crecer"]];
  const cx = 260, cy = 165, r = 100;
  const nodos = pasos.map(([t, d], i) => {
    const ang = -Math.PI / 2 + (i * Math.PI) / 2, x = cx + r * Math.cos(ang), y = cy + r * Math.sin(ang);
    const tx = x, anc = "middle", ty = y + 50;
    return `<circle cx="${x}" cy="${y}" r="34" fill="var(--m1)"/><text x="${x}" y="${y + 5}" text-anchor="middle" class="cn">${t}</text><text x="${tx}" y="${ty}" text-anchor="${anc}" class="cd">${eH(d)}</text>`;
  }).join("");
  const arco = [0, 1, 2, 3].map((i) => {
    const a1 = -Math.PI / 2 + (i * Math.PI) / 2 + 0.42, a2 = a1 + Math.PI / 2 - 0.84;
    const p = (a) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
    return `<path d="M${p(a1)} A${r} ${r} 0 0 1 ${p(a2)}" fill="none" stroke="var(--m2)" stroke-width="3" marker-end="url(#fl)"/>`;
  }).join("");
  return `<svg viewBox="80 20 360 330" width="100%" role="img" aria-label="Ciclo de mejora continua"><defs><marker id="fl" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--m2)"/></marker></defs>${arco}${nodos}<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="cc">Mejora</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" class="cc">continua</text></svg>`;
}

/* ================= informe HTML autónomo ================= */
const eH = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function nombreInforme() {
  const m = marcaEfectiva();
  return `Análisis competitivo - ${m.nombre || "empresa"} - ${new Date().toISOString().slice(0, 10)}`;
}

// Barras horizontales por negocio: la empresa en el color de marca, la competencia en gris.
function barrasSVG(mo, mt, vals) {
  const con = vals.map((v, i) => ({ v, n: mo.ns[i] })).filter((x) => x.v != null);
  if (!con.length) return `<p class="nd">Sin datos para comparar.</p>`;
  const max = Math.max(...con.map((x) => x.v), mt.alto ? 0 : 1) || 1;
  const fila = 26, anch = 440, eti = 170;
  const alto = mo.ns.length * fila + 4;
  const filas = mo.ns.map((n, i) => {
    const v = vals[i], y = i * fila + 4, w = v == null ? 0 : Math.max(2, (v / max) * (anch - eti - 70));
    const color = n.esMia ? "var(--m1)" : ["#64748b", "#94a3b8", "#a8b3c2", "#cbd5e1"][Math.min(3, i - 1)];
    const nom = n.nombre.length > 26 ? n.nombre.slice(0, 25) + "…" : n.nombre;
    return `<text x="${eti - 8}" y="${y + 14}" text-anchor="end" class="svl${n.esMia ? " yo" : ""}">${eH(nom)}</text>
      ${v == null ? `<text x="${eti}" y="${y + 14}" class="svn">sin datos</text>` : `<path d="M${eti} ${y + 3}h${w - 4}a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-${w - 4}z" fill="${color}"><title>${eH(n.nombre)}: ${eH(mt.fmt(v))}</title></path><text x="${eti + w + 6}" y="${y + 14}" class="svv">${eH(mt.fmt(v))}</text>`}`;
  }).join("");
  return `<svg viewBox="0 0 ${anch} ${alto}" width="100%" role="img" aria-label="${eH(mt.t)}">${filas}</svg>`;
}

function informeHTML(mo) {
  const mc = mo.marca, filas = evaluar(mo), dg = diagnostico(mo, filas);
  const [yo, ...rv] = mo.ns;
  const m1 = tonoLegible(mc.c1), m2 = mc.c2;
  const fecha = new Intl.DateTimeFormat("es", { dateStyle: "long" }).format(mo.fecha);
  const zonas = ((mo.busqueda.Data || {}).zonas || []).map((z) => z.nombre).join(", ");
  const est = { lidera: ["▲ Lidera", "ok"], "a la par": ["● A la par", "neu"], "por detrás": ["▼ Por detrás", "mal"], "último": ["▼ Último", "mal"], "sin datos": ["— Sin datos", "nd"] };
  const cuenta = (e) => filas.filter((f) => f.estado === e).length;
  const logoHTML = mc.logo ? `<div class="logo${mc.tono === "claro" ? " sobre" : ""}"><img src="${mc.logo}" alt="${eH(mc.nombre)}"></div>` : "";
  const cols = mo.ns.map((n) => `<th class="${n.esMia ? "yo" : ""}">${eH(n.nombre)}${n.esMia ? "<small>Tu empresa</small>" : `<small>#${n.posicion} del mercado</small>`}</th>`).join("");
  const celda = (f, i) => {
    const v = f.vals[i];
    if (v == null) return `<td class="nd">—</td>`;
    const cls = f.mejor !== f.peor && v === f.mejor ? "best" : f.mejor !== f.peor && v === f.peor ? "worst" : "";
    return `<td class="${cls}${i === 0 ? " yo" : ""}">${eH(f.mt.fmt(v))}${cls === "best" ? ' <span class="tag ok">mejor</span>' : cls === "worst" ? ' <span class="tag mal">peor</span>' : ""}</td>`;
  };
  const grupos = [...new Set(METRICAS.map((m) => m.g))];
  const lista = (xs, vacio) => (xs.length ? `<ol class="dx">${xs.map((x) => `<li><b>${eH(x.t)}</b><span>${eH(x.d)}</span></li>`).join("")}</ol>` : `<p class="nd">${vacio}</p>`);
  const aspectosTabla = () => {
    const claves = [...new Set(mo.ns.flatMap((n) => (n.r.aspectos || []).map((a) => a.clave)))];
    if (!claves.length) return `<p class="nd">Las reseñas disponibles no contienen suficiente texto para analizar aspectos.</p>`;
    const nombreA = (k) => (mo.ns.flatMap((n) => n.r.aspectos || []).find((a) => a.clave === k) || {}).nombre;
    return `<table class="tb"><thead><tr><th>Aspecto que mencionan</th>${cols}</tr></thead><tbody>${claves.map((k) => `<tr><td>${eH(nombreA(k))}</td>${mo.ns.map((n) => {
      const a = (n.r.aspectos || []).find((x) => x.clave === k);
      if (!a) return `<td class="nd${n.esMia ? " yo" : ""}">—</td>`;
      const p = Math.round((a.positivas / a.menciones) * 100);
      return `<td class="${p >= 80 ? "best" : p < 50 ? "worst" : ""}${n.esMia ? " yo" : ""}">${p} % positivo<small>${pl(a.menciones, "mención", "menciones")} · ${pl(a.negativas, "negativa", "negativas")}</small></td>`;
    }).join("")}</tr>`).join("")}</tbody></table>`;
  };
  const senalesTabla = () => {
    const nombresS = { ...mo.d.senales, chat: "Chat en la web", agente_ia: "Agente IA en la web" };
    const ks = Object.keys(nombresS).filter((k) => mo.ns.some((n) => n.senales[k]));
    if (!ks.length) return `<p class="nd">No se detectaron herramientas ni facilidades publicadas.</p>`;
    return `<table class="tb"><thead><tr><th>Facilidad o herramienta</th>${cols}</tr></thead><tbody>${ks.map((k) => `<tr><td>${eH(nombresS[k])}</td>${mo.ns.map((n) => `<td class="${n.senales[k] ? "si" : "no"}${n.esMia ? " yo" : ""}" title="${eH(n.senales[k] || "")}">${n.senales[k] ? "✓ Sí" : "✗ No"}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  const serviciosTabla = () => {
    const union = [];
    mo.ns.forEach((n) => ((n.w && n.w.servicios) || []).forEach((s) => { if (!union.some((u) => mismoServicio(u, s))) union.push(s); }));
    const hay = mo.ns.filter((n) => n.w && n.w.estado === "ok");
    const notas = mo.ns.map((n) => (!n.l.website ? `${n.nombre}: no tiene web.` : !n.w ? `${n.nombre}: web sin analizar.` : n.w.estado === "plataforma" ? `${n.nombre}: su web es su ficha en ${n.w.plataforma}.` : n.w.estado !== "ok" ? `${n.nombre}: ${n.w.error}.` : !(n.w.servicios || []).length ? `${n.nombre}: su web no publica un listado estructurado de servicios.` : "")).filter(Boolean);
    const tabla = union.length ? `<table class="tb"><thead><tr><th>Servicio o producto publicado</th>${cols}</tr></thead><tbody>${union.slice(0, 40).map((s) => `<tr><td>${eH(s)}</td>${mo.ns.map((n) => { const t = ((n.w && n.w.servicios) || []).some((x) => mismoServicio(x, s)); return `<td class="${t ? "si" : "no"}${n.esMia ? " yo" : ""}">${t ? "✓" : "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table>` : `<p class="nd">No se han podido extraer servicios de las webs${hay.length ? "" : " (ninguna web analizable)"}.</p>`;
    const precios = mo.ns.filter((n) => n.w && (n.w.precios || []).length).map((n) => `<div class="card"><h4>${eH(n.nombre)}</h4><ul class="pr">${n.w.precios.slice(0, 10).map((p) => `<li><span>${eH(p.concepto)}</span><b>${eH(new Intl.NumberFormat("es", { maximumFractionDigits: 2 }).format(p.valor))} ${eH(p.moneda)}</b></li>`).join("")}</ul></div>`).join("");
    return tabla + (notas.length ? `<p class="nota">${notas.map(eH).join(" ")}</p>` : "") + `<h3>Precios publicados</h3>` + (precios ? `<div class="grid">${precios}</div>` : `<p class="nd">Ninguno de los negocios publica precios en las páginas analizadas.</p>`);
  };
  const vozCards = mo.ns.map((n) => {
    const r = n.r, dist = r.distribucion || [0, 0, 0, 0, 0], tot = r.muestra || 0;
    return `<div class="card${n.esMia ? " cyo" : ""}"><h4>${eH(n.nombre)}</h4>
      ${tot ? `<p class="mini">${fmtN(tot)} reseñas analizadas (de ${fmtN(n.l.reviews || 0)} en Google) · media de la muestra ${num1(r.media)} ★ · responde al ${pctTxt(r.pct_respuesta)}${r.mas_reciente ? ` · la más reciente: ${eH(r.mas_reciente)}` : ""}</p>
      <div class="dist">${[5, 4, 3, 2, 1].map((s) => `<div><span>${s} ★</span><i style="width:${tot ? (dist[s - 1] / tot) * 100 : 0}%"></i><b>${dist[s - 1]}</b></div>`).join("")}</div>
      ${(r.frases_pos || []).length ? `<p class="mini"><b>Lo que más repiten (positivo):</b> ${r.frases_pos.map(eH).join(" · ")}</p>` : ""}
      ${(r.frases_neg || []).length ? `<p class="mini"><b>Lo que más repiten (negativo):</b> ${r.frases_neg.map(eH).join(" · ")}</p>` : ""}
      ${r.cita_mejor ? `<blockquote class="q ok">«${eH(r.cita_mejor)}»</blockquote>` : ""}
      ${r.cita_peor ? `<blockquote class="q mal">«${eH(r.cita_peor)}»</blockquote>` : ""}
      <p class="mini">Naturalidad de las reseñas: <b>${eH(r.autenticidad.nivel || "sin datos")}</b>${r.autenticidad.pct_cinco != null ? ` · ${pctTxt(r.autenticidad.pct_cinco)} de 5 ★ · ${r.autenticidad.duplicadas || 0} textos repetidos` : ""}</p>` : `<p class="nd">Sin reseñas con texto disponibles.</p>`}</div>`;
  }).join("");
  const redesTabla = `<table class="tb"><thead><tr><th>Red</th>${cols}</tr></thead><tbody>${["facebook", "instagram", "tiktok", "youtube", "linkedin", "x"].map((k) => `<tr><td>${eH(REDES[k][1])}</td>${mo.ns.map((n) => {
    const x = n.m.redes[k];
    if (!x) return `<td class="no${n.esMia ? " yo" : ""}">—</td>`;
    const partes = [x.seguidores ? fmtK(x.seguidores) + " seguidores" : x.ok ? "perfil sin datos públicos" : "perfil enlazado", x.ultima ? `últ. publicación ${x.ultima}` : "", x.engagement != null ? `engagement ${pctTxt(x.engagement)}` : ""].filter(Boolean);
    return `<td class="si${n.esMia ? " yo" : ""}">${eH(partes[0])}<small>${eH(partes.slice(1).join(" · "))}</small></td>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;

  const css = `
  :root{--m1:${m1};--m2:${m2};--tx:#0f172a;--tx2:#475569;--tx3:#64748b;--ln:#e2e8f0;--bg2:#f8fafc;--ok:#15803d;--okb:#dcfce7;--mal:#b91c1c;--malb:#fee2e2}
  *{box-sizing:border-box}html,body{margin:0}body{font:13px/1.55 "Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--tx);background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .pag{max-width:1000px;margin:0 auto;padding:28px 34px}
  .portada{background:var(--m1);color:#fff;padding:46px 40px 40px;position:relative;overflow:hidden}
  .portada::after{content:"";position:absolute;right:-90px;top:-90px;width:320px;height:320px;border-radius:50%;background:var(--m2);opacity:.35}
  .portada .logo{background:#fff;border-radius:10px;padding:10px 14px;display:inline-block;margin-bottom:26px;position:relative;z-index:1}.portada .logo.sobre{background:transparent;padding:0}
  .portada .logo img{max-height:64px;max-width:260px;display:block}
  .portada h1{font-size:34px;line-height:1.15;margin:0 0 8px;position:relative;z-index:1}.portada p{margin:4px 0;opacity:.92;position:relative;z-index:1;font-size:14px}
  .portada .meta{margin-top:24px;display:flex;gap:26px;flex-wrap:wrap;font-size:12px;position:relative;z-index:1}.portada .meta b{display:block;font-size:20px}
  h2{font-size:20px;margin:34px 0 4px;color:var(--m1);border-bottom:3px solid var(--m2);padding-bottom:6px}h2 small{display:block;font-size:12px;font-weight:400;color:var(--tx3);margin-top:2px}
  h3{font-size:14px;margin:20px 0 8px}h4{margin:0 0 6px;font-size:13px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.kpi{border:1px solid var(--ln);border-radius:8px;padding:10px 12px;border-top:3px solid var(--m1)}.kpi span{font-size:11px;color:var(--tx3)}.kpi b{display:block;font-size:22px}
  .tb{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}.tb th,.tb td{border-bottom:1px solid var(--ln);padding:7px 8px;text-align:left;vertical-align:top}.tb thead th{background:var(--bg2);font-size:11px;color:var(--tx2)}
  .tb th small,.tb td small{display:block;font-size:10.5px;color:var(--tx3);font-weight:400}.tb .yo{background:color-mix(in srgb,var(--m1) 6%,#fff)}.tb th.yo{color:var(--m1)}
  .tb td.best{color:var(--ok);font-weight:600}.tb td.worst{color:var(--mal)}.tb td.nd,.nd{color:var(--tx3)}.tb td.si{color:var(--ok)}.tb td.no{color:var(--tx3)}
  .tb tr.grupo td{background:var(--bg2);font-weight:700;color:var(--m1);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .tag{font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:3px;text-transform:uppercase}.tag.ok{background:var(--okb);color:var(--ok)}.tag.mal{background:var(--malb);color:var(--mal)}.tag.neu{background:#e2e8f0;color:#334155}.tag.nd{background:#f1f5f9;color:var(--tx3)}
  .graf{display:grid;grid-template-columns:repeat(2,1fr);gap:12px 20px}.graf .card h4{font-size:12px}
  .card{border:1px solid var(--ln);border-radius:8px;padding:12px 14px;break-inside:avoid}.cyo{border-color:var(--m1);box-shadow:inset 3px 0 0 var(--m1)}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .svl{font-size:11px;fill:var(--tx2)}.svl.yo{fill:var(--m1);font-weight:700}.svv{font-size:11px;fill:var(--tx);font-weight:600}.svn{font-size:11px;fill:var(--tx3)}
  .dx{margin:6px 0 0;padding-left:20px}.dx li{margin:0 0 9px}.dx li b{display:block}.dx li span{color:var(--tx2)}
  .diag{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.diag .card{border-top:4px solid}.diag .b{border-top-color:var(--ok)}.diag .m{border-top-color:#b45309}.diag .i{border-top-color:var(--m1)}
  .diag h3{margin:0 0 4px}.mini{font-size:11.5px;color:var(--tx2);margin:6px 0}
  .dist div{display:grid;grid-template-columns:34px 1fr 28px;gap:6px;align-items:center;font-size:11px}.dist i{display:block;height:8px;background:var(--m1);border-radius:0 3px 3px 0;min-width:1px;opacity:.85}.dist b{text-align:right;font-weight:600}
  .q{margin:8px 0;padding:6px 10px;border-left:3px solid;font-style:italic;font-size:11.5px;color:var(--tx2);background:var(--bg2)}.q.ok{border-color:var(--ok)}.q.mal{border-color:var(--mal)}
  .pr{list-style:none;margin:0;padding:0}.pr li{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dashed var(--ln);padding:3px 0;font-size:11.5px}
  .nota{font-size:11px;color:var(--tx3)}.res{font-size:14px;line-height:1.6}.res b{color:var(--m1)}
  .pie{margin-top:30px;border-top:1px solid var(--ln);padding-top:10px;font-size:10.5px;color:var(--tx3);display:flex;justify-content:space-between;gap:10px}
  .portada .sub{font-size:15px;opacity:.95;margin:0 0 6px}
  .hero{display:grid;grid-template-columns:1.6fr repeat(4,1fr);gap:10px;margin:14px 0}
  .hero>div{border:1px solid var(--ln);border-radius:10px;padding:12px 14px}.hero span{display:block;font-size:11px;color:var(--tx3)}
  .hero em{display:block;font-style:normal;font-size:11px;color:var(--tx2);margin-top:2px}
  .big{background:var(--m1);color:#fff;border:0!important}.big span,.big em{color:#fff;opacity:.9}.big b{font-size:52px;line-height:1.05;display:block}.big b small{font-size:18px;opacity:.8}
  .kpi2 b{font-size:28px;display:block;line-height:1.15}.kpi2 b small{font-size:13px;color:var(--tx3)}
  .msj{border-radius:10px;padding:12px 16px;font-size:13.5px;line-height:1.55}.msj b{display:block;font-size:15px;margin-bottom:2px}
  .msj.alerta{background:var(--malb);border-left:5px solid var(--mal)}.msj.ok{background:var(--okb);border-left:5px solid var(--ok)}
  svg .ax{font-size:10px;fill:var(--tx3)}svg .lb{font-size:12px;fill:var(--tx2)}svg .lb.yo{fill:var(--m1);font-weight:700}svg .vy{font-size:12px;font-weight:700;fill:var(--tx)}
  svg .est{font-size:11.5px;font-weight:700}svg .pos{font-size:12px;font-weight:700;fill:var(--tx3)}svg .et{font-size:13px;font-weight:700;fill:var(--tx)}svg .es{font-size:10px;fill:var(--tx3)}
  svg .cn{font-size:12px;font-weight:700;fill:#fff}svg .cd{font-size:11px;fill:var(--tx2);paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round}svg .cc{font-size:14px;font-weight:700;fill:var(--m1)}
  .ley{display:flex;gap:18px;flex-wrap:wrap;font-size:11px;color:var(--tx2);margin-top:6px}.ley i{display:inline-block;vertical-align:-1px;margin-right:5px}
  .ley .c{width:10px;height:10px;border-radius:50%}.ley .c.yo{background:var(--m1)}.ley .c.riv{background:#94a3b8}.ley .r{width:22px;height:7px;border-radius:4px;background:#cbd5e1}.ley .m{width:2px;height:12px;background:#475569}
  .evid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:8px}.evid div{font-size:11px;color:var(--tx2)}.evid b{display:block;color:var(--tx);font-size:11.5px}
  .costes{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.coste{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--ln);border-left:5px solid var(--mal);border-radius:8px;padding:10px 12px;break-inside:avoid}
  .coste b{font-size:22px;color:var(--mal);white-space:nowrap;line-height:1.1}.coste span{font-size:12px;color:var(--tx2)}
  .ruta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.blq{break-inside:avoid}.flujo{display:flex;align-items:stretch;gap:4px}.paso{flex:1;border:2px solid;border-radius:10px;padding:10px 10px 8px;background:#fff;break-inside:avoid}.paso.ok{border-color:var(--ok)}.paso.par{border-color:#b45309}.paso.mal{border-color:var(--mal)}.paso.nd{border-color:#94a3b8}.paso .pn{width:22px;height:22px;border-radius:50%;background:var(--m1);color:#fff;font-weight:700;font-size:12px;display:grid;place-items:center;margin-bottom:6px}.paso b{display:block;font-size:13px}.paso .ps{display:block;font-size:10.5px;color:var(--tx3);margin:2px 0 6px}.paso .pe{display:inline-block;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px}.paso.ok .pe{background:var(--okb);color:var(--ok)}.paso.par .pe{background:#fef3c7;color:#92400e}.paso.mal .pe{background:var(--malb);color:var(--mal)}.paso.nd .pe{background:#f1f5f9;color:var(--tx3)}.paso p{font-size:10.5px;color:var(--tx2);margin:6px 0 0;line-height:1.4}.flecha{align-self:center;color:#94a3b8;font-size:16px}
  .hz{border:1px solid var(--ln);border-radius:10px;padding:0 0 8px;overflow:hidden;break-inside:avoid}
  .hzt{background:var(--m1);color:#fff;padding:9px 12px;font-weight:700;font-size:12.5px;display:flex;gap:8px;align-items:center}.hzt b{background:#fff;color:var(--m1);border-radius:50%;width:22px;height:22px;display:grid;place-items:center;font-size:12px}
  .acc{margin:8px 10px 0;padding:8px 10px;border-radius:8px;background:var(--bg2)}.acc b{display:block;font-size:12px}.acc .kp{display:block;font-size:11px;color:var(--ok);margin-top:3px}.acc .sv{display:inline-block;margin-top:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--m1)}
  .porque{display:grid;grid-template-columns:1fr 1.1fr;gap:20px;align-items:center}.porque p{font-size:13px;line-height:1.6;margin:0 0 10px}
  .lineas{margin:4px 0 10px;padding-left:18px;columns:2;font-size:12px;color:var(--tx2)}.firma{font-size:12.5px;border-top:1px solid var(--ln);padding-top:8px}
  h1.anexos{font-size:26px;color:var(--m1);margin:40px 0 0}h1.anexos small{display:block;font-size:12px;font-weight:400;color:var(--tx3)}
  @page{size:A4;margin:12mm 11mm}
  @media print{.pag{padding:0}.salto{break-before:page}.blq{break-inside:avoid}.portada{margin:-12mm -11mm 0;padding:40mm 16mm 20mm}h2{break-after:avoid}tr,.card{break-inside:avoid}}
  @media screen and (max-width:760px){.kpis,.graf,.grid,.diag,.hero,.costes,.ruta,.porque,.evid{grid-template-columns:1fr}}`;

  const clave = filas.filter((f) => ["score", "rating", "reviews", "webscore", "seguidores", "senales"].includes(f.mt.k));

  // Visión ejecutiva.
  const ac = areasCompetitivas(mo), etapas = recorrido(mo, ac), ruta = hojaDeRuta(mo, ac);
  const liderIdx = mo.ns.map((n, i) => ({ n, v: ac.indices[i] })).slice(1).sort((a, b) => b.v - a.v)[0];
  const brechaLider = liderIdx.v - ac.indices[0];
  const mediaRiv = Math.round(ac.indices.slice(1).reduce((s, v) => s + v, 0) / rv.length);
  const enDesv = ac.areas.filter((a) => a.estado === "desventaja"), enVent = ac.areas.filter((a) => a.estado === "ventaja");
  // Coste de no actuar: solo hechos medidos en los que tu competencia te supera.
  const costes = [];
  const q = (fn) => rv.filter(fn);
  const hecho = (lista, cifraTxt, texto) => { if (lista.length) costes.push({ cifra: cifraTxt(lista), texto: texto(lista) }); };
  const deN = (xs) => `${xs.length} de ${rv.length}`;
  if (!yo.senales.reserva_online) hecho(q((n) => n.senales.reserva_online), deN, (xs) => `competidores ya permiten reservar o pedir cita online (${xs.map((n) => n.nombre).join(", ")}); tú no.`);
  if (!yo.senales.whatsapp) hecho(q((n) => n.senales.whatsapp), deN, () => "competidores atienden por WhatsApp desde su web o su ficha; tú no.");
  if (!tieneAlguna(yo, ["chat", "agente_ia"])) hecho(q((n) => tieneAlguna(n, ["chat", "agente_ia"])), deN, () => "competidores tienen chat o agente de IA en su web para atender al momento; tú no.");
  if (!(yo.w && (yo.w.precios || []).length)) hecho(q((n) => n.w && (n.w.precios || []).length), deN, () => "competidores publican precios en su web; quien compara lo tiene más fácil con ellos.");
  if (!(yo.m.publicidad > 0)) hecho(q((n) => n.m.publicidad > 0), deN, () => "competidores tienen píxeles de publicidad: pueden hacer campañas y volver a impactar a quien visitó su web.");
  const maxRes = Math.max(...rv.map((n) => n.l.reviews || 0)), lidRes = rv.find((n) => (n.l.reviews || 0) === maxRes);
  if (maxRes >= (yo.l.reviews || 0) * 1.5 && maxRes >= 30) costes.push({ cifra: `×${num1(maxRes / Math.max(1, yo.l.reviews || 0))}`, texto: `reseñas: ${lidRes.nombre} tiene ${fmtN(maxRes)} frente a tus ${fmtN(yo.l.reviews || 0)}. Más reseñas significa más visibilidad y confianza en Google Maps.` });
  if (yo.r.muestra) hecho(q((n) => n.r.muestra && n.r.pct_respuesta > yo.r.pct_respuesta + 20), deN, () => `competidores responden a sus reseñas más que tú (tú: ${pctTxt(yo.r.pct_respuesta)}): los clientes lo perciben como mejor atención.`);
  if (yo.m.actividad !== "activo") hecho(q((n) => n.m.actividad === "activo"), deN, () => "competidores han publicado en redes en los últimos 30 días; tus redes no muestran esa actividad.");
  const wb = ac.areas.find((a) => a.k === "web");
  if (wb.estado === "desventaja" && wb.lider) costes.push({ cifra: `${wb.brecha} pts`, texto: `de diferencia en web y SEO con ${wb.lider.nombre} (${Math.round(wb.mejor)}/100 frente a tus ${wb.vals[0]}/100).` });
  const resumen = `Frente a ${rv.length === 1 ? "tu competidor" : `tus ${rv.length} competidores`}, <b>${eH(yo.nombre)}</b> lidera en <b>${cuenta("lidera")}</b> de ${filas.filter((f) => f.estado !== "sin datos").length} indicadores comparables, va a la par en <b>${cuenta("a la par")}</b> y por detrás en <b>${cuenta("por detrás") + cuenta("último")}</b>${cuenta("último") ? ` (en ${cuenta("último")} es el último)` : ""}. Ocupa la posición <b>#${yo.posicion}</b> de ${mo.totalMercado} negocios del mercado analizado por ${eH(mo.criterio.toLowerCase())}.`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${eH(nombreInforme())}</title><style>${css}</style></head><body>
  <section class="portada">
    ${logoHTML}
    <h1>Informe de posición competitiva</h1><p class="sub">Dónde estás frente a tu competencia, qué te está costando y cómo cerrar la brecha</p>
    <p><b>${eH(mc.nombre)}</b> frente a su competencia${zonas ? ` en ${eH(zonas)}` : ""}</p>
    <p>${eH(yo.l.category || "")}${yo.l.address ? " · " + eH(yo.l.address) : ""}</p>
    <div class="meta"><div><b>${mo.ns.length}</b>negocios comparados</div><div><b>#${yo.posicion}</b>de ${mo.totalMercado} en el mercado</div><div><b>${fmtN(mo.ns.reduce((a, n) => a + (n.r.muestra || 0), 0))}</b>reseñas analizadas</div><div><b>${eH(fecha)}</b>fecha del análisis</div>${mc.por ? `<div><b>${eH(mc.por)}</b>preparado por</div>` : ""}</div>
  </section>
  <div class="pag">
    <div class="blq"><h2>La situación en un minuto<small>Índice competitivo 0-100: media de seis áreas que deciden si un cliente te elige a ti o a tu competencia</small></h2>
    <div class="hero">
      <div class="big"><span>Tu índice competitivo</span><b>${ac.indices[0]}<small>/100</small></b><em>${brechaLider > 0 ? `${brechaLider} puntos por debajo de ${eH(liderIdx.n.nombre)}` : "Encabezas a tu competencia"}</em></div>
      <div class="kpi2"><span>Líder del grupo</span><b>${liderIdx.v}</b><em>${eH(liderIdx.n.nombre)}</em></div>
      <div class="kpi2"><span>Media de tu competencia</span><b>${mediaRiv}</b><em>${ac.indices[0] >= mediaRiv ? "estás por encima" : `te faltan ${mediaRiv - ac.indices[0]} puntos`}</em></div>
      <div class="kpi2"><span>Áreas en desventaja</span><b>${enDesv.length}<small> de ${ac.areas.length}</small></b><em>${enVent.length ? `ventaja en ${enVent.length}` : "sin ventajas claras"}</em></div>
      <div class="kpi2"><span>Posición en el mercado</span><b>#${yo.posicion}</b><em>de ${mo.totalMercado} negocios</em></div>
    </div>
    <div class="msj ${enDesv.length >= 2 || brechaLider >= 15 ? "alerta" : "ok"}"><b>${enDesv.length >= 2 || brechaLider >= 15 ? "Hoy compites en desventaja." : enDesv.length ? "Compites de igual a igual, con puntos débiles concretos." : "Hoy compites con ventaja: el reto es mantenerla."}</b>
      ${enDesv.length ? `Tu competencia te supera en ${enDesv.map((a) => minus(a.t)).join(", ")}. Cada una de estas brechas es un punto del recorrido en el que un cliente potencial puede elegir a otro negocio.` : "La competencia no se detiene: los datos de este informe deben revisarse cada trimestre."}</div>

    </div><div class="blq">
    <h2>Mapa de brechas<small>Dónde estás frente a tu competencia en cada área (0 = nada implantado, 100 = excelente)</small></h2>
    <div class="card">${svgBrechas(mo, ac)}</div>

    </div><div class="blq">
    <h2>El recorrido de tu cliente<small>Las cinco etapas por las que pasa un cliente antes de comprarte, y cómo estás en cada una frente a tu competencia</small></h2>
    ${flujoRecorrido(etapas)}

    </div><div class="blq">
    <h2>Ranking competitivo<small>Índice competitivo de cada negocio comparado</small></h2>
    <div class="card">${svgRanking(mo, ac)}</div>

    </div><div class="blq salto">
    <h2>El coste de no actuar<small>Lo que ya hace tu competencia y hoy tú no</small></h2>
    <div class="costes">${costes.length ? costes.map((c) => `<div class="coste"><b>${eH(c.cifra)}</b><span>${eH(c.texto)}</span></div>`).join("") : `<p class="nd">No se detectan ventajas de tu competencia sobre ti en los datos disponibles.</p>`}</div>

    </div><div class="blq">
    <h2>Lo bueno, lo a mejorar y lo a innovar</h2>
    <div class="diag">
      <div class="card b"><h3>Lo bueno</h3>${lista(dg.bueno.slice(0, 3), "Todavía no destacas claramente en ningún indicador.")}</div>
      <div class="card m"><h3>A mejorar</h3>${lista(dg.mejorar.slice(0, 3), "No hay diferencias significativas en tu contra.")}</div>
      <div class="card i"><h3>A innovar</h3>${lista(dg.innovar.slice(0, 3), "Sin oportunidades claras en los datos disponibles.")}</div>
    </div>

    </div><div class="blq salto">
    <h2>Hoja de ruta de mejora<small>Acciones priorizadas, con su objetivo medible y el área de trabajo que las resuelve</small></h2>
    <div class="ruta">${["0 – 30 días · Resultados rápidos", "30 – 90 días · Consolidar", "90 – 180 días · Escalar"].map((h, i) => `<div class="hz"><div class="hzt"><b>${i + 1}</b>${eH(h)}</div>${ruta.filter((x) => x.h === i).map((x) => `<div class="acc"><b>${eH(x.t)}</b><span class="kp">Objetivo: ${eH(x.kpi)}</span><span class="sv">${eH(x.s)}</span></div>`).join("") || `<p class="nd">Sin acciones en este horizonte.</p>`}</div>`).join("")}</div>

    </div><div class="blq">
    <h2>Por qué mejorar no es opcional<small>La competencia se mide y se mueve cada mes</small></h2>
    <div class="porque">
      <div>${svgCiclo()}</div>
      <div>
        <p>Los negocios que lideran tu mercado no lo hacen por una acción puntual, sino porque <b>miden, comparan y mejoran de forma continua</b> su reputación, su web, su atención y sus canales de venta.</p>
        <p>Ese trabajo no es un servicio externo ni un extra: es parte de la gestión de cualquier negocio, del autónomo a la gran empresa, que quiera <b>seguir mejorando, mantenerse y escalar</b>.</p>
        <ul class="lineas">${[...new Set(ruta.map((x) => x.s))].map((s) => `<li>${eH(s)}</li>`).join("")}</ul>
        ${mc.por ? `<p class="firma">Preparado por <b>${eH(mc.por)}</b>, tu equipo para ejecutar y medir este plan.</p>` : ""}
      </div>
    </div>

    </div>
    <h1 class="anexos salto">Anexos<small>El detalle que respalda cada conclusión</small></h1>
    <h2>A. Negocios comparados<small>Tu empresa y la competencia elegida</small></h2>
    <table class="tb"><thead><tr><th></th>${cols}</tr></thead><tbody>
      <tr><td>Categoría</td>${mo.ns.map((n) => `<td class="${n.esMia ? "yo" : ""}">${eH(n.l.category || "—")}</td>`).join("")}</tr>
      <tr><td>Dirección</td>${mo.ns.map((n) => `<td class="${n.esMia ? "yo" : ""}">${eH(n.l.address || "—")}</td>`).join("")}</tr>
      <tr><td>Web</td>${mo.ns.map((n) => `<td class="${n.esMia ? "yo" : ""}">${n.l.website ? eH(dominio(n.l.website)) : "Sin web"}${n.w && n.w.estado === "plataforma" ? `<small>ficha en ${eH(n.w.plataforma)}</small>` : ""}</td>`).join("")}</tr>
      <tr><td>Horario</td>${mo.ns.map((n) => `<td class="${n.esMia ? "yo" : ""}">${!n.hs ? "No publicado" : n.hs.incompleto ? "Incompleto en Google" : `${num1(n.hs.horas)} h/semana<small>${n.hs.dias} días abiertos</small>`}</td>`).join("")}</tr>
    </tbody></table>

    <h2>B. Cuadro comparativo<small>▲ mejor valor del grupo · ▼ peor valor · la diferencia solo se considera significativa si supera el umbral de cada indicador</small></h2>
    <table class="tb"><thead><tr><th>Indicador</th>${cols}<th>Tu situación</th></tr></thead><tbody>
      ${grupos.map((g) => `<tr class="grupo"><td colspan="${mo.ns.length + 2}">${eH(g)}</td></tr>${filas.filter((f) => f.mt.g === g).map((f) => `<tr><td>${eH(f.mt.t)}</td>${mo.ns.map((_, i) => celda(f, i)).join("")}<td><span class="tag ${est[f.estado][1]}">${est[f.estado][0]}</span></td></tr>`).join("")}`).join("")}
    </tbody></table>

    <h2 class="salto">C. Diferencias por indicador<small>Tu empresa en el color de tu marca; la competencia en gris</small></h2>
    <div class="graf">${clave.concat(filas.filter((f) => ["respuesta", "horas"].includes(f.mt.k))).map((f) => `<div class="card"><h4>${eH(f.mt.t)}</h4>${barrasSVG(mo, f.mt, f.vals)}</div>`).join("")}</div>

    <h2 class="salto">D. Voz del cliente<small>Reseñas públicas de Google: qué valoran y qué critican los clientes de cada negocio</small></h2>
    ${aspectosTabla()}
    <div class="grid">${vozCards}</div>

    <h2 class="salto">E. Servicios, productos y precios<small>Lo que cada negocio publica en su web</small></h2>
    ${serviciosTabla()}

    <h2 class="salto">F. Herramientas y modelo de trabajo<small>Canales, facilidades y forma de trabajar detectados en su web y en Google</small></h2>
    ${senalesTabla()}

    <h2>G. Redes sociales</h2>
    ${redesTabla}

    <h2 class="salto">H. Diagnóstico completo<small>Cada punto con su evidencia</small></h2>
    <div class="card b" style="border-top:4px solid var(--ok);margin-bottom:12px"><h3>Lo bueno: tus fortalezas</h3>${lista(dg.bueno, "Todavía no destacas claramente en ningún indicador.")}</div>
    <div class="card m" style="border-top:4px solid #b45309;margin-bottom:12px"><h3>Lo a mejorar</h3>${lista(dg.mejorar, "No hay diferencias significativas en tu contra.")}</div>
    <div class="card i" style="border-top:4px solid var(--m1)"><h3>Lo a innovar</h3>${lista(dg.innovar, "Sin oportunidades claras en los datos disponibles.")}</div>

    <h2 class="salto">I. Metodología y fuentes</h2>
    <ul class="mini">
      <li><b>Índice competitivo (0-100):</b> media de seis áreas con reglas fijas. Reputación: valoración (de 3,5 ★ a 5 ★ = 0-60) y volumen de reseñas (escala logarítmica hasta 1.000 = 0-40). Atención: % de reseñas respondidas (0-60) y ausencia de reseñas negativas (0-40). Web: salud técnica y SEO. Medición y publicidad: analítica 25, píxel de Meta 25, otros píxeles 25, Tag Manager 15, mapas de calor 10. Redes: nº de redes (0-30), seguidores (escala logarítmica, 0-35) y actividad (0-35). Canales: reserva online, WhatsApp, chat o IA, pago o tienda online, presupuesto o primera visita gratis, ofertas o fidelización y horario de 50 h o más. Una área está en «desventaja» si quedas más de 10 puntos por debajo de la media de tu competencia o más de 25 por debajo del mejor.</li>
      <li><b>Mercado:</b> ${mo.totalMercado} negocios de la búsqueda «${eH(mo.busqueda.Name)}»${zonas ? ` (zona: ${eH(zonas)})` : ""}, ordenados por ${eH(mo.criterio.toLowerCase())}.</li>
      <li><b>Google Maps:</b> valoración, nº de reseñas, horario, categoría y reseñas públicas (${fmtN(mo.ns.reduce((a, n) => a + (n.r.muestra || 0), 0))} reseñas analizadas). Se analizan las reseñas que Google muestra por defecto en cada ficha (normalmente entre 5 y 8, las «más relevantes»): los porcentajes basados en reseñas son orientativos; la valoración y el nº total de reseñas sí son los oficiales de Google.</li>
      <li><b>Voz del cliente:</b> análisis por aspectos con léxicos en español e inglés, frase a frase, con detección de negaciones; si una frase no tiene tono claro se usa la valoración de la reseña. La «naturalidad» combina indicios (proporción de 5 ★, textos repetidos, reseñas muy cortas y concentración en un mes): no es una prueba de reseñas falsas.</li>
      <li><b>Webs:</b> portada y hasta 6 páginas internas de servicios, precios, reservas y equipo; etiquetas de medición y publicidad con sus identificadores; salud técnica y SEO.</li>
      <li><b>Redes sociales:</b> datos públicos visibles sin iniciar sesión. Instagram y parte de Facebook limitan las consultas automáticas, por lo que pueden faltar datos.</li>
      <li><b>Significación:</b> cada indicador tiene un umbral (por ejemplo, 0,2 ★ con al menos 20 reseñas, el doble de seguidores o 15 puntos de salud web); por debajo se considera «a la par».</li>
    </ul>
    <div class="pie"><span>${eH(mc.nombre)}${mc.por ? " · preparado por " + eH(mc.por) : ""}</span><span>Análisis competitivo · ${eH(fecha)}</span></div>
  </div>
  </body></html>`;
}

/* ================= descargas ================= */
function descargar(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre.replace(/[\\/:*?"<>|]/g, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

async function descargarPDF(doc) {
  const b = $("#cmpPDF");
  b.disabled = true;
  const txt = b.innerHTML;
  b.innerHTML = `<i data-lucide="loader-circle" class="spin"></i>Generando PDF…`;
  icons();
  try {
    const r = await fetch(`/api/v1/pdf?nombre=${encodeURIComponent(nombreInforme())}`, { method: "POST", headers: { "Content-Type": "text/html; charset=utf-8" }, body: doc });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || r.statusText);
    descargar(await r.blob(), nombreInforme() + ".pdf");
    toast("PDF descargado");
  } catch (e) { toast("No se pudo generar el PDF: " + e.message, true); }
  finally { b.disabled = false; b.innerHTML = txt; icons(); }
}
