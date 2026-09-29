// Documentación comercial por cliente potencial: a partir del análisis competitivo
// genera el resumen de la oportunidad, el proceso de frío a informado, el guion de
// informado a caliente, el cierre, el manual de objeciones y las pautas de
// atención. Todo sale de los datos medidos: nada se inventa.
// Usa utilidades de index.html, analitica.js y comparador.js.
"use strict";

const CLAVE_VENDEDOR = "gmaps.vendedor";
function vendedor() {
  try { return JSON.parse(localStorage.getItem(CLAVE_VENDEDOR)) || {}; } catch (e) { return {}; }
}
function guardarVendedor(v) { localStorage.setItem(CLAVE_VENDEDOR, JSON.stringify(v)); }

function nombreComercial() {
  const { mia } = compSeleccion();
  return `Documentación comercial - ${mia ? mia.title : "cliente"} - ${new Date().toISOString().slice(0, 10)}`;
}

/* ================= hechos personalizados ================= */
// Cada dolor es un hecho medido en el que la competencia supera al cliente potencial,
// con la pregunta que lo hace consciente, el beneficio y la línea de servicio que lo resuelve.
function doloresDe(mo, ac) {
  const [yo, ...rv] = mo.ns;
  const N = yo.l.title, out = [];
  const q = (fn) => rv.filter(fn);
  const deN = (xs) => `${xs.length} de ${rv.length}`;
  const nombres = (xs) => xs.map((n) => n.nombre).join(", ");
  const area = (k) => ac.areas.find((a) => a.k === k);
  const add = (d) => out.push({ p: 2, ...d });

  const maxRes = Math.max(0, ...rv.map((n) => n.l.reviews || 0)), lidRes = rv.find((n) => (n.l.reviews || 0) === maxRes);
  if (lidRes && maxRes >= 30 && maxRes >= (yo.l.reviews || 0) * 1.5) add({ k: "resenas", p: 1, s: "Reputación y reseñas",
    h: `${lidRes.nombre} tiene ${fmtN(maxRes)} reseñas en Google; ${N} tiene ${fmtN(yo.l.reviews || 0)}`,
    corto: `${lidRes.nombre} tiene ${fmtN(maxRes)} reseñas en Google y tú, ${fmtN(yo.l.reviews || 0)}`,
    imp: `Cuando alguien busca en Google Maps, ¿a quién crees que llama primero: al que tiene ${fmtN(maxRes)} opiniones o al que tiene ${fmtN(yo.l.reviews || 0)}?`,
    ben: "Un sistema para pedir la reseña a cada cliente satisfecho en el momento justo, sin cargar al equipo." });
  if (yo.r.muestra && yo.r.pct_respuesta < 50) {
    const xs = q((n) => n.r.muestra && n.r.pct_respuesta >= 50);
    if (xs.length) add({ k: "respuesta", p: 1, s: "Reputación y reseñas",
      h: `${N} responde al ${pctTxt(yo.r.pct_respuesta)} de sus reseñas; ${deN(xs)} competidores responden a la mayoría`,
      corto: `respondes al ${pctTxt(yo.r.pct_respuesta)} de las reseñas y ${deN(xs)} de tus competidores responden a casi todas`,
      imp: "Un cliente nuevo que lee una opinión sin respuesta, ¿qué conclusión saca de cómo se le atenderá a él?",
      ben: "Respuesta profesional a cada reseña en menos de 48 horas, con protocolo para las negativas." });
  }
  if (yo.negPct != null && yo.negPct >= 15) add({ k: "negativas", p: 1, s: "Reputación y reseñas",
    h: `el ${pctTxt(yo.negPct)} de las ${fmtN(yo.r.muestra)} reseñas visibles analizadas de ${N} son de 1 o 2 ★`,
    corto: `${yo.r.muestra >= 5 ? `el ${pctTxt(yo.negPct)} de` : "varias de"} las últimas reseñas visibles en Google son de 1 o 2 estrellas`,
    imp: "¿Cuántos clientes crees que descartan un negocio después de leer una o dos críticas seguidas?",
    ben: "Detectar a tiempo al cliente insatisfecho y recuperar la conversación antes de que escriba." });
  if (!yo.senales.whatsapp) { const xs = q((n) => n.senales.whatsapp); if (xs.length) add({ k: "whatsapp", s: "Atención y ventas conversacionales",
    h: `${deN(xs)} competidores atienden por WhatsApp (${nombres(xs)}); ${N} no lo muestra`,
    corto: `${deN(xs)} de tus competidores atienden por WhatsApp y tú no lo muestras`,
    imp: "Si un cliente prefiere escribir antes que llamar, ¿dónde acaba escribiendo hoy?",
    ben: "WhatsApp Business conectado a la web y a Google, con respuesta en menos de 5 minutos." }); }
  if (!tieneAlguna(yo, ["chat", "agente_ia"])) {
    const xs = q((n) => tieneAlguna(n, ["chat", "agente_ia"]));
    if (xs.length) add({ k: "chat", s: "Atención y ventas conversacionales",
      h: `${deN(xs)} competidores atienden al momento con chat o asistente en su web; ${N} no`,
      corto: `${deN(xs)} de tus competidores atienden al momento desde su web y tú no`,
      imp: "¿Qué pasa con las consultas que llegan a las 22:00 o en domingo?",
      ben: "Un asistente que atiende, cualifica y agenda 24/7, y pasa al equipo lo que requiere a una persona." });
    else add({ k: "ia", p: 3, s: "Atención y ventas conversacionales", nuevo: true,
      h: `ninguno de los ${mo.ns.length} negocios comparados atiende de forma automática 24/7`,
      corto: `ninguno de los negocios de tu zona atiende de forma automática fuera de horario`,
      imp: "Si fueras el único que responde a cualquier hora, ¿cuántas consultas de tu competencia acabarían contigo?",
      ben: "Ser el primero de la zona con atención inmediata 24/7." });
  }
  if (!yo.senales.reserva_online) { const xs = q((n) => n.senales.reserva_online); if (xs.length) add({ k: "reserva", p: 1, s: "Atención y ventas conversacionales",
    h: `${deN(xs)} competidores permiten reservar online (${nombres(xs)}); ${N} no`,
    corto: `${nombres(xs)} ya permite${xs.length > 1 ? "n" : ""} reservar online y tú no`,
    imp: "El cliente que quiere reservar a las 23:00 desde el móvil, ¿con quién reserva?",
    ben: "Reserva online en la web, en Google y en WhatsApp, con recordatorios que reducen las ausencias." }); }
  if (!(yo.w && (yo.w.precios || []).length)) { const xs = q((n) => n.w && (n.w.precios || []).length); if (xs.length) add({ k: "precios", s: "Web, SEO y rendimiento",
    h: `${deN(xs)} competidores publican precios en su web; ${N} no`,
    corto: `${deN(xs)} de tus competidores publican precios y tú no`,
    imp: "Quien compara precios antes de llamar, ¿a quién llama si solo uno le da la información?",
    ben: "Servicios y precios «desde» publicados: menos preguntas repetidas y más clientes decididos." }); }
  if (!(yo.m.publicidad > 0)) { const xs = q((n) => n.m.publicidad > 0); if (xs.length) add({ k: "publicidad", s: "Medición y publicidad digital",
    h: `${deN(xs)} competidores tienen píxeles de publicidad en su web; ${N} ${yo.m.medicion ? "no" : "tampoco mide sus visitas"}`,
    corto: `${deN(xs)} de tus competidores pueden volver a impactar con anuncios a quien visitó su web y tú no`,
    imp: "De cada 100 personas que visitan tu web y se van, ¿cuántas vuelven hoy? ¿Cómo lo sabrías?",
    ben: "Medición completa y campañas con coste por cliente conocido." }); }
  if (yo.m.actividad !== "activo") { const xs = q((n) => n.m.actividad === "activo"); if (xs.length) add({ k: "redes", s: "Redes sociales y contenidos",
    h: `${deN(xs)} competidores han publicado en redes en los últimos 30 días; ${N} ${yo.m.nRedes ? "no muestra esa actividad" : "no tiene redes enlazadas"}`,
    corto: `${deN(xs)} de tus competidores publican en redes cada mes y tus redes ${yo.m.nRedes ? "no muestran esa actividad" : "no aparecen enlazadas"}`,
    imp: "Cuando alguien te busca en Instagram antes de venir, ¿qué imagen se lleva?",
    ben: "Calendario de contenidos constante que muestra el trabajo real y genera confianza." }); }
  const wb = area("web");
  if (!yo.l.website) add({ k: "sinweb", p: 1, s: "Web, SEO y rendimiento", h: `${N} no tiene web propia`, corto: "no tienes web propia",
    imp: "Quien no te conoce y busca más información, ¿dónde la encuentra?", ben: "Una web rápida, clara y preparada para convertir visitas en reservas." });
  else if (wb && wb.estado === "desventaja" && wb.lider) add({ k: "web", s: "Web, SEO y rendimiento",
    h: `la web de ${N} obtiene ${wb.vals[0]}/100 en salud técnica y SEO; la de ${wb.lider.nombre}, ${Math.round(wb.mejor)}/100`,
    corto: `tu web obtiene ${wb.vals[0]}/100 en salud técnica y SEO, frente a ${Math.round(wb.mejor)}/100 de ${wb.lider.nombre}`,
    imp: "Si tu web tarda o no se ve bien en el móvil, ¿cuántos se van antes de ver lo que ofreces?",
    ben: "Web más rápida, bien posicionada en Google y adaptada al móvil." });
  if (yo.hs && yo.hs.incompleto) add({ k: "horario", p: 3, s: "Reputación y reseñas", h: `el horario de ${N} en Google está incompleto`, corto: "tu horario en Google está incompleto",
    imp: "Si Google no sabe cuándo abres, ¿cuándo cree el cliente que estás cerrados?", ben: "Ficha de Google completa y optimizada." });
  return out.sort((a, b) => a.p - b.p);
}

