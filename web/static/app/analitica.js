// Analítica a medida: métricas por negocio, puntuación de presencia digital,
// posición frente a la competencia, filtros múltiples y gráficos.
// Usa las utilidades de index.html (S, esc, fmtN, fmtK, marca, techDe, socialDe, redesDe…).
"use strict";

const REDES_ANALIZABLES = ["facebook", "instagram", "tiktok", "youtube"];
const REDES_TODAS = ["facebook", "instagram", "tiktok", "youtube", "linkedin", "x", "whatsapp"];
const CAT_TAG = { publicidad: "Publicidad", analitica: "Analítica", comportamiento: "Comportamiento (mapas de calor)", contenedor: "Gestor de etiquetas", crm: "CRM y email", consentimiento: "Consentimiento de cookies", pagos: "Pagos y tienda" };
const ACTIVIDAD = { activo: "Activo", poco: "Poco activo", inactivo: "Inactivo", sin: "Sin datos" };
const AHORA = () => Date.now();

const dias = (fecha) => (fecha ? Math.floor((AHORA() - new Date(fecha + "T12:00:00Z")) / 864e5) : null);
const actividadDe = (d) => (d == null ? "sin" : d <= 30 ? "activo" : d <= 90 ? "poco" : "inactivo");
const hace = (d) => (d <= 0 ? "hoy" : d === 1 ? "hace 1 día" : `hace ${fmtN(d)} días`);
const pctTxt = (v) => (v == null ? "—" : String(v).replace(".", ",") + " %");
const num1 = (v) => (v == null ? "—" : String(Math.round(v * 10) / 10).replace(".", ","));

// Etiquetas de la web; las búsquedas analizadas antes de existir la lista completa
// solo tienen los indicadores básicos.
function tagsDe(t) {
  if (!t || t.status !== "ok") return [];
  if (t.tags) return t.tags;
  const out = [];
  if (t.meta_pixel) out.push({ name: "Píxel de Meta", cat: "publicidad", ids: t.meta_ids || [] });
  if (t.google_ads) out.push({ name: "Google Ads", cat: "publicidad", ids: t.google_ads_ids || [] });
  if (t.analytics) out.push({ name: "Google Analytics 4", cat: "analitica" });
  if (t.tag_manager) out.push({ name: "Google Tag Manager", cat: "contenedor" });
  if (t.tiktok) out.push({ name: "Píxel de TikTok", cat: "publicidad" });
  if (t.linkedin) out.push({ name: "LinkedIn Insight", cat: "publicidad" });
  return out;
}

/* ---------- métricas de un negocio ---------- */
function metricas(l) {
  const t = techDe(l);
  const tags = tagsDe(t);
  const w = t && t.status === "ok" ? t.web : null;
  const r = redesDe(l);
  const redes = {};
  let seguidores = 0, mejorDias = null, engMax = null;

  for (const n of REDES_TODAS) {
    if (!r[n]) continue;
    const st = socialDe(r[n]);
    const ok = st && st.status === "ok";
    const d = ok ? dias(st.last_post) : null;
    const red = {
      url: r[n], ok, estado: st ? st.status : "pendiente", seguidores: ok ? st.followers || 0 : null,
      publicaciones: ok ? st.posts || null : null, engagement: ok && st.engagement ? st.engagement : null,
      ritmo: ok && st.posts_month ? st.posts_month : null, ultima: ok ? st.last_post || null : null, dias: d,
      actividad: actividadDe(d), muestra: ok ? st.sample || 0 : 0,
    };
    redes[n] = red;
    if (red.seguidores) seguidores += red.seguidores;
    if (d != null && (mejorDias == null || d < mejorDias)) mejorDias = d;
    if (red.engagement != null && (engMax == null || red.engagement > engMax)) engMax = red.engagement;
  }

  const nRedes = Object.keys(redes).filter((n) => n !== "whatsapp").length;
  const nombres = new Set(tags.map((x) => x.name));
  const cats = new Set(tags.map((x) => x.cat));
  const m = {
    l, t, w, tags, nombres, redes, nRedes, seguidores, engMax, dias: mejorDias, actividad: actividadDe(mejorDias),
    web: !!l.website, webOk: !!w, webScore: w ? w.score : null, publicidad: tags.filter((x) => x.cat === "publicidad").length,
    medicion: cats.has("analitica"), etiquetas: tags.length,
  };
  m.puntos = puntuar(m);
  m.score = Object.values(m.puntos).reduce((a, b) => a + b.v, 0);
  return m;
}