// Fortalezas medidas que el cliente potencial puede aprovechar (el elogio sincero del primer contacto).
function fortalezasDe(mo, ac, dg) {
  const [yo] = mo.ns, out = [];
  if (yo.l.rating >= 4.5 && yo.l.reviews >= 10) out.push({ t: `valoración de ${num1(yo.l.rating)} ★ en Google`, corto: `la valoración de ${num1(yo.l.rating)} ★ que te dan tus clientes` });
  dg.bueno.slice(0, 3).forEach((b) => out.push({ t: b.t.replace(/^Tus clientes destacan/, "Sus clientes destacan").replace(/^Lideras en/, "Lidera en").replace(/^Solo tú ofreces/, "Es el único que ofrece"), corto: minus(b.t.replace(/^Tus clientes destacan: /, "lo que más destacan tus clientes: ").replace(/^Lideras en /, "tu liderazgo en ").replace(/^Solo tú ofreces: /, "que eres el único que ofrece ")), d: b.d }));
  ac.areas.filter((a) => a.estado === "ventaja").forEach((a) => out.push({ t: `Ventaja en ${minus(a.t)}`, corto: `tu ventaja en ${minus(a.t)}` }));
  if (!out.length) out.push({ t: `trayectoria en ${minus(yo.l.category || "su sector")}`, corto: `tu trayectoria como ${minus(yo.l.category || "negocio")}` });
  return out;
}

// Perfil comercial probable según los datos: define el ángulo de toda la conversación.
function perfilDe(mo, ac, dolores) {
  const [yo] = mo.ns;
  const lider = Math.max(...ac.indices.slice(1));
  const canales = ac.areas.find((a) => a.k === "canales").vals[0] ?? 0, mk = ac.areas.find((a) => a.k === "marketing").vals[0] ?? 0;
  const maxRes = Math.max(0, ...mo.ns.slice(1).map((n) => n.l.reviews || 0));
  if (ac.indices[0] >= lider) return { k: "lider", t: "Líder que quiere seguir liderando", icono: "trophy",
    motivo: "Tiene más que perder que ganar: su motivación es proteger su posición.", angulo: "Defender la posición: la competencia se mueve y copiar es rápido.",
    tono: "De igual a igual, con datos y sin alarmismo. Reconoce su liderazgo antes de todo.", cierre: "resumen" };
  if (yo.l.rating >= 4.6 && (yo.l.reviews || 0) < maxRes / 2) return { k: "invisible", t: "Buen producto, poca visibilidad", icono: "eye-off",
    motivo: "Sabe que trabaja bien y le frustra que otros con peor servicio capten más clientes.", angulo: "Que el mercado vea lo que ya hace bien: convertir su calidad en visibilidad.",
    tono: "Cercano y de reconocimiento: su orgullo profesional es la palanca.", cierre: "alternativa" };
  if ((yo.l.rating && yo.l.rating < 4.2) || (yo.negPct || 0) >= 20) return { k: "riesgo", t: "Reputación en riesgo", icono: "shield-alert",
    motivo: "Le preocupa lo que se dice de su negocio aunque no siempre lo reconozca.", angulo: "Proteger y recuperar la reputación antes de que cueste más clientes.",
    tono: "Empático y sin culpar: el problema tiene solución y un plan.", cierre: "prueba" };
  if (canales <= 30 && mk <= 25) return { k: "tradicional", t: "Negocio tradicional sin canales digitales", icono: "store",
    motivo: "Le ha ido bien con el boca a boca y desconfía de lo digital.", angulo: "No perder a los clientes que ya buscan y reservan por internet.",
    tono: "Sencillo, sin tecnicismos y con ejemplos de su calle.", cierre: "prueba" };
  return { k: "crecimiento", t: "Negocio en crecimiento", icono: "trending-up",
    motivo: "Quiere crecer y busca la forma más rentable de hacerlo.", angulo: "Acelerar: cerrar las brechas que frenan su crecimiento.",
    tono: "Orientado a resultados y a plazos concretos.", cierre: "alternativa" };
}

// Mejor ventana de contacto según su horario de Google: evitar la apertura y las horas punta.
function ventanaContacto(hours) {
  const gen = { t: "Martes a jueves, de 10:00 a 12:00 o de 16:00 a 17:30", nota: "Horario no publicado en Google: evita lunes a primera hora y viernes por la tarde." };
  if (!hours || !Object.keys(hours).length) return gen;
  const e = Object.entries(hours).find(([k]) => /^(mar|tue|mie|wed|jue|thu)/.test(plano(k)));
  if (!e) return gen;
  const t = (e[1] || []).join(",");
  if (/cerrad|closed/i.test(t)) return gen;
  if (/24\s*h|24 hours/i.test(t)) return { t: "Martes a jueves, de 10:00 a 12:00", nota: "Abre las 24 horas: elige horas de poca actividad." };
  const m = plano(t).replace(/\s/g, "").match(/(\d{1,2})(?::(\d{2}))?(a\.?m\.?|p\.?m\.?)?/);
  if (!m) return gen;
  let h = +m[1] + (m[2] ? +m[2] / 60 : 0);
  if (m[3] && m[3][0] === "p" && h < 12) h += 12;
  const hhmm = (x) => `${Math.floor(x)}:${String(Math.round((x % 1) * 60)).padStart(2, "0")}`;
  return { t: `Martes a jueves, de ${hhmm(h + 1)} a ${hhmm(h + 2.5)}`, nota: `Abre a las ${hhmm(h)}: deja pasar la primera hora de preparación y evita las horas punta.` };
}

// Canales para contactar, del más eficaz al menos, con los datos reales de su ficha.
function canalesDe(yo) {
  const c = [], l = yo.l;
  if (esMovil(l.phone)) c.push({ k: "whatsapp", t: "WhatsApp", v: l.phone, marca: "WhatsApp", uso: "Primer contacto breve y envío del informe" });
  if (l.phone) c.push({ k: "tel", t: "Teléfono", v: l.phone, ico: "phone", uso: "Llamada de 30 segundos para pedir 15 minutos" });
  (l.emails || []).slice(0, 2).forEach((e) => c.push({ k: "email", t: "Email", v: e, ico: "mail", uso: "Informe adjunto y propuesta formal" }));
  ["instagram", "facebook", "tiktok", "linkedin"].forEach((k) => { const r = yo.m.redes[k]; if (r && r.url) c.push({ k, t: REDES[k][1], v: r.url, marca: k, uso: "Toque social: seguir y comentar con valor" }); });
  if (l.website) c.push({ k: "web", t: "Formulario de su web", v: dominio(l.website), ico: "globe", uso: "Alternativa si no hay respuesta" });
  if (l.address) c.push({ k: "visita", t: "Visita presencial", v: l.address, ico: "map-pin", uso: "Entregar el informe impreso en persona" });
  return c;
}

// Paquetes de propuesta a partir de la hoja de ruta: la opción central es la recomendada (anclaje).
function paquetesDe(ruta) {
  const h0 = ruta.filter((x) => x.h === 0), h1 = ruta.filter((x) => x.h <= 1), todo = ruta;
  const base = h0.length ? h0 : ruta.slice(0, 3);
  return [
    { t: "Esencial", sub: "Resultados rápidos en 30 días", acc: base, rec: false },
    { t: "Crecimiento", sub: "Cerrar las brechas en 90 días", acc: h1.length > base.length ? h1 : ruta.slice(0, Math.min(ruta.length, base.length + 3)), rec: true },
    { t: "Liderazgo", sub: "Superar al líder en 180 días", acc: todo, rec: false },
  ];
}