// Presencia digital (0-100), con el desglose que se enseña en la ficha.
function puntuar(m) {
  const { l, w, nombres } = m;
  const webPts = !m.web ? 0 : w ? 10 + Math.round(w.score * 0.2) : 10;
  let med = 0;
  if (m.medicion) med += 6;
  if (nombres.has("Google Tag Manager")) med += 3;
  if (nombres.has("Píxel de Meta")) med += 5;
  if (m.tags.some((x) => x.cat === "publicidad" && x.name !== "Píxel de Meta")) med += 4;
  if (m.tags.some((x) => x.cat === "comportamiento")) med += 2;
  const redes = Math.min(m.nRedes, 3) * 4 + Math.round(Math.min(Math.log10(m.seguidores + 1) / 4, 1) * 8)
    + (m.actividad === "activo" ? 10 : m.actividad === "poco" ? 5 : 0);
  const rep = Math.round((l.rating || 0) / 5 * 8 + Math.min(Math.log10((l.reviews || 0) + 1) / 3, 1) * 8) + (l.claimed ? 4 : 0);
  return {
    web: { v: webPts, max: 30, t: "Web", d: !m.web ? "No tiene web" : w ? `Salud y SEO de la web: ${w.score}/100` : "Web sin analizar" },
    med: { v: med, max: 20, t: "Medición y publicidad", d: `${m.etiquetas} etiquetas: ${m.medicion ? "mide visitas" : "no mide visitas"}${nombres.has("Píxel de Meta") ? ", píxel de Meta" : ""}` },
    redes: { v: redes, max: 30, t: "Redes sociales", d: `${m.nRedes} redes · ${fmtK(m.seguidores)} seguidores · ${ACTIVIDAD[m.actividad].toLowerCase()}` },
    rep: { v: rep, max: 20, t: "Reputación en Google", d: l.rating ? `${num1(l.rating)} ★ · ${fmtN(l.reviews)} reseñas${l.claimed ? " · ficha verificada" : ""}` : "Sin reseñas" },
  };
}

// Posición de cada negocio frente al resto de la búsqueda (1 = el mejor).
function posiciones(ms) {
  const rank = (get) => {
    const orden = ms.filter((m) => get(m) != null).sort((a, b) => get(b) - get(a));
    const pos = new Map();
    orden.forEach((m, i) => pos.set(m, i + 1));
    return pos;
  };
  const p = { score: rank((m) => m.score), seguidores: rank((m) => (m.seguidores || null)), resenas: rank((m) => m.l.reviews || null), engagement: rank((m) => m.engMax) };
  for (const m of ms) m.pos = { score: p.score.get(m), seguidores: p.seguidores.get(m), resenas: p.resenas.get(m), engagement: p.engagement.get(m), de: ms.length };
  return ms;
}

/* ---------- campos filtrables ---------- */
function camposAnalitica(ms) {
  const nombresTags = [...new Set(ms.flatMap((m) => m.tags.map((x) => x.name)))].sort((a, b) => a.localeCompare(b, "es"));
  const catVals = (get) => [...new Set(ms.map(get).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const c = [
    ["Negocio", "score", "Puntuación de presencia digital", "num", (m) => m.score],
    ["Negocio", "categoria", "Categoría", "cat", (m) => m.l.category, catVals((m) => m.l.category)],
    ["Negocio", "zona", "Barrio / zona", "cat", (m) => m.l.borough || m.l.city, catVals((m) => m.l.borough || m.l.city)],
    ["Negocio", "rating", "Valoración en Google", "num", (m) => m.l.rating || null],
    ["Negocio", "resenas", "Nº de reseñas", "num", (m) => m.l.reviews || 0],
    ["Negocio", "verificada", "Ficha de Google verificada", "bool", (m) => !!m.l.claimed],
    ...(S.res.zonas && S.res.zonas.length ? [["Negocio", "enzona", "Dentro de la zona elegida", "bool", (m) => enZona(m.l)]] : []),
    ["Contacto", "tel", "Tiene teléfono", "bool", (m) => !!m.l.phone],
    ["Contacto", "movil", "Tiene móvil (WhatsApp)", "bool", (m) => esMovil(m.l.phone)],
    ["Contacto", "email", "Tiene email", "bool", (m) => !!(m.l.emails || []).length],
    ["Web", "web", "Tiene web", "bool", (m) => m.web],
    ["Web", "webscore", "Salud y SEO de la web (0-100)", "num", (m) => m.webScore],
    ["Web", "https", "Web con HTTPS", "bool", (m) => (m.w ? m.w.https : null)],
    ["Web", "movilweb", "Web adaptada a móvil", "bool", (m) => (m.w ? m.w.viewport : null)],
    ["Web", "velocidad", "Tiempo de respuesta (ms)", "num", (m) => (m.w ? m.w.response_ms : null)],
    ["Web", "anio", "Año más reciente en la web", "num", (m) => (m.w && m.w.year ? m.w.year : null)],
    ["Web", "schema", "Datos estructurados (schema.org)", "bool", (m) => (m.w ? !!(m.w.schema || []).length : null)],
    ["Web", "plataforma", "Plataforma web", "cat", (m) => (m.t && m.t.platform) || null, catVals((m) => m.t && m.t.platform)],
    ["Web", "chat", "Tiene chat o agente IA", "bool", (m) => (m.t && m.t.status === "ok" ? (m.t.chats || []).some((x) => x.kind !== "whatsapp") : null)],
    ["Web", "ia", "Tiene agente IA", "bool", (m) => (m.t && m.t.status === "ok" ? (m.t.chats || []).some((x) => x.kind === "ia") : null)],
    ["Etiquetas y píxeles", "netiquetas", "Nº de etiquetas instaladas", "num", (m) => (m.webOk ? m.etiquetas : null)],
    ["Etiquetas y píxeles", "npublicidad", "Nº de etiquetas de publicidad", "num", (m) => (m.webOk ? m.publicidad : null)],
    ["Etiquetas y píxeles", "medicion", "Mide sus visitas (analítica)", "bool", (m) => (m.webOk ? m.medicion : null)],
    ...nombresTags.map((n) => ["Etiquetas y píxeles", "tag:" + n, n, "bool", (m) => (m.webOk ? m.nombres.has(n) : null)]),
    ["Redes sociales", "nredes", "Nº de redes sociales", "num", (m) => m.nRedes],
    ["Redes sociales", "seguidores", "Seguidores en total", "num", (m) => m.seguidores],
    ["Redes sociales", "actividad", "Actividad en redes", "cat", (m) => ACTIVIDAD[m.actividad], Object.values(ACTIVIDAD)],
    ["Redes sociales", "dias", "Días desde la última publicación", "num", (m) => m.dias],
    ["Redes sociales", "engagement", "Engagement máximo (%)", "num", (m) => m.engMax],
  ];
  for (const n of REDES_TODAS) {
    const nom = REDES[n][1];
    c.push(["Redes sociales", "tiene:" + n, "Tiene " + nom, "bool", (m) => !!m.redes[n]]);
    if (REDES_ANALIZABLES.includes(n)) {
      c.push(["Redes sociales", "seg:" + n, "Seguidores en " + nom, "num", (m) => (m.redes[n] && m.redes[n].ok ? m.redes[n].seguidores : null)]);
      c.push(["Redes sociales", "eng:" + n, "Engagement en " + nom + " (%)", "num", (m) => (m.redes[n] ? m.redes[n].engagement : null)]);
      c.push(["Redes sociales", "ritmo:" + n, "Publicaciones al mes en " + nom, "num", (m) => (m.redes[n] ? m.redes[n].ritmo : null)]);
    }
  }
  return c.map(([grupo, k, t, tipo, get, vals]) => ({ grupo, k, t, tipo, get, vals }));
}

const OPS = {
  num: [["ge", "≥"], ["le", "≤"], ["eq", "="], ["con", "tiene dato"], ["sin", "sin dato"]],
  bool: [["si", "sí"], ["no", "no"]],
  cat: [["es", "es"], ["noes", "no es"], ["con", "tiene dato"], ["sin", "sin dato"]],
};

function cumple(c, campo, m) {
  const v = campo.get(m);
  switch (c.op) {
    case "ge": return v != null && v >= +c.v;
    case "le": return v != null && v <= +c.v;
    case "eq": return v != null && v === +c.v;
    case "con": return v != null && v !== "";
    case "sin": return v == null || v === "";
    case "si": return v === true;
    case "no": return v === false;
    case "es": return v === c.v;
    case "noes": return v != null && v !== c.v;
  }
  return true;
}

/* ---------- plantillas de filtros ---------- */
const PLANTILLAS = [
  { n: "Activos en redes sin píxel de Meta", modo: "todas", c: [{ k: "actividad", op: "es", v: "Activo" }, { k: "web", op: "si" }, { k: "tag:Píxel de Meta", op: "no" }] },
  { n: "Buena reputación y sin web", modo: "todas", c: [{ k: "rating", op: "ge", v: "4.5" }, { k: "resenas", op: "ge", v: "50" }, { k: "web", op: "no" }] },
  { n: "Invierten en publicidad", modo: "todas", c: [{ k: "npublicidad", op: "ge", v: "1" }] },
  { n: "Web anticuada o poco cuidada", modo: "cualquiera", c: [{ k: "webscore", op: "le", v: "60" }, { k: "anio", op: "le", v: String(new Date().getFullYear() - 2) }, { k: "movilweb", op: "no" }, { k: "https", op: "no" }] },
  { n: "Redes abandonadas", modo: "todas", c: [{ k: "actividad", op: "es", v: "Inactivo" }] },
  { n: "Web sin medición", modo: "todas", c: [{ k: "web", op: "si" }, { k: "medicion", op: "no" }] },
  { n: "Grandes audiencias", modo: "todas", c: [{ k: "seguidores", op: "ge", v: "5000" }] },
  { n: "Web sin chat (candidatos a agente IA)", modo: "todas", c: [{ k: "web", op: "si" }, { k: "chat", op: "no" }] },
];
const CLAVE_PLANTILLAS = "gmaps.plantillas";
const misPlantillas = () => { try { return JSON.parse(localStorage.getItem(CLAVE_PLANTILLAS)) || []; } catch (e) { return []; } };

/* ---------- vista ---------- */
function estadoAnalitica() {
  if (!S.res.an) S.res.an = { modo: "todas", c: [], orden: "score", desc: true };
  return S.res.an;
}

function analiticaFiltrada() {
  const an = estadoAnalitica();
  const todas = posiciones(S.res.leads.map(metricas));
  const campos = camposAnalitica(todas);
  const porK = Object.fromEntries(campos.map((c) => [c.k, c]));
  const base = new Set(filtrar());
  const conds = an.c.filter((c) => porK[c.k]);
  const out = todas.filter((m) => base.has(m.l) && (!conds.length || (an.modo === "todas"
    ? conds.every((c) => cumple(c, porK[c.k], m)) : conds.some((c) => cumple(c, porK[c.k], m)))));
  return { todas, campos, porK, out };
}

function pintarAnalitica() {
  const an = estadoAnalitica();
  const { todas, campos, porK, out } = analiticaFiltrada();
  const sc = S.res.social, tc = S.res.tech;
  const avisos = [];
  if (tc.status !== "done") avisos.push(`<i data-lucide="loader-circle" class="spin"></i>Las webs aún se están analizando: las métricas de web y etiquetas se completarán solas.`);
  else if (sc.status === "idle" && todas.some((m) => REDES_ANALIZABLES.some((n) => m.redes[n])))
    avisos.push(`<i data-lucide="users"></i>Faltan los datos de las redes (seguidores, actividad, engagement). <button class="btn btn-sm" id="anSocial"><i data-lucide="users"></i>Consultar redes ahora</button>`);
  else if (sc.status === "running") avisos.push(`<i data-lucide="loader-circle" class="spin"></i>Consultando redes: ${sc.done} de ${sc.total}.`);

  const grupos = [...new Set(campos.map((c) => c.grupo))];
  const selCampo = (c) => `<select class="field" data-f="k">${grupos.map((g) => `<optgroup label="${esc(g)}">${campos.filter((x) => x.grupo === g).map((x) => `<option value="${esc(x.k)}"${x.k === c.k ? " selected" : ""}>${esc(x.t)}</option>`).join("")}</optgroup>`).join("")}</select>`;
  const filaCond = (c, i) => {
    const campo = porK[c.k] || campos[0];
    const ops = OPS[campo.tipo];
    const op = ops.some(([o]) => o === c.op) ? c.op : ops[0][0];
    const conValor = ["ge", "le", "eq", "es", "noes"].includes(op);
    const valor = !conValor ? "" : campo.tipo === "cat"
      ? `<select class="field" data-f="v">${(campo.vals || []).map((v) => `<option${v === c.v ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`
      : `<input class="field" data-f="v" type="number" step="any" value="${esc(c.v ?? "")}" placeholder="valor" style="width:110px">`;
    return `<div class="cond" data-i="${i}">${selCampo(campo)}<select class="field" data-f="op">${ops.map(([o, t]) => `<option value="${o}"${o === op ? " selected" : ""}>${t}</option>`).join("")}</select>${valor}
      <button class="btn btn-icon btn-ghost" data-quitar="${i}" title="Quitar condición"><i data-lucide="x"></i></button></div>`;
  };

  const plantillas = [...PLANTILLAS.map((p, i) => [`p${i}`, p.n]), ...misPlantillas().map((p, i) => [`m${i}`, "★ " + p.n])];
  $("#panel").innerHTML = `
  <div class="an">
    ${avisos.map((a) => `<div class="an-aviso">${a}</div>`).join("")}
    <div class="an-filtros">
      <div class="an-fh">
        <b>Filtros de analítica</b>
        <select class="field" id="anModo"><option value="todas"${an.modo === "todas" ? " selected" : ""}>Cumplir todas las condiciones</option><option value="cualquiera"${an.modo === "cualquiera" ? " selected" : ""}>Cumplir cualquiera</option></select>
        <select class="field" id="anPlant"><option value="">Plantillas…</option>${plantillas.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select>
        <button class="btn btn-sm" id="anAdd"><i data-lucide="plus"></i>Añadir condición</button>
        ${an.c.length ? `<input class="field" id="anNombre" placeholder="Nombre del filtro" style="width:170px"><button class="btn btn-sm btn-ghost" id="anGuardar"><i data-lucide="bookmark-plus"></i>Guardar como plantilla</button><button class="btn btn-sm btn-ghost" id="anLimpiar"><i data-lucide="filter-x"></i>Quitar todas</button>` : ""}
      </div>
      ${an.c.map(filaCond).join("") || `<p class="none" style="margin:6px 0 0">Sin condiciones: se muestran todos los negocios (con los filtros de arriba). Añade condiciones sobre cualquier métrica o usa una plantilla.</p>`}
    </div>
    ${out.length ? kpisAnalitica(out) + graficosAnalitica(out) + tablaAnalitica(out, an) : `<div class="empty"><div class="ico"><i data-lucide="filter-x"></i></div><h3>Ningún negocio cumple las condiciones</h3><p>Cambia o quita alguna condición.</p></div>`}
  </div>`;
  icons();
  enlazarAnalitica(campos, porK, out);
  pintarCount(out.length, S.res.leads.length);
}

function kpisAnalitica(ms) {
  const n = ms.length;
  const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const conWeb = ms.filter((m) => m.web).length;
  const analizadas = ms.filter((m) => m.webOk);
  const conPubli = analizadas.filter((m) => m.publicidad > 0).length;
  const conRedesDatos = ms.filter((m) => m.actividad !== "sin");
  const activos = conRedesDatos.filter((m) => m.actividad === "activo").length;
  const engs = ms.map((m) => m.engMax).filter((v) => v != null);
  const tiles = [
    ["Negocios", fmtN(n), `de ${fmtN(S.res.leads.length)} en la búsqueda`],
    ["Presencia digital media", Math.round(media(ms.map((m) => m.score))) + "/100", "web, medición, redes y reputación"],
    ["Con web", pctTxt(Math.round(conWeb / n * 100)), `${fmtN(conWeb)} negocios`],
    ["Invierten en publicidad", analizadas.length ? pctTxt(Math.round(conPubli / analizadas.length * 100)) : "—", `${fmtN(conPubli)} de ${fmtN(analizadas.length)} webs analizadas`],
    ["Activos en redes", conRedesDatos.length ? pctTxt(Math.round(activos / conRedesDatos.length * 100)) : "—", conRedesDatos.length ? `publicaron en 30 días · ${fmtN(conRedesDatos.length)} con datos` : "sin datos de actividad"],
    ["Seguidores en total", fmtK(ms.reduce((a, m) => a + m.seguidores, 0)), "sumando todas sus redes"],
    ["Engagement medio", engs.length ? pctTxt(Math.round(media(engs) * 100) / 100) : "—", engs.length ? `${fmtN(engs.length)} perfiles con muestra` : "sin muestras de publicaciones"],
    ["Valoración media", num1(media(ms.map((m) => m.l.rating).filter(Boolean))) + " ★", `${fmtN(ms.reduce((a, m) => a + (m.l.reviews || 0), 0))} reseñas`],
  ];
  return `<div class="kpis an-kpis">${tiles.map(([l, v, p]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="p">${p}</div></div>`).join("")}</div>`;
}

// Barras horizontales de una sola serie: % de negocios del conjunto filtrado.
function barras(titulo, sub, filas, total, opts = {}) {
  if (!filas.length) return `<div class="an-graf"><h4>${titulo}</h4><p class="none">Sin datos todavía.</p></div>`;
  const max = Math.max(...filas.map((f) => f.n), 1);
  return `<div class="an-graf"><h4>${titulo}</h4><div class="an-sub">${sub}</div>
    ${filas.map((f) => {
      const p = total ? Math.round(f.n / total * 100) : 0;
      const tip = `${f.t}: ${fmtN(f.n)} de ${fmtN(total)} negocios (${p} %)`;
      return `<div class="bar-row" data-tip="${esc(tip)}">
        <div class="bar-l">${f.ico || ""}<span>${esc(f.t)}</span></div>
        <div class="bar-t"><i class="${f.cls || ""}" style="width:${(opts.escala === "total" ? f.n / (total || 1) : f.n / max) * 100}%"></i></div>
        <div class="bar-v">${p} %<small>${fmtN(f.n)}</small></div></div>`;
    }).join("")}</div>`;
}

function graficosAnalitica(ms) {
  const analizadas = ms.filter((m) => m.webOk);
  const cuenta = new Map();
  analizadas.forEach((m) => m.tags.forEach((x) => cuenta.set(x.name, (cuenta.get(x.name) || 0) + 1)));
  const tags = [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => ({ t, n, ico: marca(t) }));

  const redes = REDES_TODAS.map((n) => ({ t: REDES[n][1], n: ms.filter((m) => m.redes[n]).length, ico: marca(n) })).filter((f) => f.n).sort((a, b) => b.n - a.n);

  const act = ["activo", "poco", "inactivo", "sin"].map((k) => ({ t: ACTIVIDAD[k], n: ms.filter((m) => m.actividad === k).length, cls: "st-" + k, ico: `<span class="st-dot st-${k}"></span>` }));

  const tramos = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]].map(([a, b]) => ({ t: `${a}–${Math.min(b, 100)}`, n: ms.filter((m) => m.score >= a && m.score < b).length }));

  const plat = new Map();
  analizadas.forEach((m) => { const p = (m.t && m.t.platform) || "No identificada"; plat.set(p, (plat.get(p) || 0) + 1); });
  const plats = [...plat].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => ({ t, n, ico: marca(t) }));

  return `<div class="an-grafs">
    ${barras("Etiquetas y píxeles instalados", `% de las ${fmtN(analizadas.length)} webs analizadas`, tags, analizadas.length, { escala: "total" })}
    ${barras("Presencia en redes sociales", `% de los ${fmtN(ms.length)} negocios`, redes, ms.length, { escala: "total" })}
    ${barras("Actividad en redes", "según su publicación más reciente: activo ≤ 30 días, poco activo ≤ 90, inactivo > 90", act, ms.length, { escala: "total" })}
    ${barras("Puntuación de presencia digital", "nº de negocios por tramo (0-100)", tramos, ms.length, { escala: "total" })}
    ${barras("Plataforma de la web", `% de las ${fmtN(analizadas.length)} webs analizadas`, plats, analizadas.length, { escala: "total" })}
  </div>`;
}

const COLS = [
  ["nombre", "Negocio", (m) => m.l.title, false],
  ["score", "Presencia", (m) => m.score, true],
  ["webscore", "Web", (m) => m.webScore, true],
  ["etiquetas", "Etiquetas", (m) => (m.webOk ? m.etiquetas : null), true],
  ["nredes", "Redes", (m) => m.nRedes, true],
  ["seguidores", "Seguidores", (m) => m.seguidores, true],
  ["engagement", "Engagement", (m) => m.engMax, true],
  ["dias", "Última publicación", (m) => m.dias, true],
  ["rating", "Valoración", (m) => m.l.rating || null, true],
  ["resenas", "Reseñas", (m) => m.l.reviews || 0, true],
];

function tablaAnalitica(ms, an) {
  const col = COLS.find((c) => c[0] === an.orden) || COLS[1];
  const orden = [...ms].sort((a, b) => {
    const x = col[2](a), y = col[2](b);
    if (x == null) return 1;
    if (y == null) return -1;
    const r = typeof x === "string" ? x.localeCompare(y, "es") : x - y;
    return an.desc ? -r : r;
  });
  const celda = (k, m) => {
    switch (k) {
      case "nombre": return `<b>${esc(m.l.title)}</b><div class="c">${esc(m.l.category || "")}</div>`;
      case "score": return `<span class="meter" title="${m.score}/100"><i style="width:${m.score}%"></i></span> <b>${m.score}</b>${m.pos.score ? `<small class="none"> #${m.pos.score}</small>` : ""}`;
      case "webscore": return m.webScore == null ? `<span class="none">${m.web ? "—" : "Sin web"}</span>` : `${m.webScore}`;
      case "etiquetas": return m.webOk ? `${m.etiquetas}${m.tags.length ? `<div class="an-ics">${m.tags.slice(0, 6).map((x) => marca(x.name)).join("")}</div>` : ""}` : `<span class="none">—</span>`;
      case "nredes": return `${m.nRedes}<div class="an-ics">${Object.keys(m.redes).filter((n) => n !== "whatsapp").map((n) => marca(n)).join("")}</div>`;
      case "seguidores": return m.seguidores ? fmtK(m.seguidores) + (m.pos.seguidores ? `<small class="none"> #${m.pos.seguidores}</small>` : "") : `<span class="none">—</span>`;
      case "engagement": return m.engMax != null ? pctTxt(m.engMax) : `<span class="none">—</span>`;
      case "dias": return m.dias == null ? `<span class="none">Sin datos</span>` : `<span class="st-dot st-${m.actividad}"></span>${ACTIVIDAD[m.actividad]}<div class="c">${hace(m.dias)}</div>`;
      case "rating": return m.l.rating ? num1(m.l.rating) + " ★" : `<span class="none">—</span>`;
      case "resenas": return fmtN(m.l.reviews || 0) + (m.pos.resenas ? `<small class="none"> #${m.pos.resenas}</small>` : "");
    }
    return "";
  };
  return `<div class="an-tabla-h"><b>Ranking</b><span class="none">Pulsa una columna para ordenar · # = posición entre los ${fmtN(ms[0] ? ms[0].pos.de : 0)} negocios de la búsqueda</span></div>
  <div class="tbl-wrap"><table class="an-tabla"><thead><tr>${COLS.map(([k, t]) => `<th data-ord="${k}" class="${k === an.orden ? "on" : ""}">${t}${k === an.orden ? (an.desc ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
  <tbody>${orden.map((m) => `<tr data-i="${S.res.leads.indexOf(m.l)}">${COLS.map(([k]) => `<td>${celda(k, m)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function enlazarAnalitica(campos, porK, out) {
  const an = estadoAnalitica();
  const repintar = () => pintarAnalitica();
  $("#anModo").onchange = (e) => { an.modo = e.target.value; repintar(); };
  $("#anAdd").onclick = () => { an.c.push({ k: "score", op: "ge", v: "50" }); repintar(); };
  const lim = $("#anLimpiar");
  if (lim) lim.onclick = () => { an.c = []; repintar(); };
  const gua = $("#anGuardar");
  if (gua) gua.onclick = () => {
    const lista = misPlantillas();
    const nombre = ($("#anNombre").value || "").trim() || `Mi filtro ${lista.length + 1} (${an.c.length} condiciones)`;
    lista.push({ n: nombre, modo: an.modo, c: an.c.map((c) => ({ ...c })) });
    localStorage.setItem(CLAVE_PLANTILLAS, JSON.stringify(lista));
    toast(`Guardada como «${nombre}» en Plantillas`);
    repintar();
  };
  $("#anPlant").onchange = (e) => {
    const v = e.target.value;
    const p = v[0] === "p" ? PLANTILLAS[+v.slice(1)] : misPlantillas()[+v.slice(1)];
    if (!p) return;
    an.modo = p.modo;
    an.c = p.c.filter((c) => porK[c.k]).map((c) => ({ ...c }));
    const faltan = p.c.length - an.c.length;
    if (faltan) toast(`${faltan} condición(es) de la plantilla no aplican a esta búsqueda (no hay datos de ese tipo)`);
    repintar();
  };
  document.querySelectorAll(".cond").forEach((row) => {
    const c = an.c[+row.dataset.i];
    row.querySelectorAll("[data-f]").forEach((el) => (el.onchange = () => {
      const f = el.dataset.f;
      c[f] = el.value;
      if (f === "k") { const campo = porK[c.k]; c.op = OPS[campo.tipo][0][0]; c.v = campo.tipo === "cat" ? (campo.vals || [])[0] : ""; }
      repintar();
    }));
  });
  document.querySelectorAll("[data-quitar]").forEach((b) => (b.onclick = () => { an.c.splice(+b.dataset.quitar, 1); repintar(); }));
  document.querySelectorAll(".an-tabla th").forEach((th) => (th.onclick = () => {
    if (an.orden === th.dataset.ord) an.desc = !an.desc; else { an.orden = th.dataset.ord; an.desc = th.dataset.ord !== "nombre" && th.dataset.ord !== "dias"; }
    repintar();
  }));
  document.querySelectorAll(".an-tabla tbody tr").forEach((tr) => (tr.onclick = () => abrirDetalle(+tr.dataset.i)));
  const bs = $("#anSocial");
  if (bs) bs.onclick = () => cargarSocial(S.res.job.ID, true);
  tooltipBarras();
}

// Tooltip de las barras (un único elemento que sigue al cursor).
function tooltipBarras() {
  let tip = $("#anTip");
  if (!tip) { tip = document.createElement("div"); tip.id = "anTip"; tip.className = "an-tip"; document.body.appendChild(tip); }
  document.querySelectorAll(".bar-row").forEach((r) => {
    r.onmousemove = (e) => { tip.textContent = r.dataset.tip; tip.style.display = "block"; tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 14 + "px"; };
    r.onmouseleave = () => (tip.style.display = "none");
  });
}

/* ---------- secciones de la ficha ---------- */
function seccionPresencia(l) {
  const todas = posiciones(S.res.leads.map(metricas));
  const m = todas.find((x) => x.l === l);
  const pos = (p, t) => (p ? `<span class="pos">#${p} de ${m.pos.de} en ${t}</span>` : "");
  return `<div class="sec"><h4>Presencia digital</h4>
    <div class="pres"><div class="pres-v">${m.score}<small>/100</small></div>
      <div class="pres-pos">${pos(m.pos.score, "presencia digital")}${pos(m.pos.seguidores, "seguidores")}${pos(m.pos.resenas, "reseñas")}${pos(m.pos.engagement, "engagement")}</div></div>
    ${Object.values(m.puntos).map((p) => `<div class="pres-f"><div><b>${p.t}</b> <span class="none">${esc(p.d)}</span></div>
      <div class="pres-b"><span class="meter"><i style="width:${p.v / p.max * 100}%"></i></span> ${p.v}/${p.max}</div></div>`).join("")}
  </div>`;
}

function seccionWeb(l) {
  const t = techDe(l);
  if (!l.website || !t || t.status !== "ok") return "";
  const w = t.web;
  const tags = tagsDe(t);
  const si = (v) => (v ? `<b style="color:var(--ok)">Sí</b>` : `<span style="color:var(--err)">No</span>`);
  const porCat = {};
  tags.forEach((x) => (porCat[x.cat] = porCat[x.cat] || []).push(x));
  const etiquetas = tags.length
    ? Object.entries(porCat).map(([c, xs]) => `<div class="k" style="margin-top:8px">${CAT_TAG[c] || c}</div>${xs.map((x) => `<div class="tagrow">${marca(x.name, "tag")}<span>${esc(x.name)}</span>${(x.ids || []).length ? `<code>${x.ids.map(esc).join(", ")}</code>` : ""}</div>`).join("")}`).join("")
    : `<p class="none" style="margin:0">No tiene ninguna etiqueta de medición ni de publicidad instalada.</p>`;
  const salud = !w ? "" : `<div class="dl">
      <i data-lucide="gauge"></i><div><div class="k">Salud y SEO</div><span class="meter"><i style="width:${w.score}%"></i></span> <b>${w.score}/100</b></div>
      <i data-lucide="lock"></i><div><div class="k">HTTPS</div>${si(w.https)}</div>
      <i data-lucide="smartphone"></i><div><div class="k">Adaptada a móvil</div>${si(w.viewport)}</div>
      <i data-lucide="timer"></i><div><div class="k">Tiempo de respuesta</div>${fmtN(w.response_ms)} ms · ${fmtN(w.size_kb)} KB</div>
      <i data-lucide="heading"></i><div><div class="k">Título (${[...(w.title || "")].length} caracteres)</div>${w.title ? esc(w.title) : `<span class="none">Sin título</span>`}</div>
      <i data-lucide="text"></i><div><div class="k">Descripción (${[...(w.description || "")].length} caracteres)</div>${w.description ? esc(w.description) : `<span style="color:var(--err)">Sin meta descripción</span>`}</div>
      <i data-lucide="braces"></i><div><div class="k">Datos estructurados</div>${(w.schema || []).length ? esc(w.schema.join(", ")) : `<span class="none">Ninguno</span>`}</div>
      <i data-lucide="calendar"></i><div><div class="k">Año más reciente en la web</div>${w.year ? w.year + (w.year < new Date().getFullYear() - 1 ? ` <span class="opp">Posiblemente desactualizada</span>` : "") : `<span class="none">No indicado</span>`}</div>
      <i data-lucide="list-checks"></i><div><div class="k">Otros</div>${w.h1} H1 · canonical ${w.canonical ? "sí" : "no"} · Open Graph ${w.open_graph ? "sí" : "no"}${w.noindex ? ` · <b style="color:var(--err)">oculta a Google (noindex)</b>` : ""}${w.generator ? ` · ${esc(w.generator)}` : ""}</div>
    </div>`;
  return `<div class="sec"><h4>Web: salud técnica y SEO</h4>${salud || `<p class="none" style="margin:0">Vuelve a analizar las webs para ver la salud técnica y el SEO.</p>`}</div>
    <div class="sec"><h4>Etiquetas, píxeles y scripts (${tags.length})</h4>${etiquetas}</div>`;
}

// Métricas de actividad e interacción de un perfil, para su tarjeta en la ficha.
function metricasRed(k, st) {
  if (!st || st.status !== "ok") return "";
  const d = dias(st.last_post);
  const act = actividadDe(d);
  const filas = [];
  if (st.last_post) filas.push(["Actividad", `<span class="st-dot st-${act}"></span>${ACTIVIDAD[act]} · ${hace(d)}`]);
  if (st.posts_month) filas.push(["Ritmo", `${num1(st.posts_month)} publicaciones al mes`]);
  if (st.sample) filas.push(["Últimos 30 / 90 días", `${fmtN(st.recent_30 || 0)} / ${fmtN(st.recent_90 || 0)} publicaciones`]);
  if (st.engagement) filas.push(["Engagement", `${pctTxt(st.engagement)} <span class="none">(me gusta + comentarios medios / seguidores)</span>`]);
  // YouTube no publica los comentarios en su feed: solo se muestran donde hay dato.
  if (st.avg_likes || st.avg_comments) filas.push(["Interacción media", [`${num1(st.avg_likes || 0)} me gusta`, k !== "youtube" && `${num1(st.avg_comments || 0)} comentarios`].filter(Boolean).join(" · ")]);
  if (st.avg_views) filas.push(["Reproducciones medias", fmtN(Math.round(st.avg_views))]);
  if (k === "tiktok" && st.likes && st.posts) filas.push(["Me gusta por vídeo (histórico)", fmtN(Math.round(st.likes / st.posts))]);
  if (k === "facebook" && st.talking && st.followers) filas.push(["Hablando de esto", `${fmtN(st.talking)} (${pctTxt(Math.round(st.talking / st.followers * 1000) / 10)} de sus seguidores)`]);
  if (st.email || st.phone || st.website) filas.push(["Contacto del perfil", [st.email && `<a href="mailto:${esc(st.email)}">${esc(st.email)}</a>`, st.phone && esc(st.phone), st.website && `<a href="${esc(st.website)}" target="_blank" rel="noopener">${esc(dominio(st.website))}</a>`].filter(Boolean).join(" · ")]);
  const nota = st.sample ? `Según sus ${fmtN(st.sample)} publicaciones más recientes visibles.` : REDES_ANALIZABLES.includes(k) ? "La red no muestra sus publicaciones recientes sin iniciar sesión: no hay datos de actividad." : "";
  return filas.length || nota ? `<div class="soc-m">${filas.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join("")}${nota ? `<p class="none">${nota}</p>` : ""}</div>` : "";
}

/* ---------- columnas extra para Excel ---------- */
function columnasAnalitica(tech, social) {
  const cache = new Map();
  const mDe = (l) => {
    if (!cache.has(l)) cache.set(l, metricasCon(l, tech, social));
    return cache.get(l);
  };
  const r = (l, n) => { const st = social[redesDe(l, tech)[n]]; return st && st.status === "ok" ? st : null; };
  const cols = [
    ["Presencia digital (0-100)", (l) => mDe(l).score],
    ["Actividad en redes", (l) => ACTIVIDAD[mDe(l).actividad]],
    ["Días desde última publicación", (l) => mDe(l).dias ?? ""],
    ["Seguidores en total", (l) => mDe(l).seguidores || ""],
    ["Engagement máximo (%)", (l) => (mDe(l).engMax ?? "") === "" ? "" : String(mDe(l).engMax).replace(".", ",")],
    ["Salud y SEO web (0-100)", (l) => mDe(l).webScore ?? ""],
    ["HTTPS", (l) => { const w = mDe(l).w; return w ? (w.https ? "Sí" : "No") : ""; }],
    ["Web adaptada a móvil", (l) => { const w = mDe(l).w; return w ? (w.viewport ? "Sí" : "No") : ""; }],
    ["Tiempo de respuesta (ms)", (l) => { const w = mDe(l).w; return w ? w.response_ms : ""; }],
    ["Año más reciente en la web", (l) => { const w = mDe(l).w; return w && w.year ? w.year : ""; }],
    ["Título de la web", (l) => { const w = mDe(l).w; return w ? w.title || "" : ""; }],
    ["Meta descripción", (l) => { const w = mDe(l).w; return w ? w.description || "" : ""; }],
    ["Datos estructurados", (l) => { const w = mDe(l).w; return w ? (w.schema || []).join(", ") : ""; }],
    ["Etiquetas y píxeles", (l) => mDe(l).tags.map((x) => x.name).join(", ")],
    ["IDs de etiquetas", (l) => mDe(l).tags.filter((x) => (x.ids || []).length).map((x) => `${x.name}: ${x.ids.join(" ")}`).join(" | ")],
  ];
  for (const n of REDES_ANALIZABLES) {
    const nom = REDES[n][1];
    cols.push([`${nom}: última publicación`, (l) => (r(l, n) || {}).last_post || ""]);
    cols.push([`${nom}: publicaciones al mes`, (l) => { const s = r(l, n); return s && s.posts_month ? String(s.posts_month).replace(".", ",") : ""; }]);
    cols.push([`${nom}: engagement (%)`, (l) => { const s = r(l, n); return s && s.engagement ? String(s.engagement).replace(".", ",") : ""; }]);
    cols.push([`${nom}: publicaciones`, (l) => (r(l, n) || {}).posts || ""]);
  }
  cols.push(["Email del perfil de Instagram", (l) => (r(l, "instagram") || {}).email || ""]);
  cols.push(["Teléfono del perfil de Instagram", (l) => (r(l, "instagram") || {}).phone || ""]);
  return cols;
}

// metricas() lee el estado de la búsqueda abierta; para exportar otra búsqueda
// desde la lista se sustituye temporalmente por sus datos.
function metricasCon(l, tech, social) {
  const abierta = S.res;
  const temporal = !abierta || abierta.tech.results !== tech;
  if (temporal) S.res = { ...(abierta || {}), tech: { results: tech }, social: { results: social } };
  try { return metricas(l); } finally { if (temporal) S.res = abierta; }
}