/* ================= documento ================= */
function comercialHTML(mo) {
  const filas = evaluar(mo), dg = diagnostico(mo, filas), ac = areasCompetitivas(mo), ruta = hojaDeRuta(mo, ac);
  const [yo, ...rv] = mo.ns;
  const v = vendedor();
  const c1 = tonoLegible(v.c1 || "#1e40af"), c2 = v.c2 || "#60a5fa";
  const ph = (x, t) => (x ? eH(x) : `<span class="ph">[${t}]</span>`);
  const EMP = ph(v.empresa || mo.marca.por, "tu empresa"), ASE = ph(v.asesor, "tu nombre"), TEL = ph(v.telefono, "tu teléfono"), MAIL = ph(v.email, "tu email"), WEB = v.web ? eH(v.web) : "";
  const N = eH(yo.l.title);
  const dolores = doloresDe(mo, ac), fuertes = fortalezasDe(mo, ac, dg), perfil = perfilDe(mo, ac, dolores);
  const lider = mo.ns.map((n, i) => ({ n, v: ac.indices[i] })).slice(1).sort((a, b) => b.v - a.v)[0];
  const L = eH(lider.n.nombre);
  const zonas = ((mo.busqueda.Data || {}).zonas || []).map((z) => z.nombre).join(", ");
  const ZONA = eH(zonas || yo.l.city || "tu zona");
  const CAT = eH(minus(yo.l.category || "negocio"));
  const d1 = dolores[0], d2 = dolores[1] || dolores[0], d3 = dolores[2] || dolores[1] || dolores[0];
  const f1 = fuertes[0];
  const enDesv = ac.areas.filter((a) => a.estado === "desventaja");
  const canales = canalesDe(yo), ventana = ventanaContacto(yo.l.hours);
  const tiene = (k) => canales.some((c) => c.k === k);
  const red = canales.find((c) => ["instagram", "facebook", "tiktok"].includes(c.k));
  const paquetes = paquetesDe(ruta);
  const entrada = ruta.filter((x) => x.e === 1).sort((a, b) => b.i - a.i)[0] || ruta[0];
  const fecha = new Intl.DateTimeFormat("es", { dateStyle: "long" }).format(mo.fecha);
  const oportunidad = Math.round(Math.min(100, (100 - ac.indices[0]) * 0.6 + (enDesv.length / ac.areas.length) * 40));
  const nivelOp = oportunidad >= 60 ? ["Alta", "mal"] : oportunidad >= 35 ? ["Media", "par"] : ["Baja", "ok"];

  // Necesidad por línea de servicio: lo que le falta para llegar a 100 en las áreas que resuelve.
  const lineas = [...new Set(AREAS.map((a) => a.s))].map((s) => {
    const as = ac.areas.filter((a) => a.s === s && a.vals[0] != null);
    const nec = as.length ? Math.round(as.reduce((t, a) => t + (100 - a.vals[0]), 0) / as.length) : null;
    const desv = as.some((a) => a.estado === "desventaja");
    return { s, nec, desv, n: dolores.filter((d) => d.s === s).length };
  }).filter((x) => x.nec != null).sort((a, b) => b.nec - a.nec);

  const dato = (d) => (d ? eH(d.h) : "");
  const copiable = (id, titulo, cuerpo, meta = "") => `<div class="msg"><div class="msg-h"><b>${titulo}</b>${meta ? `<span>${meta}</span>` : ""}<button class="cp noprint" data-copiar="${id}">Copiar</button></div><div class="msg-b" id="${id}">${cuerpo}</div></div>`;
  const chk = (id, t) => `<label class="ck"><input type="checkbox" data-ck="${id}"><span>${t}</span></label>`;
  const icoCanal = (c) => (c.marca ? marcaSVG(c.marca, 16) : icoSVG(c.ico, 16));

  /* ---------- 1. resumen ---------- */
  const resumen = `
  <div class="blq">
    <h2>${icoSVG("clipboard-list", 22)} 1 · Resumen de la oportunidad<small>Todo lo que hay que saber de ${N} antes del primer contacto</small></h2>
    <div class="res-top">
      <div class="op"><span>Potencial de la oportunidad</span><b>${oportunidad}<small>/100</small></b><em class="${nivelOp[1]}">${nivelOp[0]}</em><p>${enDesv.length} de ${ac.areas.length} áreas en desventaja · índice ${ac.indices[0]}/100 frente a ${lider.v}/100 del líder</p></div>
      <div class="ficha">
        <div class="ficha-h">${avatar(yo, 40)}<div><b>${N}</b><span>${CAT} · ${eH(yo.l.address || "")}</span></div></div>
        <div class="ficha-g">
          <div>${marcaSVG("Google Maps", 16)}<span>${yo.l.rating ? `${num1(yo.l.rating)} ★ · ${fmtN(yo.l.reviews || 0)} reseñas` : "Sin reseñas"}</span></div>
          <div>${icoSVG("trophy", 16)}<span>#${yo.posicion} de ${mo.totalMercado} en su mercado</span></div>
          <div>${icoSVG("clock", 16)}<span>${!yo.hs ? "Horario no publicado" : yo.hs.incompleto ? "Horario incompleto en Google" : `${num1(yo.hs.horas)} h a la semana`}</span></div>
          <div>${icoSVG("globe", 16)}<span>${yo.l.website ? eH(dominio(yo.l.website)) : "Sin web propia"}</span></div>
        </div>
      </div>
    </div>
    <div class="perfil">
      <div class="perfil-i">${icoSVG(perfil.icono, 26)}</div>
      <div><span class="eti">Perfil comercial probable</span><b>${perfil.t}</b><p>${perfil.motivo}</p>
        <div class="perfil-g"><div><span>Ángulo de la conversación</span>${perfil.angulo}</div><div><span>Tono recomendado</span>${perfil.tono}</div></div></div>
    </div>
    <h3>Los tres ganchos</h3>
    <div class="ganchos">
      <div class="g ok">${icoSVG("heart-handshake", 20)}<span>Elogio sincero</span><b>${eH(f1.t.charAt(0).toUpperCase() + f1.t.slice(1))}</b><p>Abre siempre reconociendo lo que hace bien: es verdad y está medido.</p></div>
      <div class="g mal">${icoSVG("triangle-alert", 20)}<span>Dolor medido</span><b>${d1 ? eH(d1.h.charAt(0).toUpperCase() + d1.h.slice(1)) : "Sin brechas significativas"}</b><p>El dato que despierta el interés: su competencia ya lo hace.</p></div>
      <div class="g m1">${icoSVG("lightbulb", 20)}<span>Oportunidad</span><b>${eH((dg.innovar[0] || { t: entrada ? entrada.t : "Mejora continua" }).t)}</b><p>Lo que le permitiría adelantarse a ${L}.</p></div>
    </div>
    <h3>Qué necesita y qué ofrecerle</h3>
    <div class="nec">${lineas.map((x, i) => `<div class="nec-f${i === 0 ? " top" : ""}"><span class="nec-t">${eH(x.s)}${x.desv ? ' <em class="tg mal">desventaja</em>' : ""}</span><span class="nec-b"><i style="width:${x.nec}%"></i></span><b>${x.nec}</b><span class="nec-n">${x.n ? pl(x.n, "dolor detectado", "dolores detectados") : "mantener"}</span></div>`).join("")}</div>
    <p class="nota">Necesidad de 0 a 100: cuánto le falta para la excelencia en las áreas que resuelve cada línea de servicio.${entrada ? ` <b>Producto de entrada recomendado:</b> ${eH(entrada.t)} (alto impacto, poco esfuerzo: el «sí» más fácil).` : ""}</p>
    <div class="dos">
      <div><h3>Canales de contacto</h3><ul class="can">${canales.map((c) => `<li>${icoCanal(c)}<div><b>${eH(c.t)}</b><span>${eH(c.v)}</span><em>${eH(c.uso)}</em></div></li>`).join("") || `<li class="nd">Sin datos de contacto públicos.</li>`}</ul></div>
      <div><h3>Cuándo contactar</h3><div class="vent">${icoSVG("calendar-clock", 22)}<div><b>${eH(ventana.t)}</b><span>${eH(ventana.nota)}</span></div></div>
        <h3>El recorrido comercial</h3>
        <div class="emb">${[["snowflake", "Frío", "No te conoce", "Días 1-10"], ["book-open", "Informado", "Conoce su situación", "Días 7-14"], ["flame", "Caliente", "Reconoce la necesidad", "Días 14-21"], ["handshake", "Cliente", "Firma y arranca", "Día 21+"]].map(([ic, t, d, p], i) => `<div class="e e${i}">${icoSVG(ic, 18)}<b>${t}</b><span>${d}</span><em>${p}</em></div>`).join('<i class="fl">➜</i>')}</div>
      </div>
    </div>
  </div>`;

  /* ---------- 2. frío → informado ---------- */
  const primerCanal = tiene("whatsapp") ? "WhatsApp" : (yo.l.emails || []).length ? "Email" : tiene("tel") ? "Llamada" : red ? REDES[red.k][1] : "Visita";
  const ins = `Hola, ¿hablo con el responsable de ${N}? Soy ${ASE}, de ${EMP}.<br><br>Estamos analizando los negocios de ${CAT} en ${ZONA} y ${N} destaca por ${eH(f1.corto)}<br><br>${d1 ? `Hay un dato que creo que te interesa: ${eH(d1.corto)}.<br><br>` : ""}Te he preparado un informe breve y gratuito que compara ${N} con ${L} y otros ${rv.length - 1 > 0 ? rv.length - 1 : ""} competidores de la zona. ¿Te lo envío por aquí?`;
  const email = `<b>Asunto (elige uno):</b><ol class="as"><li>${N} frente a ${L}: el informe que te he preparado</li><li>Un dato de Google sobre ${N}</li><li>${eH(f1.t.charAt(0).toUpperCase() + f1.t.slice(1))}… y una oportunidad</li></ol>
    Hola, buenos días:<br><br>Soy ${ASE}, de ${EMP}. Hemos comparado ${fmtN(mo.totalMercado)} negocios de ${CAT} en ${ZONA} y ${N} destaca por ${eH(f1.corto)}.<br><br>Al compararlo con ${L} y el resto de su competencia directa aparecen tres diferencias que hoy le están costando clientes:<ul>${dolores.slice(0, 3).map((d) => `<li>${eH(d.h.charAt(0).toUpperCase() + d.h.slice(1))}.</li>`).join("")}</ul>Te adjunto el informe completo, gratuito y sin compromiso. Si te parece útil, lo comentamos en 15 minutos y te digo por dónde empezaría yo.<br><br>¿Te va bien el ${eH(ventana.t.split(",")[0].replace("Martes a jueves", "martes o el jueves"))}?<br><br>Un saludo,<br>${ASE} · ${EMP}<br>${TEL} · ${MAIL}${WEB ? ` · ${WEB}` : ""}`;
  const llamada = `«Hola, soy ${ASE}, de ${EMP}. ¿Tienes 30 segundos? Te llamo porque hemos analizado ${fmtN(mo.totalMercado)} negocios de ${CAT} en ${ZONA} y ${N} aparece en el puesto #${yo.posicion}. ${d1 ? `Hemos visto que ${eH(d1.corto)}.` : ""} Tengo un informe con tres cosas concretas que hacen ${L} y otros para captar más clientes. No te voy a vender nada por teléfono: ¿te lo envío y lo comentamos 15 minutos esta semana?»`;
  const llamada2 = `«Hola, soy ${ASE}, de ${EMP}. ${primerCanal === "Llamada" ? "Te llamé hace un par de días" : "Te escribí hace un par de días"} por el informe que compara ${N} con ${L}. Te robo un minuto: lo más llamativo es que ${d1 ? eH(d1.corto) : "la competencia de la zona se está moviendo"}. ¿Te lo envío y lo vemos 15 minutos el jueves?»`;
  const buzon = `«Hola, soy ${ASE}, de ${EMP}. Te he preparado un informe gratuito que compara ${N} con ${L} y otros negocios de ${ZONA}. Te lo envío${tiene("whatsapp") ? " por WhatsApp" : " por email"} y te llamo el jueves. Mi teléfono: ${TEL}. ¡Gracias!»`;
  const dia5 = `${N}: te comparto un dato del informe que te preparé<br><br>${d2 ? eH(d2.h.charAt(0).toUpperCase() + d2.h.slice(1)) + "." : ""}<br><br>${d2 ? eH(d2.imp) : ""}<br><br>Si te interesa, te explico en 15 minutos cómo lo resuelven los que van por delante. ¿Te viene mejor mañana o el jueves?`;
  const ruptura = `Hola de nuevo. Entiendo que ahora no es prioridad y no quiero insistir.<br><br>Te dejo la conclusión principal del informe por si te sirve más adelante: ${d1 ? eH(d1.corto) : "la competencia de la zona se está moviendo"}.<br><br>¿Lo cierro por mi parte o prefieres que te escriba el mes que viene?`;
  const pasosFrio = [
    { d: "Día 1", ic: "search", t: "Preparación (15 min)", c: `<div class="cks">${chk("f1", `Revisar la ficha de Google de ${N} y leer sus 5 últimas reseñas`)}${chk("f2", `Mirar ${red ? `su ${REDES[red.k][1]}` : "sus redes"} y anotar una publicación reciente`)}${chk("f3", "Tener abierto el informe competitivo (páginas 2 y 3)")}${chk("f4", `Confirmar el canal: ${primerCanal}`)}</div>` },
    { d: "Día 1", ic: "send", t: `Primer contacto · ${primerCanal}`, c: primerCanal === "WhatsApp" ? copiable("m-wa", `${marcaSVG("WhatsApp", 15)} Mensaje de WhatsApp`, ins, "máx. 5 líneas · sin adjuntos") : primerCanal === "Email" ? copiable("m-em", `${icoSVG("mail", 15)} Email`, email) : copiable("m-ll", `${icoSVG("phone", 15)} Apertura de llamada`, llamada, "30 segundos") },
    red && { d: "Día 2", ic: "heart", t: `Toque social · ${REDES[red.k][1]}`, c: `<p>Sigue a ${N} y deja un comentario con valor en una publicación reciente (nunca un anuncio). Ejemplo: «${eH(f1.corto.charAt(0).toUpperCase() + f1.corto.slice(1))}: se nota en cada trabajo».</p>` },
    tiene("tel") && { d: "Día 3", ic: "phone-call", t: "Llamada de seguimiento", c: copiable("m-ll2", `${icoSVG("phone", 15)} Guion de 30 segundos (otra franja horaria)`, llamada2) + copiable("m-bz", `${icoSVG("voicemail", 15)} Si salta el buzón`, buzon, "15 segundos") },
    (yo.l.emails || []).length && primerCanal !== "Email" && { d: "Día 3", ic: "mail", t: "Email con el informe", c: copiable("m-em", `${icoSVG("mail", 15)} Email`, email) },
    { d: "Día 5", ic: "bar-chart-3", t: "Segundo toque con un dato", c: copiable("m-d5", `${icoSVG("message-circle", 15)} Mensaje con dato`, dia5, "adjunta la imagen del termómetro") },
    yo.l.address && { d: "Día 7", ic: "map-pin", t: "Visita presencial", c: `<p>Ve ${eH(ventana.t.toLowerCase())} con el informe impreso. Pregunta por el responsable; si no está, deja el informe con una nota a mano: «Para el responsable de ${N}: tres ideas para captar más clientes. ${ASE}, ${TEL}». Nunca vendas en el mostrador: pide 15 minutos otro día.</p>` },
    { d: "Día 10", ic: "door-open", t: "Mensaje de cierre de ciclo", c: copiable("m-rp", `${icoSVG("message-circle", 15)} Mensaje de ruptura`, ruptura, "suele obtener la tasa de respuesta más alta") },
  ].filter(Boolean);
  const frio = `
  <div class="blq salto">
    <h2>${icoSVG("snowflake", 22)} 2 · De frío a informado<small>Objetivo: que ${N} conozca su situación frente a la competencia y acepte 15 minutos para verla</small></h2>
    <div class="obj"><div>${icoSVG("target", 18)}<b>Objetivo</b><span>Que vea el informe y acepte una reunión de 15-30 minutos</span></div><div>${icoSVG("timer", 18)}<b>Duración</b><span>10 días · ${pasosFrio.length} pasos, de menor a mayor implicación</span></div><div>${icoSVG("flag", 18)}<b>Pasa a «informado» cuando</b><span>Ha abierto el informe, ha respondido o ha aceptado la reunión</span></div></div>
    <div class="tl">${pasosFrio.map((p) => `<div class="tl-p"><div class="tl-d"><span>${p.d}</span>${icoSVG(p.ic, 18)}</div><div class="tl-c"><b>${eH(p.t)}</b>${p.c}</div></div>`).join("")}</div>
    <div class="dos">
      <div class="card ok-b"><h3>${icoSVG("circle-check", 16)} Hazlo así</h3><ul>
        <li>Personaliza siempre con su nombre, su dato y su competidor: nada de plantillas genéricas.</li>
        <li>Da valor antes de pedir: el informe es gratis y útil aunque no compre.</li>
        <li>Un mensaje, una sola pregunta, un solo siguiente paso.</li>
        <li>Registra cada toque y su respuesta en el CRM el mismo día.</li></ul></div>
      <div class="card mal-b"><h3>${icoSVG("circle-x", 16)} Evita</h3><ul>
        <li>Hablar de precios o de tus servicios antes de que vea su situación.</li>
        <li>Criticar su trabajo: el problema son las brechas, no las personas.</li>
        <li>Enviar el informe sin contexto ni siguiente paso.</li>
        <li>Insistir después del mensaje de cierre de ciclo.</li></ul></div>
    </div>
  </div>`;

  /* ---------- 3. informado → caliente ---------- */
  const tramos = [["0-3", "Conexión", "users", 3], ["3-10", "Descubrimiento", "search", 7], ["10-18", "Hallazgos", "bar-chart-3", 8], ["18-23", "Visión", "sparkles", 5], ["23-28", "Compromiso", "handshake", 5]];
  const hallazgo = (d, i) => d ? `<div class="hz2"><div class="hz2-n">${i + 1}</div><div><b>${eH(d.h.charAt(0).toUpperCase() + d.h.slice(1))}</b>
      <p><span class="eti">Cómo decirlo</span>«Mira este dato: ${eH(d.corto)}. No es una opinión: es lo que ve cualquier cliente que te compara.»</p>
      <p><span class="eti">Pregunta de confirmación</span>«¿Te encaja con lo que notas en el día a día?»</p>
      <p><span class="eti">Lo que resuelve</span>${eH(d.ben)} <em class="tg">${eH(d.s)}</em></p></div></div>` : "";
  const vision = ruta.filter((x) => x.h <= 1).slice(0, 4);
  const guion = `
  <div class="blq salto">
    <h2>${icoSVG("presentation", 22)} 3 · Guion de informado a caliente<small>Reunión de diagnóstico de 25-30 minutos: que ${N} reconozca la necesidad y pida una propuesta</small></h2>
    <div class="reloj">${tramos.map(([m, t, ic, w]) => `<div style="flex:${w}">${icoSVG(ic, 16)}<b>${t}</b><span>min ${m}</span></div>`).join("")}</div>
    <div class="fase"><h3><span>0-3</span> Conexión y agenda</h3>
      ${copiable("g-1", "Apertura", `«Gracias por el rato. Antes de nada: ${eH(f1.corto)} se nota, y no es fácil. En 25 minutos te enseño dónde está ${N} frente a ${L} y los demás, me cuentas cómo trabajas y vemos si tiene sentido hacer algo. Si no lo tiene, te lo diré yo. ¿Te parece?»`)}
      <p class="tip">${icoSVG("info", 14)} Dar permiso para decir «no» baja la guardia y genera confianza. Tono: ${eH(perfil.tono.toLowerCase())}</p></div>
    <div class="fase"><h3><span>3-10</span> Descubrimiento: preguntas que le hacen ver la necesidad</h3>
      <div class="spin">
        <div class="sp s"><b>Situación</b><span>Cómo trabaja hoy</span><ul><li>¿Cómo te llegan hoy los clientes nuevos: recomendación, Google, redes…?</li><li>¿Quién responde las reseñas y los mensajes, y cuándo?</li><li>¿Qué pasa con una consulta que llega fuera de horario?</li></ul></div>
        <div class="sp p"><b>Problema</b><span>Lo que le frena</span><ul>${dolores.slice(0, 3).map((d) => `<li>Hemos visto que ${eH(d.corto)}. ¿Por qué crees que pasa?</li>`).join("") || "<li>¿Qué es lo que más te cuesta hoy para captar clientes nuevos?</li>"}</ul></div>
        <div class="sp i"><b>Implicación</b><span>Lo que le cuesta</span><ul>${dolores.slice(0, 3).map((d) => `<li>${eH(d.imp)}</li>`).join("") || "<li>¿Qué supondría para el negocio que la competencia te adelantara este año?</li>"}</ul></div>
        <div class="sp n"><b>Necesidad</b><span>Lo que ganaría</span><ul>${dolores.slice(0, 3).map((d) => `<li>¿Qué supondría para ti tener ${eH(minus(d.ben.replace(/\.$/, "")))}?</li>`).join("") || "<li>¿Qué tendría que pasar para que dentro de 6 meses dijerais que ha merecido la pena?</li>"}</ul></div>
      </div>
      <p class="tip">${icoSVG("ear", 14)} Escucha el 70 % del tiempo. Anota sus palabras exactas: las usarás en la propuesta y en el cierre.</p></div>
    <div class="fase"><h3><span>10-18</span> Los tres hallazgos del informe</h3>${[d1, d2 !== d1 && d2, d3 !== d2 && d3].filter(Boolean).map(hallazgo).join("") || `<p class="nd">Sin brechas significativas: presenta sus fortalezas y cómo defenderlas.</p>`}</div>
    <div class="fase"><h3><span>18-23</span> Visión: cómo sería en 90 días</h3>
      ${copiable("g-4", "Frase puente", `«Imagina ${N} dentro de 90 días: ${vision.map((x) => eH(minus(x.kpi))).join("; ")}. Eso es exactamente lo que ya está haciendo ${L}, pero con ${eH(f1.corto)}.»`)}
      <div class="calc"><h4>${icoSVG("calculator", 16)} Calculadora de oportunidad (rellénala con él)</h4>
        <div class="calc-g"><label>Ticket medio<input type="number" id="cTicket" placeholder="€ / $"></label><label>Clientes nuevos al mes<input type="number" id="cCli" placeholder="nº"></label><label>Mejora prudente<input type="number" id="cMej" value="10"> %</label></div>
        <p class="calc-r">Ingresos adicionales: <b id="cMes">____</b> al mes · <b id="cAno">____</b> al año</p>
        <p class="nota">Ticket × clientes nuevos × mejora. Usa sus cifras, no las tuyas: el cálculo es suyo y por eso le convence.</p></div></div>
    <div class="fase"><h3><span>23-28</span> Compromiso y cualificación</h3>
      <div class="dos">
        <div><h4>Confirma antes de proponer</h4><div class="cks">${chk("q1", "<b>Necesidad:</b> ha reconocido al menos un dolor con sus palabras")}${chk("q2", "<b>Decisor:</b> «Además de ti, ¿quién más participa en la decisión?»")}${chk("q3", "<b>Inversión:</b> «¿Tienes una partida para captación o marketing?»")}${chk("q4", "<b>Plazo:</b> «¿Para cuándo te gustaría ver los primeros resultados?»")}${chk("q5", "<b>Prioridad:</b> «Del 1 al 10, ¿cómo de importante es resolverlo este trimestre?»")}</div></div>
        <div>${copiable("g-5", "Cierre de la reunión", `«Con lo que me has contado, te preparo una propuesta con tres opciones, de la más sencilla a la más completa. ¿La vemos juntos el ${eH(ventana.t.split(",")[0].replace("Martes a jueves", "martes o el jueves"))}? Si decides con alguien más, que venga también: así lo veis juntos.»`)}</div>
      </div></div>
    <h3>Señales de compra y cómo responder</h3>
    <table class="tb"><thead><tr><th>Si dice o hace…</th><th>Significa</th><th>Responde</th></tr></thead><tbody>
      <tr><td>«¿Y cuánto tiempo se tarda?»</td><td>Ya se imagina el resultado</td><td>Da el plazo de la primera mejora: «${eH(entrada ? entrada.kpi : "primeros resultados en 30 días")}».</td></tr>
      <tr><td>«¿Cómo lo hace ${L}?»</td><td>Se compara: le importa</td><td>Enseña la página de su competencia en el informe y vuelve a su caso.</td></tr>
      <tr><td>Pregunta por el precio</td><td>Interés real</td><td>«Depende de la opción; te traigo tres. ¿Qué rango te encaja?»</td></tr>
      <tr><td>Llama a su socio o encargado</td><td>Busca validación</td><td>Invítale a la siguiente reunión.</td></tr>
      <tr><td>Toma notas o hace capturas</td><td>Lo va a defender internamente</td><td>Ofrece enviarle el resumen por escrito hoy.</td></tr>
    </tbody></table>
    <div class="cks bloque">${["Reconoce la necesidad con sus palabras", "Sabemos quién decide", "Ha dado un rango de inversión o un plazo", "Ha aceptado la reunión de propuesta"].map((t, i) => chk("c" + i, t)).join("")}<span class="eti">✔ Con los cuatro marcados, el cliente está <b>caliente</b></span></div>
  </div>`;

  /* ---------- 4. caliente → cliente ---------- */
  const tecnicas = {
    resumen: ["Cierre por resumen", `«Recapitulando: ${d1 ? eH(d1.corto) : "tu competencia se está moviendo"}${d2 && d2 !== d1 ? ` y ${eH(d2.corto)}` : ""}. Con la opción Crecimiento lo resolvemos en 90 días y lo medimos cada mes. ¿Lo ponemos en marcha?»`],
    alternativa: ["Cierre por alternativa", `«¿Empezamos con Crecimiento, que cubre todo lo que hemos hablado, o prefieres arrancar con Esencial y ampliar a los 30 días?»`],
    prueba: ["Cierre de prueba (piloto)", `«Hagamos un piloto de 30 días con ${eH(entrada ? minus(entrada.t) : "la primera mejora")}. Si no ves el avance medido, lo dejamos ahí. ¿Te parece justo?»`],
  };
  const orden = [perfil.cierre, ...Object.keys(tecnicas).filter((k) => k !== perfil.cierre)];
  const segs = [["Día 2", "Resolver dudas", `«¿Has podido revisar la propuesta con quien decide contigo? Si hay algo que no encaja, lo ajustamos.»`], ["Día 5", "Aportar valor", `«Te comparto algo nuevo: ${d3 ? eH(d3.corto) : "la competencia sigue publicando y sumando reseñas"}. Con la propuesta lo resolvemos desde el primer mes.»`], ["Día 10", "Facilitar la decisión", "«¿Qué necesitarías ver para decidir? Puedo ajustar el alcance o empezar por un piloto.»"], ["Día 30", "Reabrir con un dato actualizado", `«He vuelto a medir a ${N} y a su competencia. ¿Te enseño qué ha cambiado este mes?»`]];
  const cierre = `
  <div class="blq salto">
    <h2>${icoSVG("handshake", 22)} 4 · Cierre: de caliente a cliente nuevo<small>Propuesta a medida, técnica de cierre según su perfil y arranque sin riesgo</small></h2>
    <h3>La propuesta: tres opciones, una recomendada</h3>
    <div class="paq">${paquetes.map((p, i) => `<div class="pq${p.rec ? " rec" : ""}">${p.rec ? '<span class="pq-r">Recomendada</span>' : ""}<b>${p.t}</b><span>${p.sub}</span>
      <ul>${i ? `<li class="pq-t">${icoSVG("layers", 13)} Todo lo de ${paquetes[i - 1].t}, más:</li>` : ""}${p.acc.filter((x) => !i || !paquetes[i - 1].acc.includes(x)).map((x) => `<li>${icoSVG("check", 13)} ${eH(x.t)}</li>`).join("")}</ul>
      <div class="pq-k">${[...new Set(p.acc.map((x) => x.s))].map((s) => `<em class="tg">${eH(s)}</em>`).join("")}</div>
      <div class="pq-p">Inversión: <input class="pr-in" placeholder="__________"></div></div>`).join("")}</div>
    <p class="tip">${icoSVG("info", 14)} Presenta primero la opción completa, después la recomendada y por último la esencial: la del medio se percibe como la más razonable. Cada acción lleva su KPI medible (ver la hoja de ruta del informe).</p>
    <h3>Cómo presentar la propuesta (15 minutos)</h3>
    <div class="flujo2">${[["message-square-quote", "Su problema, con sus palabras", "Repite lo que dijo en la reunión: «me dijiste que…»"], ["layers", "Tres opciones", "De la completa a la esencial, con lo que incluye cada una"], ["star", "Tu recomendación", "Crecimiento, y por qué encaja con su plazo y su prioridad"], ["shield-check", "Riesgo cero", "KPIs medibles, informe mensual y re-análisis trimestral"], ["pen-line", "La pregunta de cierre", "Y después: silencio. El siguiente que habla, cede"]].map(([ic, t, d], i) => `<div>${icoSVG(ic, 20)}<b>${i + 1}. ${t}</b><span>${d}</span></div>`).join('<i class="fl">➜</i>')}</div>
    <h3>Técnicas de cierre (en orden para el perfil «${eH(perfil.t)}»)</h3>
    ${orden.map((k, i) => copiable("t-" + k, `${i === 0 ? "★ " : ""}${tecnicas[k][0]}`, tecnicas[k][1], i === 0 ? "recomendada para este perfil" : "alternativa")).join("")}
    <div class="dos">
      <div><h3>Primeros 30 días (se entrega con la propuesta)</h3>
        <div class="tl mini">${[["Días 1-3", "key-round", "Accesos, reunión de arranque y medición inicial"], ["Semana 1", "zap", entrada ? entrada.t : "Primeras mejoras rápidas"], ["Semanas 2-3", "wrench", "Resto de acciones del horizonte de 30 días"], ["Día 30", "file-bar-chart", "Informe de resultados frente a la competencia"]].map(([d, ic, t]) => `<div class="tl-p"><div class="tl-d"><span>${d}</span>${icoSVG(ic, 16)}</div><div class="tl-c"><b>${eH(t)}</b></div></div>`).join("")}</div></div>
      <div><h3>Si no cierra: seguimiento</h3>
        <div class="tl mini">${segs.map(([d, t, m]) => `<div class="tl-p"><div class="tl-d"><span>${d}</span>${icoSVG("repeat", 16)}</div><div class="tl-c"><b>${t}</b><p>${m}</p></div></div>`).join("")}</div></div>
    </div>
    <div class="card ok-b"><h3>${icoSVG("megaphone", 16)} Después de la firma: convertirlo en promotor</h3><ul>
      <li><b>Día 1:</b> bienvenida con el calendario del arranque y un único interlocutor.</li>
      <li><b>Día 30:</b> enséñale el avance medido frente a ${L}; celebra la primera mejora.</li>
      <li><b>Día 45:</b> con el resultado a la vista, pídele una reseña y una recomendación: «¿Conoces a otro negocio al que le pueda ayudar esto?».</li>
      <li><b>Cada trimestre:</b> nuevo análisis competitivo y propuesta del siguiente paso (${eH(paquetes[2].sub.toLowerCase())}).</li></ul></div>
  </div>`;

  /* ---------- 5. objeciones ---------- */
  const obj = [
    ["clock", "«No tengo tiempo»", "Está saturado: lo último que quiere es otra tarea.", `Precisamente por eso. Hoy ${d1 ? eH(d1.corto) : "la competencia se mueve"}, y resolverlo no te quita tiempo: lo hacemos nosotros y tú solo validas. Te pido 15 minutos al mes para ver resultados.`, "«¿Qué día de la semana tienes más calma para una llamada corta?»"],
    ["wallet", "«Es caro / no tengo presupuesto»", "Teme gastar sin retorno.", `Lo entiendo; por eso empezamos por ${eH(entrada ? minus(entrada.t) : "lo de mayor impacto")}, que es lo que antes se nota. Y lo medimos: si un cliente nuevo al mes cubre la inversión, ¿cuántos clientes te cuesta hoy que ${L} ${d1 && d1.k === "resenas" ? "tenga más reseñas" : "vaya por delante"}?`, "«Si el coste no fuera el problema, ¿lo pondrías en marcha?»"],
    ["users", "«Ya tengo a alguien que me lleva esto»", "Lealtad o miedo a cambiar.", `Genial, eso suma. El informe es una segunda opinión con datos: ${dolores.length ? `hoy ${eH(dolores[0].corto)}` : "hay margen de mejora medible"}. Podemos trabajar con esa persona o complementarla.`, "«¿Te ha enseñado alguna vez cómo estás frente a tu competencia?»"],
    ["thumbs-up", "«Me va bien así, tengo clientes»", "Satisfecho: no siente urgencia.", `Y se nota: ${eH(f1.corto)}. Lo que muestra el informe es cuánto más podría ir: ${L} tiene un índice de ${lider.v}/100 frente a tu ${ac.indices[0]}/100, y esa diferencia son clientes que hoy eligen a otro.`, "«¿Te gustaría que el boca a boca también funcionara en Google?»"],
    ["mail", "«Mándame información»", "Forma educada de cerrar la conversación.", "Claro. Para enviarte solo lo que te sirva: de estas tres diferencias, ¿cuál te preocupa más?", "«¿Lo repasamos juntos 10 minutos el jueves, cuando lo hayas leído?»"],
    ["user-check", "«Tengo que consultarlo con mi socio»", "No decide solo o necesita respaldo.", "Me parece muy bien. Para que tu socio tenga toda la información, ¿te parece si se lo presento a los dos? Así no tienes que hacer de intermediario.", "«¿Qué crees que le preocupará más a tu socio?»"],
    ["history", "«Ya lo probé y no funcionó»", "Mala experiencia previa: desconfianza.", "Te entiendo, y es más frecuente de lo que parece. La diferencia es que aquí todo se mide frente a tu competencia desde el primer día: si no avanza, lo ves en el informe mensual.", "«¿Qué falló la otra vez?» (escúchalo entero y úsalo)"],
    ["star-off", "«Las reseñas o las redes no me traen clientes»", "No ve la relación con las ventas.", `Es lo primero que mira quien no te conoce: ${d1 && d1.k === "resenas" ? eH(d1.corto) : `${N} tiene ${fmtN(yo.l.reviews || 0)} reseñas en Google`}. Antes de llamar, el cliente compara.`, "«Cuando buscas un sitio nuevo, ¿qué es lo primero que miras?»"],
    ["bot", "«No me fío de la IA / mis clientes quieren trato humano»", "Teme perder la cercanía.", "Coincido: el trato humano es tu ventaja. El asistente solo atiende lo repetitivo y fuera de horario, y te pasa a ti lo importante. Más tiempo para el trato personal.", "«¿Cuántas consultas repetidas respondes cada semana?»"],
    ["calendar-x", "«Ahora no es buen momento»", "Temporada alta, cambios u otra prioridad.", "Lo entiendo. Justo por eso conviene preparar ahora lo que dará resultado cuando llegue el momento fuerte: las reseñas y el posicionamiento tardan semanas en notarse.", "«¿Cuándo sería buen momento? Lo dejo agendado.»"],
    ["hammer", "«Lo hago yo mismo»", "Control y ahorro.", "Perfecto; el informe te da la lista exacta de qué hacer. La pregunta es si tu hora vale más haciendo esto o atendiendo a tus clientes.", "«¿Cuántas horas a la semana le puedes dedicar con constancia?»"],
  ];
  const objeciones = `
  <div class="blq salto">
    <h2>${icoSVG("messages-square", 22)} 5 · Manual de objeciones<small>Cada objeción es una pregunta sin responder: escucha, valida, responde con su dato y avanza</small></h2>
    <div class="laer">${[["ear", "Escucha", "Sin interrumpir"], ["heart", "Valida", "«Te entiendo…»"], ["search", "Explora", "«¿Qué te preocupa exactamente?»"], ["bar-chart-3", "Responde", "Con su dato, no con opiniones"], ["arrow-right", "Avanza", "Una pregunta hacia el siguiente paso"]].map(([ic, t, d]) => `<div>${icoSVG(ic, 18)}<b>${t}</b><span>${d}</span></div>`).join('<i class="fl">➜</i>')}</div>
    <div class="objs">${obj.map(([ic, t, detras, resp, preg]) => `<div class="ob"><div class="ob-h">${icoSVG(ic, 18)}<b>${t}</b></div><p><span class="eti">Qué hay detrás</span>${detras}</p><p><span class="eti">Responde</span>${resp}</p><p class="ob-q"><span class="eti">Y pregunta</span>${preg}</p></div>`).join("")}</div>
  </div>`;

  /* ---------- 6. atención y oportunidades ---------- */
  const mapaOp = [
    ...dolores.map((d) => ({ tipo: d.nuevo ? "Innovación" : "Necesidad", cls: d.nuevo ? "m1" : "mal", t: d.h, s: d.s, arg: d.ben, p: d.p })),
    ...fuertes.slice(0, 3).map((f) => ({ tipo: "Aprovechamiento", cls: "ok", t: f.t, s: "Redes sociales y contenidos", arg: "Convertir esta fortaleza en contenido, reseñas y mensajes de venta.", p: 2 })),
    ...dg.innovar.slice(0, 3).map((x) => ({ tipo: "Innovación", cls: "m1", t: x.t, s: "Atención y ventas conversacionales", arg: x.d, p: 3 })),
  ];
  const atencion = `
  <div class="blq salto">
    <h2>${icoSVG("map", 22)} 6 · Mapa de oportunidades de venta<small>Todas las oportunidades detectadas en ${N}: necesidad, aprovechamiento e innovación</small></h2>
    <table class="tb"><thead><tr><th>Tipo</th><th>Oportunidad (dato medido)</th><th>Línea de servicio</th><th>Argumento</th><th>Prioridad</th></tr></thead><tbody>
      ${mapaOp.map((o) => `<tr><td><em class="tg ${o.cls}">${o.tipo}</em></td><td>${eH(o.t.charAt(0).toUpperCase() + o.t.slice(1))}</td><td>${eH(o.s)}</td><td>${eH(o.arg)}</td><td>${"●".repeat(4 - Math.min(3, o.p))}<span class="nd">${"●".repeat(Math.min(3, o.p) - 1)}</span></td></tr>`).join("")}
    </tbody></table>
    <h3>Escalera de valor: de la primera venta al cliente de largo plazo</h3>
    <div class="esc2">${paquetes.map((p, i) => `<div style="margin-top:${(2 - i) * 22}px"><b>${p.t}</b><span>${p.sub}</span><em>${[...new Set(p.acc.map((x) => x.s))].length} líneas de servicio</em></div>`).join("")}<div style="margin-top:0"><b>Promotor</b><span>Recomienda y renueva</span><em>Re-análisis trimestral</em></div></div>
  </div>
  <div class="blq salto">
    <h2>${icoSVG("heart-handshake", 22)} 7 · Atención al cliente en cada contacto<small>Directrices para que cada conversación con ${N} sume: promotor, comercial y asesor a la vez</small></h2>
    <div class="dir">${[
      ["heart", "Empatía primero", "Reconoce su esfuerzo y su contexto antes de hablar de datos. Nunca culpes: las brechas son oportunidades."],
      ["bar-chart-3", "Datos, no opiniones", "Cada afirmación va con su dato del informe. Si no hay dato, pregunta."],
      ["ear", "Escucha activa", "Habla el 30 %. Resume lo que dice («Si te he entendido bien…») antes de responder."],
      ["timer", "Tiempos de respuesta", "WhatsApp en menos de 1 hora en horario laboral; email en menos de 4 horas; nunca más de 24."],
      ["target", "Un siguiente paso siempre", "Ninguna conversación termina sin fecha y acción acordadas."],
      ["shield-check", "Promete solo lo medible", "Compromisos con KPI y fecha. Nada de garantías de ventas que no controlas."],
    ].map(([ic, t, d]) => `<div>${icoSVG(ic, 20)}<b>${t}</b><span>${d}</span></div>`).join("")}</div>
    <h3>Lenguaje que suma y lenguaje que resta</h3>
    <table class="tb lg"><thead><tr><th>✔ Di</th><th>✘ Evita</th></tr></thead><tbody>
      ${[["«Te he preparado…»", "«Te quería vender…»"], ["«Tu competencia ya…»", "«Lo estás haciendo mal»"], ["«¿Qué te preocupa exactamente?»", "«Pero es que…»"], ["«Lo medimos cada mes»", "«Te garantizo que vas a vender más»"], ["«Inversión»", "«Gasto» o «coste»"], ["«¿Qué día te viene mejor?»", "«¿Te interesa?»"], ["«Te entiendo; muchos clientes pensaban lo mismo…»", "«No tienes razón»"]].map(([a, b]) => `<tr><td class="si">${eH(a)}</td><td class="no">${eH(b)}</td></tr>`).join("")}
    </tbody></table>
    <h3>Protocolo ante cada situación</h3>
    <div class="prot">${[["Pide información", "Envíala en el momento con una pregunta concreta y fecha para comentarla."], ["Se queja o está molesto", "Escucha entero, valida («tienes razón en que…»), propone solución y fecha. Nunca discutas."], ["Deja de responder", "Sigue la cadencia de seguimiento y cierra el ciclo con el mensaje de ruptura."], ["Pide descuento", "No bajes el precio: ajusta el alcance (opción Esencial) o el calendario."], ["Compara con otro proveedor", "Pregunta qué le ofrecen y vuelve al dato: ¿le han medido frente a su competencia?"], ["Ya es cliente", "Informe mensual, reunión trimestral y propuesta del siguiente nivel de la escalera."]].map(([t, d]) => `<div><b>${t}</b><span>${d}</span></div>`).join("")}</div>
    <div class="firma2">${EMP}${v.asesor ? ` · ${ASE}` : ""}${v.telefono ? ` · ${TEL}` : ""}${v.email ? ` · ${MAIL}` : ""}${WEB ? ` · ${WEB}` : ""}</div>
  </div>`;

  const css = `
  :root{--m1:${c1};--m2:${c2};--tx:#0f172a;--tx2:#475569;--tx3:#64748b;--ln:#e2e8f0;--bg2:#f8fafc;--ok:#15803d;--okb:#dcfce7;--mal:#b91c1c;--malb:#fee2e2;--par:#b45309}
  *{box-sizing:border-box}html,body{margin:0}body{font:13px/1.55 "Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--tx);-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .pag{max-width:1000px;margin:0 auto;padding:28px 34px}
  .portada{background:var(--m1);color:#fff;padding:42px 40px 36px;position:relative;overflow:hidden}.portada::after{content:"";position:absolute;right:-80px;top:-80px;width:300px;height:300px;border-radius:50%;background:var(--m2);opacity:.35}
  .portada>*{position:relative;z-index:1}.portada .eti{color:#fff;opacity:.85}.portada h1{font-size:32px;line-height:1.15;margin:6px 0 8px}.portada p{margin:4px 0;opacity:.92}
  .cta{display:flex;gap:12px;align-items:center;background:#fff;color:var(--tx);border-radius:12px;padding:10px 14px;margin-top:22px;max-width:560px}.cta b{display:block;font-size:15px}.cta span{font-size:12px;color:var(--tx3)}
  .indice{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-top:22px}.indice div{background:rgba(255,255,255,.14);border-radius:10px;padding:10px;font-size:11.5px}.indice b{display:block;font-size:18px}
  h2{font-size:20px;margin:30px 0 10px;color:var(--m1);border-bottom:3px solid var(--m2);padding-bottom:6px}h2 .ic{margin-right:6px;vertical-align:-4px}h2 small{display:block;font-size:12px;font-weight:400;color:var(--tx3)}
  h3{font-size:14px;margin:18px 0 8px}h4{margin:0 0 6px;font-size:13px}
  .ic,.bi{vertical-align:-3px;flex:none}
  .av{display:inline-grid;place-items:center;border-radius:8px;border:1px solid var(--ln);overflow:hidden;flex:none;padding:3px;background:#fff}.av img{max-width:100%;max-height:100%;object-fit:contain}.av.ini{border-radius:50%;background:#94a3b8;color:#fff;font-weight:700;border:0}
  .eti{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--tx3)}
  .ph{background:#fef3c7;color:#92400e;border-radius:3px;padding:0 3px}
  .tg{display:inline-block;font-style:normal;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:var(--bg2);color:var(--m1);text-transform:uppercase;letter-spacing:.02em}.tg.mal{background:var(--malb);color:var(--mal)}.tg.ok{background:var(--okb);color:var(--ok)}.tg.m1{background:color-mix(in srgb,var(--m1) 12%,#fff);color:var(--m1)}
  .nd{color:var(--tx3)}.nota{font-size:11.5px;color:var(--tx2)}.tip{font-size:11.5px;color:var(--tx2);background:var(--bg2);border-radius:8px;padding:6px 10px}
  .card{border:1px solid var(--ln);border-radius:10px;padding:10px 14px;break-inside:avoid}.card ul{margin:4px 0;padding-left:18px}.card li{margin:3px 0}.card h3{margin:2px 0 4px}.ok-b{border-left:5px solid var(--ok)}.mal-b{border-left:5px solid var(--mal)}
  .dos{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}
  .res-top{display:grid;grid-template-columns:220px 1fr;gap:14px}.op{background:var(--m1);color:#fff;border-radius:12px;padding:14px}.op span{font-size:11.5px;opacity:.9}.op b{display:block;font-size:48px;line-height:1.05}.op b small{font-size:16px;opacity:.8}.op em{display:inline-block;font-style:normal;font-weight:700;background:#fff;border-radius:4px;padding:1px 8px;font-size:12px}.op em.mal{color:var(--mal)}.op em.par{color:var(--par)}.op em.ok{color:var(--ok)}.op p{font-size:11px;opacity:.9;margin:8px 0 0}
  .ficha{border:1px solid var(--ln);border-radius:12px;padding:12px}.ficha-h{display:flex;gap:10px;align-items:center}.ficha-h b{display:block;font-size:15px}.ficha-h span{font-size:11.5px;color:var(--tx3)}
  .ficha-g{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.ficha-g div{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--m1)}.ficha-g span{color:var(--tx)}
  .perfil{display:flex;gap:14px;border:1px solid var(--ln);border-left:5px solid var(--m1);border-radius:12px;padding:12px 14px;margin-top:12px}.perfil-i{width:48px;height:48px;border-radius:12px;background:var(--bg2);color:var(--m1);display:grid;place-items:center;flex:none}.perfil b{font-size:15px}.perfil p{margin:2px 0 8px;color:var(--tx2)}
  .perfil-g{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px}.perfil-g span{display:block;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--m1)}
  .ganchos{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.g{border-radius:12px;padding:12px;break-inside:avoid}.g span{display:block;font-size:10px;font-weight:700;text-transform:uppercase;margin-top:4px}.g b{display:block;font-size:13px;margin:2px 0}.g p{font-size:11px;color:var(--tx2);margin:4px 0 0}
  .g.ok{background:var(--okb);color:var(--ok)}.g.mal{background:var(--malb);color:var(--mal)}.g.m1{background:color-mix(in srgb,var(--m1) 10%,#fff);color:var(--m1)}.g b{color:var(--tx)}
  .nec{display:grid;gap:6px}.nec-f{display:grid;grid-template-columns:260px 1fr 34px 140px;gap:10px;align-items:center;font-size:12px}.nec-f.top .nec-t{font-weight:700}.nec-b{height:12px;background:var(--bg2);border-radius:0 4px 4px 0}.nec-b i{display:block;height:100%;background:#94a3b8;border-radius:0 4px 4px 0}.nec-f.top .nec-b i{background:var(--m1)}.nec-f b{text-align:right}.nec-n{font-size:11px;color:var(--tx3)}
  .can{list-style:none;margin:0;padding:0;display:grid;gap:6px}.can li{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--ln);border-radius:8px;padding:7px 10px;color:var(--m1)}.can b{display:block;font-size:12px;color:var(--tx)}.can span{display:block;font-size:11px;color:var(--tx2);word-break:break-all}.can em{display:block;font-style:normal;font-size:10.5px;color:var(--tx3)}
  .vent{display:flex;gap:10px;align-items:center;background:var(--bg2);border-radius:10px;padding:10px 12px;color:var(--m1)}.vent b{display:block;color:var(--tx)}.vent span{font-size:11px;color:var(--tx3)}
  .emb{display:flex;align-items:stretch;gap:4px}.emb .e{flex:1;border-radius:10px;padding:8px;text-align:center;font-size:11px}.emb b{display:block;font-size:12.5px}.emb span{display:block;color:var(--tx2);font-size:10.5px}.emb em{display:block;font-style:normal;font-size:10px;color:var(--tx3)}
  .e0{background:#e0f2fe;color:#0369a1}.e1{background:#fef3c7;color:#b45309}.e2{background:#fee2e2;color:#b91c1c}.e3{background:#dcfce7;color:#15803d}.fl{align-self:center;color:#94a3b8;font-style:normal}
  .obj{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}.obj div{background:var(--bg2);border-radius:10px;padding:10px 12px;color:var(--m1)}.obj b{display:block;color:var(--tx);font-size:12.5px;margin-top:2px}.obj span{font-size:11.5px;color:var(--tx2)}
  .tl{position:relative;display:grid;gap:10px}.tl-p{display:grid;grid-template-columns:92px 1fr;gap:12px;break-inside:avoid}.tl-d{display:flex;flex-direction:column;align-items:center;gap:4px;color:var(--m1);position:relative}.tl-d span{background:var(--m1);color:#fff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap}
  .tl-p:not(:last-child) .tl-d::after{content:"";position:absolute;top:44px;bottom:-14px;width:2px;background:var(--ln)}.tl-c{border:1px solid var(--ln);border-radius:10px;padding:8px 12px}.tl-c>b{display:block;margin-bottom:4px}.tl-c p{margin:4px 0;font-size:12px;color:var(--tx2)}
  .tl.mini .tl-p{grid-template-columns:92px 1fr}.tl.mini .tl-c{padding:6px 10px;font-size:12px}
  .msg{border:1px solid var(--ln);border-radius:10px;margin:6px 0;overflow:hidden;break-inside:avoid}.msg-h{display:flex;gap:8px;align-items:center;background:var(--bg2);padding:6px 10px;font-size:12px}.msg-h span{font-size:10.5px;color:var(--tx3)}.msg-h .cp{margin-left:auto}
  .msg-b{padding:8px 12px;font-size:12.5px;line-height:1.55}.msg-b ul{margin:6px 0;padding-left:18px}.as{margin:2px 0 8px;padding-left:18px;font-size:12px;color:var(--m1)}
  .cp{border:1px solid var(--ln);background:#fff;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer}.cp.ok{background:var(--okb);color:var(--ok)}
  .cks{display:grid;gap:4px}.ck{display:flex;gap:8px;align-items:flex-start;font-size:12px}.ck input{margin-top:3px;accent-color:var(--m1)}.cks.bloque{border:2px dashed var(--m2);border-radius:10px;padding:10px 12px;margin-top:10px}
  .reloj{display:flex;gap:3px;margin:6px 0 12px}.reloj div{background:var(--m1);color:#fff;padding:8px;text-align:center;font-size:11px}.reloj div:first-child{border-radius:10px 0 0 10px}.reloj div:last-child{border-radius:0 10px 10px 0}.reloj b{display:block;font-size:12px}.reloj span{opacity:.85}
  .reloj div:nth-child(2){opacity:.9}.reloj div:nth-child(3){opacity:.8}.reloj div:nth-child(4){opacity:.9}
  .fase{border-left:3px solid var(--m2);padding:2px 0 4px 14px;margin:12px 0;break-inside:avoid}.fase h3{margin:4px 0 6px;display:flex;gap:8px;align-items:center}.fase h3 span{background:var(--m1);color:#fff;border-radius:6px;padding:1px 7px;font-size:11px}
  .spin{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.sp{border-radius:10px;padding:10px;font-size:11.5px}.sp b{display:block;font-size:13px}.sp>span{font-size:10.5px;color:var(--tx3)}.sp ul{margin:6px 0 0;padding-left:16px}.sp li{margin:3px 0}
  .sp.s{background:#e0f2fe}.sp.p{background:#fef3c7}.sp.i{background:#fee2e2}.sp.n{background:#dcfce7}
  .hz2{display:grid;grid-template-columns:30px 1fr;gap:10px;border:1px solid var(--ln);border-radius:10px;padding:10px;margin:6px 0;break-inside:avoid}.hz2-n{width:28px;height:28px;border-radius:50%;background:var(--m1);color:#fff;font-weight:700;display:grid;place-items:center}.hz2 p{margin:5px 0 0;font-size:12px;color:var(--tx2)}
  .calc{border:2px solid var(--m2);border-radius:12px;padding:10px 14px;margin-top:8px;break-inside:avoid}.calc-g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.calc label{font-size:11px;color:var(--tx3)}.calc input,.pr-in{display:block;width:100%;border:1px solid var(--ln);border-radius:6px;padding:5px 8px;font:inherit}.calc label:last-child input{display:inline-block;width:70px}
  .calc-r{font-size:14px;margin:8px 0 2px}.calc-r b{color:var(--m1);font-size:17px}
  .tb{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0}.tb th,.tb td{border-bottom:1px solid var(--ln);padding:6px 8px;text-align:left;vertical-align:top}.tb thead th{background:var(--bg2);font-size:11px;color:var(--tx2)}.tb tr{break-inside:avoid}.tb td.si{color:var(--ok)}.tb td.no{color:var(--mal)}
  .paq{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;align-items:start}.pq{border:1px solid var(--ln);border-radius:12px;padding:14px;position:relative;break-inside:avoid}.pq.rec{border:2px solid var(--m1);box-shadow:0 6px 18px rgba(15,23,42,.08)}.pq-r{position:absolute;top:-10px;right:12px;background:var(--m1);color:#fff;font-size:10px;font-weight:700;border-radius:10px;padding:2px 10px;text-transform:uppercase}
  .pq>b{display:block;font-size:17px;color:var(--m1)}.pq>span{font-size:11.5px;color:var(--tx3)}.pq ul{list-style:none;margin:8px 0;padding:0;font-size:11.5px}.pq li{margin:4px 0;display:flex;gap:6px}.pq li .ic{color:var(--ok);margin-top:3px}.pq li.pq-t{font-weight:700;color:var(--m1)}.pq li.pq-t .ic{color:var(--m1)}.pq-k{display:flex;flex-wrap:wrap;gap:4px}.pq-p{margin-top:10px;font-size:12px;font-weight:700}
  .flujo2,.laer{display:flex;align-items:stretch;gap:4px;margin:6px 0}.flujo2>div,.laer>div{flex:1;background:var(--bg2);border-radius:10px;padding:8px;text-align:center;color:var(--m1);font-size:11px}.flujo2 b,.laer b{display:block;color:var(--tx);font-size:12px;margin-top:3px}.flujo2 span,.laer span{color:var(--tx2)}
  .objs{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ob{border:1px solid var(--ln);border-radius:12px;padding:10px 12px;break-inside:avoid}.ob-h{display:flex;gap:8px;align-items:center;color:var(--m1)}.ob-h b{color:var(--tx);font-size:13px}.ob p{margin:6px 0 0;font-size:12px;color:var(--tx2)}.ob-q{background:var(--bg2);border-radius:6px;padding:4px 8px;color:var(--tx)!important}
  .esc2{display:flex;gap:8px;align-items:flex-start}.esc2 div{flex:1;background:color-mix(in srgb,var(--m1) 12%,#fff);border-top:4px solid var(--m1);border-radius:8px;padding:10px}.esc2 div:last-child{background:var(--okb);border-color:var(--ok)}.esc2 b{display:block}.esc2 span{display:block;font-size:11.5px;color:var(--tx2)}.esc2 em{font-style:normal;font-size:10.5px;color:var(--tx3)}
  .dir{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.dir div{border:1px solid var(--ln);border-radius:10px;padding:10px 12px;color:var(--m1);break-inside:avoid}.dir b{display:block;color:var(--tx);margin-top:4px}.dir span{font-size:11.5px;color:var(--tx2)}
  .prot{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.prot div{background:var(--bg2);border-radius:8px;padding:8px 10px;font-size:11.5px;break-inside:avoid}.prot b{display:block;font-size:12px}.prot span{color:var(--tx2)}
  .firma2{margin-top:24px;border-top:1px solid var(--ln);padding-top:10px;font-size:11px;color:var(--tx3)}
  @page{size:A4;margin:12mm 11mm}
  @media print{.pag{padding:0}.salto{break-before:page}.blq{break-inside:auto}.portada{margin:-12mm -11mm 0;padding:34mm 16mm 18mm}h2,h3{break-after:avoid}.noprint{display:none!important}}
  @media screen and (max-width:760px){.dos,.res-top,.ganchos,.obj,.spin,.paq,.objs,.dir,.prot,.calc-g,.indice,.perfil-g,.ficha-g{grid-template-columns:1fr}.nec-f{grid-template-columns:1fr 60px 30px}.nec-n{display:none}.emb,.flujo2,.laer,.esc2{flex-direction:column}.fl{display:none}}`;

  const js = `(function(){var K="gmaps.crm.${eH(yo.l.link).replace(/[^a-zA-Z0-9]/g, "").slice(-24)}";var s={};try{s=JSON.parse(localStorage.getItem(K))||{}}catch(e){}
document.querySelectorAll("[data-ck]").forEach(function(c){c.checked=!!s[c.dataset.ck];c.onchange=function(){s[c.dataset.ck]=c.checked;try{localStorage.setItem(K,JSON.stringify(s))}catch(e){}}});
document.querySelectorAll("[data-copiar]").forEach(function(b){b.onclick=function(){var t=document.getElementById(b.dataset.copiar).innerText;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent="Copiado";b.classList.add("ok");setTimeout(function(){b.textContent="Copiar";b.classList.remove("ok")},1500)}).catch(function(){})}});
var f=function(){var t=+document.getElementById("cTicket").value,c=+document.getElementById("cCli").value,m=+document.getElementById("cMej").value;if(!t||!c){return}var x=Math.round(t*c*m/100);var n=new Intl.NumberFormat("es");document.getElementById("cMes").textContent=n.format(x);document.getElementById("cAno").textContent=n.format(x*12)};
["cTicket","cCli","cMej"].forEach(function(i){var e=document.getElementById(i);if(e)e.oninput=f})})();`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${eH(nombreComercial())}</title><style>${css}</style></head><body>
  <section class="portada">
    <span class="eti">${EMP} · Documentación comercial${v.asesor ? ` · ${ASE}` : ""}</span>
    <h1>Plan comercial para ${N}</h1>
    <p>De primer contacto a cliente nuevo: resumen, proceso, guion, cierre, objeciones y atención, a medida de su situación competitiva.</p>
    <p>${CAT} · ${eH(yo.l.address || ZONA)} · ${eH(fecha)}</p>
    <div class="cta">${avatar(yo, 44)}<div><b>${N}</b><span>Índice competitivo ${ac.indices[0]}/100 · #${yo.posicion} de ${mo.totalMercado} · perfil «${eH(perfil.t)}» · potencial ${nivelOp[0].toLowerCase()}</span></div></div>
    <div class="indice">${[["1", "Resumen"], ["2", "Frío → informado"], ["3", "Informado → caliente"], ["4", "Cierre"], ["5", "Objeciones"], ["6", "Oportunidades"], ["7", "Atención"]].map(([n, t]) => `<div><b>${n}</b>${t}</div>`).join("")}</div>
  </section>
  <div class="pag">${resumen}${frio}${guion}${cierre}${objeciones}${atencion}</div>
  <script>${js}</script>
  </body></html>`;
}
