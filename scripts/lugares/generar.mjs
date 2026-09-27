// Genera web/lugares/{PAIS}.json.gz: el catálogo de lugares elegibles en el buscador
// (regiones, provincias, municipios, localidades, barrios y códigos postales), con
// los nombres y códigos de los registros oficiales de cada país.
//
// Fuentes oficiales: INE (España), DANE-DIVIPOLA (Colombia), INEGI (México) y
// Georef del Gobierno de Argentina. Coordenadas, barrios y códigos postales:
// GeoNames (CC BY 4.0), que usa los códigos oficiales de cada país (INE, INEGI,
// DIVIPOLA, ubigeo del INEI, código comunal de Chile), así que se enlazan por
// código y no por nombre. El catálogo de SEPOMEX NO se usa: su licencia prohíbe
// el uso comercial y la redistribución.
//
// Uso: node scripts/lugares/generar.mjs <carpeta de trabajo>   (requiere el paquete npm «xlsx»)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const TMP = process.argv[2];
if (!TMP) throw new Error("Uso: node generar.mjs <carpeta de trabajo>");
mkdirSync(TMP, { recursive: true });
const require = createRequire(join(TMP, "x.js"));
const XLSX = require("xlsx");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SALIDA = join(RAIZ, "web", "lugares");
mkdirSync(SALIDA, { recursive: true });

const PAISES = ["ES", "MX", "CO", "PE", "CL", "AR", "EC"];

/* ---------- descargas (con caché en la carpeta de trabajo) ---------- */
function bajar(url, fichero) {
  const f = join(TMP, fichero);
  if (!existsSync(f)) {
    console.log("descargando", url);
    execFileSync("curl", ["-sSfL", "-m", "300", "-A", "Mozilla/5.0", "-o", f, url]);
  }
  return f;
}
function unzip(zip, dentro, sub = "") {
  const dir = join(TMP, sub);
  const f = join(dir, dentro);
  if (!existsSync(f)) { mkdirSync(dir, { recursive: true }); execFileSync("unzip", ["-o", "-q", zip, dentro, "-d", dir]); }
  return f;
}
async function json(url, fichero) {
  const f = join(TMP, fichero);
  if (!existsSync(f)) {
    console.log("consultando", url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " → " + r.status);
    writeFileSync(f, await r.text());
  }
  return JSON.parse(readFileSync(f, "utf8"));
}
const tsv = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));

/* ---------- utilidades de nombres ---------- */
const MINUS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "d.c.", "o", "san"]);
function titulo(s) {
  // «SAN JOSÉ DEL GUAVIARE» → «San José del Guaviare» (DIVIPOLA viene en mayúsculas).
  return s.toLowerCase().split(/(\s+|-|\()/).map((w, i) => (i > 0 && MINUS.has(w) && w !== "san" ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("")
    .replace(/\bD\.c\./i, "D. C.");
}
// «Ballestero, El» → «El Ballestero» (así nombra el INE los municipios con artículo).
const articulo = (s) => s.replace(/^(.+), (El|La|Los|Las|L'|Els|Les|O|A|Os|As|Es|Sa|Ses|S')$/u, (_, n, a) => (a.endsWith("'") ? a + n : a + " " + n));
const media = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e5) / 1e5 : null);
const r5 = (v) => Math.round(v * 1e5) / 1e5;

/* ---------- GeoNames ---------- */
const postal = {};
for (const cc of PAISES) postal[cc] = tsv(unzip(bajar(`https://download.geonames.org/export/zip/${cc}.zip`, `zip_${cc}.zip`), `${cc}.txt`));
const ciudades = tsv(unzip(bajar("https://download.geonames.org/export/dump/cities1000.zip", "cities1000.zip"), "cities1000.txt"))
  .filter((c) => PAISES.includes(c[8]) && c[6] === "P");

// item: [tipo, nombre, contexto, lat, lon, cp, código oficial, fuente, población]
function catalogo(cc, niveles, fuentes) {
  const items = [];
  // bbox opcional: [latMín, lonMín, latMáx, lonMáx] del límite oficial.
  const add = (tipo, nombre, ctx, lat, lon, cp = "", cod = "", fuente = "", pob = 0, bbox = null) => {
    if (!nombre || lat == null || lon == null || Number.isNaN(lat)) return;
    const it = [tipo, nombre, ctx, r5(lat), r5(lon), cp, cod, fuente, pob || 0];
    if (bbox) it.push(bbox.map(r5));
    items.push(it);
  };
  return { cc, niveles, fuentes, items, add };
}

// Localidades y barrios de GeoNames que no repiten el nombre de su municipio.
// Además de cities1000 (núcleos de más de 1.000 habitantes), los barrios (PPLX)
// del volcado completo del país, solo si traen el código de su municipio oficial.
function localidades(cat, cc, municipioDe, fuente = "geonames", barriosDelVolcado = false) {
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const vistos = new Set();
  let filas = ciudades.filter((c) => c[8] === cc);
  if (barriosDelVolcado) {
    const f = unzip(bajar(`https://download.geonames.org/export/dump/${cc}.zip`, `dump_${cc}.zip`), `${cc}.txt`, `volcado_${cc}`);
    filas = filas.concat(tsv(f).filter((c) => c[7] === "PPLX"));
  }
  let n = 0;
  for (const c of filas) {
    const m = municipioDe(c);
    if (!m) continue;
    const k = norm(c[1]) + "|" + m.cod;
    if (norm(c[1]) === norm(m.nombre) || vistos.has(k)) continue;
    vistos.add(k);
    const tipo = c[7] === "PPLX" ? "barrio" : "localidad";
    cat.add(tipo, c[1], m.ctxCompleto, +c[4], +c[5], "", m.cod, fuente, +c[14]);
    n++;
  }
  return n;
}

// Códigos postales agrupados: un elemento por código, con sus municipios.
function codigosPostales(cat, filas, municipioDe, fuente = "geonames", nota = "") {
  const grupos = new Map();
  for (const f of filas) {
    const g = grupos.get(f[1]) || { lat: [], lon: [], munis: new Map(), lugares: new Set() };
    g.lat.push(+f[9]); g.lon.push(+f[10]); g.lugares.add(f[2]);
    const m = municipioDe(f);
    if (m) g.munis.set(m.cod, m);
    grupos.set(f[1], g);
  }
  for (const [cp, g] of grupos) {
    const ms = [...g.munis.values()];
    if (!ms.length) continue;
    const ctx = (ms.length === 1 ? ms[0].ctxCompleto : `${ms.slice(0, 3).map((m) => m.nombre).join(", ")}${ms.length > 3 ? "…" : ""} · ${ms[0].ctxPadre}`) + nota;
    cat.add("cp", cp, ctx, media(g.lat), media(g.lon), cp, ms.map((m) => m.cod).join(","), fuente);
  }
  return grupos.size;
}

// Recuadro de cada término municipal según CartoCiudad (IGN), por código INE.
async function terminosCartoCiudad(codigos) {
  const dir = join(TMP, "cartociudad");
  mkdirSync(dir, { recursive: true });
  const out = new Map();
  let i = 0, pedidos = 0;
  const trabajador = async () => {
    while (i < codigos.length) {
      const cod = codigos[i++];
      const f = join(dir, cod + ".json");
      let txt;
      if (existsSync(f)) txt = readFileSync(f, "utf8");
      else {
        for (let intento = 0; intento < 3 && txt === undefined; intento++) {
          try {
            const r = await fetch(`https://www.cartociudad.es/geocoder/api/geocoder/find?id=${cod.replace(/^0/, "")}&type=Municipio`);
            if (r.ok) txt = await r.text();
          } catch (e) { await new Promise((ok) => setTimeout(ok, 1000)); }
        }
        if (txt === undefined) continue;
        writeFileSync(f, txt);
        pedidos++;
      }
      try {
        const g = JSON.parse(txt).geom || "";
        const nums = g.match(/-?\d+\.\d+/g);
        if (!nums) continue;
        let a = 90, b = 180, c = -90, d = -180;
        for (let k = 0; k + 1 < nums.length; k += 2) { const lon = +nums[k], lat = +nums[k + 1]; a = Math.min(a, lat); c = Math.max(c, lat); b = Math.min(b, lon); d = Math.max(d, lon); }
        out.set(cod, [a, b, c, d]);
      } catch (e) { /* respuesta sin geometría */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabajador));
  console.log(`CartoCiudad: ${out.size} de ${codigos.length} términos (${pedidos} consultados ahora)`);
  return out;
}

/* ================= España: INE ================= */
async function espana() {
  const CCAA = { "01": "Andalucía", "02": "Aragón", "03": "Principado de Asturias", "04": "Illes Balears", "05": "Canarias", "06": "Cantabria", "07": "Castilla y León", "08": "Castilla-La Mancha", "09": "Cataluña/Catalunya", "10": "Comunitat Valenciana", "11": "Extremadura", "12": "Galicia", "13": "Comunidad de Madrid", "14": "Región de Murcia", "15": "Comunidad Foral de Navarra", "16": "País Vasco/Euskadi", "17": "La Rioja", "18": "Ceuta", "19": "Melilla" };
  const PROV = { "01": "Araba/Álava", "02": "Albacete", "03": "Alicante/Alacant", "04": "Almería", "05": "Ávila", "06": "Badajoz", "07": "Illes Balears", "08": "Barcelona", "09": "Burgos", "10": "Cáceres", "11": "Cádiz", "12": "Castellón/Castelló", "13": "Ciudad Real", "14": "Córdoba", "15": "A Coruña", "16": "Cuenca", "17": "Girona", "18": "Granada", "19": "Guadalajara", "20": "Gipuzkoa", "21": "Huelva", "22": "Huesca", "23": "Jaén", "24": "León", "25": "Lleida", "26": "La Rioja", "27": "Lugo", "28": "Madrid", "29": "Málaga", "30": "Murcia", "31": "Navarra", "32": "Ourense", "33": "Asturias", "34": "Palencia", "35": "Las Palmas", "36": "Pontevedra", "37": "Salamanca", "38": "Santa Cruz de Tenerife", "39": "Cantabria", "40": "Segovia", "41": "Sevilla", "42": "Soria", "43": "Tarragona", "44": "Teruel", "45": "Toledo", "46": "Valencia/València", "47": "Valladolid", "48": "Bizkaia", "49": "Zamora", "50": "Zaragoza", "51": "Ceuta", "52": "Melilla" };
  const cat = catalogo("ES", { region: "Comunidad autónoma", provincia: "Provincia", municipio: "Municipio" },
    { ine: "INE · Relación de municipios a 1-1-2026", geonames: "GeoNames (CC BY 4.0), enlazado por código INE", cartociudad: "CartoCiudad (IGN), verificado al elegir" });
  const filas = XLSX.utils.sheet_to_json(XLSX.readFile(bajar("https://www.ine.es/daco/daco42/codmun/diccionario26.xlsx", "ine26.xlsx")).Sheets.dic25 ||
    Object.values(XLSX.readFile(join(TMP, "ine26.xlsx")).Sheets)[0], { header: 1 }).slice(2).filter((r) => r[1]);
  const pts = new Map(); // código INE → coordenadas de sus códigos postales
  for (const f of postal.ES) { const p = pts.get(f[8]) || []; p.push([+f[9], +f[10]]); pts.set(f[8], p); }
  const capital = new Map(); // código INE → núcleo principal (GeoNames, el más poblado)
  for (const c of ciudades.filter((c) => c[8] === "ES" && c[7] !== "PPLX")) { const k = c[12]; if (k && (!capital.has(k) || +c[14] > +capital.get(k)[14])) capital.set(k, c); }
  // Término municipal oficial de CartoCiudad (IGN): recuadro para validar resultados
  // y centro para los municipios sin núcleo en GeoNames.
  const limites = await terminosCartoCiudad(filas.map((r) => r[1] + r[2]));
  const munis = new Map(), porProv = new Map(), porCA = new Map();
  let sinCoord = 0, conBBox = 0;
  for (const [ca, cpro, cmun, , nombreIne] of filas) {
    const cod = cpro + cmun, nombre = articulo(String(nombreIne));
    const cap = capital.get(cod), p = pts.get(cod), bb = limites.get(cod);
    // Centro: el núcleo principal si cae dentro del término oficial; si no (GeoNames
    // lo tiene mal asignado en ~1 % de los casos), sus CP; y si no, el centro del término.
    const dentro = (la, lo) => !bb || (la >= bb[0] - 0.005 && la <= bb[2] + 0.005 && lo >= bb[1] - 0.005 && lo <= bb[3] + 0.005);
    let lat = null, lon = null;
    const pm = p ? [media(p.map((x) => x[0])), media(p.map((x) => x[1]))] : null;
    if (cap && dentro(+cap[4], +cap[5])) { lat = +cap[4]; lon = +cap[5]; }
    else if (pm && dentro(pm[0], pm[1])) { [lat, lon] = pm; }
    else if (bb) { lat = (bb[0] + bb[2]) / 2; lon = (bb[1] + bb[3]) / 2; }
    else if (pm) { [lat, lon] = pm; }
    if (lat == null) { sinCoord++; continue; }
    if (bb) conBBox++;
    const m = { cod, nombre, ctxPadre: `${PROV[cpro]} · ${CCAA[ca]}`, lat, lon, pob: cap ? +cap[14] : 0 };
    m.ctxCompleto = `${nombre} · ${m.ctxPadre}`;
    munis.set(cod, m);
    (porProv.get(cpro) || porProv.set(cpro, []).get(cpro)).push(m);
    (porCA.get(ca) || porCA.set(ca, { prov: new Set(), m: [] }).get(ca)).m.push(m);
    porCA.get(ca).prov.add(cpro);
    cat.add("municipio", nombre, m.ctxPadre, lat, lon, "", cod, "ine", m.pob, bb);
  }
  console.log(`ES: ${conBBox} municipios con término oficial de CartoCiudad`);
  for (const [cpro, ms] of porProv) {
    const ca = filas.find((r) => r[1] === cpro)[0];
    cat.add("provincia", PROV[cpro], CCAA[ca], media(ms.map((m) => m.lat)), media(ms.map((m) => m.lon)), "", cpro, "ine");
  }
  for (const [ca, g] of porCA) if (g.prov.size > 1 || PROV[[...g.prov][0]] !== CCAA[ca])
    cat.add("region", CCAA[ca], "España", media(g.m.map((m) => m.lat)), media(g.m.map((m) => m.lon)), "", ca, "ine");
  const nl = localidades(cat, "ES", (c) => munis.get(c[12]), "geonames", true);
  const ncp = codigosPostales(cat, postal.ES, (f) => munis.get(f[8]), "geonames");
  console.log(`ES: ${munis.size} municipios INE (${sinCoord} sin coordenadas), ${nl} localidades/barrios, ${ncp} CP`);
  return cat;
}

/* ================= México: INEGI ================= */
async function mexico() {
  const cat = catalogo("MX", { region: "Estado", municipio: "Municipio" },
    { inegi: "INEGI · Marco Geoestadístico (servicio wscatgeo)", geonames: "GeoNames (CC BY 4.0), enlazado por clave INEGI" });
  const estados = (await json("https://gaia.inegi.org.mx/wscatgeo/v2/mgee/", "inegi_mgee.json")).datos;
  const pts = new Map();
  for (const f of postal.MX) { const k = f[4] + f[6]; const p = pts.get(k) || []; p.push([+f[9], +f[10]]); pts.set(k, p); }
  const munis = new Map();
  for (const e of estados) {
    const ms = (await json(`https://gaia.inegi.org.mx/wscatgeo/v2/mgem/${e.cve_ent}`, `inegi_mgem_${e.cve_ent}.json`)).datos;
    const coords = [];
    for (const m of ms) {
      const p = pts.get(m.cve_ent + m.cve_mun);
      if (!p) continue;
      const mm = { cod: m.cvegeo, nombre: m.nomgeo, ctxPadre: e.nomgeo, lat: media(p.map((x) => x[0])), lon: media(p.map((x) => x[1])) };
      mm.ctxCompleto = `${mm.nombre} · ${e.nomgeo}`;
      munis.set(m.cvegeo, mm);
      coords.push(mm);
      cat.add("municipio", m.nomgeo, e.nomgeo, mm.lat, mm.lon, "", m.cvegeo, "inegi", +m.pob_total);
    }
    cat.add("region", e.nomgeo, "México", media(coords.map((m) => m.lat)), media(coords.map((m) => m.lon)), "", e.cve_ent, "inegi", +e.pob_total);
  }
  // Colonias y asentamientos (con su código postal) y localidades.
  let na = 0;
  for (const f of postal.MX) {
    const m = munis.get(f[4] + f[6]);
    if (!m) continue;
    cat.add("barrio", f[2], `CP ${f[1]} · ${m.ctxCompleto}`, +f[9], +f[10], f[1], m.cod, "geonames");
    na++;
  }
  const nl = localidades(cat, "MX", (c) => munis.get(c[10] + c[11]));
  const ncp = codigosPostales(cat, postal.MX, (f) => munis.get(f[4] + f[6]));
  console.log(`MX: ${estados.length} estados, ${munis.size} municipios INEGI, ${na} colonias, ${nl} localidades, ${ncp} CP`);
  return cat;
}

/* ================= Colombia: DANE ================= */
async function colombia() {
  const cat = catalogo("CO", { region: "Departamento", municipio: "Municipio" },
    { dane: "DANE · DIVIPOLA (municipios y coordenadas oficiales)", geonames: "GeoNames (CC BY 4.0), enlazado por código DIVIPOLA" });
  const wb = XLSX.readFile(bajar("https://geoportal.dane.gov.co/descargas/divipola/DIVIPOLA_Municipios.xlsx", "divipola.xlsx"));
  const filas = XLSX.utils.sheet_to_json(wb.Sheets.Municipios, { header: 1 }).filter((r) => /^\d{5}$/.test(String(r[2] || "")) && typeof r[5] === "number");
  const munis = new Map(), deps = new Map();
  for (const [cdep, ndep, cmun, nmun, , lon, lat] of filas) {
    const dep = titulo(String(ndep).trim()), nombre = titulo(String(nmun).trim());
    const m = { cod: cmun, nombre, ctxPadre: dep, lat, lon };
    m.ctxCompleto = `${nombre} · ${dep}`;
    munis.set(cmun, m);
    (deps.get(cdep) || deps.set(cdep, { n: dep, m: [] }).get(cdep)).m.push(m);
    cat.add("municipio", nombre, dep, lat, lon, "", cmun, "dane");
  }
  for (const [c, d] of deps) cat.add("region", d.n, "Colombia", media(d.m.map((m) => m.lat)), media(d.m.map((m) => m.lon)), "", c, "dane");
  const nl = localidades(cat, "CO", (c) => munis.get(c[11]), "geonames", true);
  const ncp = codigosPostales(cat, postal.CO, (f) => munis.get(f[6]));
  console.log(`CO: ${deps.size} departamentos, ${munis.size} municipios DIVIPOLA, ${nl} localidades, ${ncp} CP`);
  return cat;
}

/* ================= Argentina: Georef ================= */
async function argentina() {
  const cat = catalogo("AR", { region: "Provincia", provincia: "Departamento", municipio: "Localidad" },
    { georef: "Georef · Servicio de normalización de datos geográficos (Gobierno de Argentina)", geonames: "GeoNames (CC BY 4.0)" });
  const G = "https://apis.datos.gob.ar/georef/api/";
  const provs = (await json(G + "provincias?max=100", "georef_prov.json")).provincias;
  const deps = (await json(G + "departamentos?max=1000", "georef_dep.json")).departamentos;
  const locs = (await json(G + "localidades?max=5000", "georef_loc.json")).localidades;
  for (const p of provs) cat.add("region", p.nombre, "Argentina", p.centroide.lat, p.centroide.lon, "", p.id, "georef");
  const depto = new Map();
  for (const d of deps) {
    const m = { cod: d.id, nombre: d.nombre, ctxPadre: d.provincia.nombre };
    m.ctxCompleto = `${d.nombre} · ${d.provincia.nombre}`;
    depto.set(d.id, m);
    cat.add("provincia", d.nombre, d.provincia.nombre, d.centroide.lat, d.centroide.lon, "", d.id, "georef");
  }
  for (const l of locs) cat.add("municipio", l.nombre, [l.departamento && l.departamento.nombre, l.provincia.nombre].filter(Boolean).join(" · "), l.centroide.lat, l.centroide.lon, "", l.id, "georef");
  // Sin barrios de GeoNames: sus códigos de departamento no son los de Georef
  // (a Palermo le asignaría la Comuna 2 en vez de la 14). Georef ya trae los barrios porteños.
  console.log(`AR: ${provs.length} provincias, ${deps.length} departamentos, ${locs.length} localidades Georef`);
  return cat;
}

/* ================= Perú, Chile y Ecuador: GeoNames con códigos oficiales ================= */
// Los ficheros postales de estos países traen nombres sin tildes («Huanuco»). Se
// restauran con las formas acentuadas de GeoNames del mismo país solo si coinciden
// letra a letra sin tildes: nunca se cambia una letra, solo los acentos.
function restaurador(cc) {
  const sin = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const formas = new Map();
  const anota = (n) => { n = n && n.replace(/ (Department|Province|Region)$/, ""); if (n && n !== sin(n)) formas.set(sin(n).toLowerCase(), n); };
  for (const c of ciudades.filter((c) => c[8] === cc)) anota(c[1]);
  for (const f of ["admin1CodesASCII.txt", "admin2Codes.txt"]) {
    const fich = bajar(`https://download.geonames.org/export/dump/${f}`, f);
    for (const r of tsv(fich)) if (r[0].startsWith(cc + ".")) anota(r[1]);
  }
  return (n) => {
    if (!n) return n;
    const f = formas.get(n.toLowerCase());
    if (f) return n === n.toUpperCase() ? n : f;
    // Por palabras («San Juan de Lurigancho»), solo las que tengan forma acentuada conocida.
    return n.split(" ").map((w) => { const x = formas.get(w.toLowerCase()); return x && !x.includes(" ") && w[0] === w[0].toUpperCase() ? x : w; }).join(" ");
  };
}

function porCodigo(cc, niveles, fuenteTxt, conf) {
  const cat = catalogo(cc, niveles, { geonames: fuenteTxt });
  const tilde = restaurador(cc);
  // Nombres de GeoNames: sin sufijos en inglés («Huánuco Department»), con las
  // preposiciones en minúscula («San Pedro de Cachora») y las tildes conocidas.
  const limpio = (s) => { if (!s) return s; s = s.replace(/ (Department|Province|Region)$/, ""); return tilde(conf.titulo ? titulo(s) : s); };
  postal[cc] = postal[cc].map((f) => { let g = [...f]; for (const k of [2, 3, 5, 7]) g[k] = limpio(g[k]); if (conf.fila) g = conf.fila(g); return g; });
  const munis = new Map(), provs = new Map(), regs = new Map();
  for (const f of postal[cc]) {
    const cod = conf.cod(f);
    if (!cod) continue;
    const m = munis.get(cod) || { cod, nombre: conf.nombre(f), reg: f[3], prov: conf.prov(f), lat: [], lon: [] };
    m.lat.push(+f[9]); m.lon.push(+f[10]);
    munis.set(cod, m);
  }
  for (const m of munis.values()) {
    m.lat = media(m.lat); m.lon = media(m.lon);
    m.ctxPadre = [m.prov, m.reg].filter(Boolean).join(" · ");
    m.ctxCompleto = `${m.nombre} · ${m.ctxPadre}`;
    cat.add("municipio", m.nombre, m.ctxPadre, m.lat, m.lon, "", m.cod, "geonames");
    if (m.prov) (provs.get(m.prov + "|" + m.reg) || provs.set(m.prov + "|" + m.reg, []).get(m.prov + "|" + m.reg)).push(m);
    (regs.get(m.reg) || regs.set(m.reg, []).get(m.reg)).push(m);
  }
  for (const [k, ms] of provs) cat.add("provincia", k.split("|")[0], k.split("|")[1], media(ms.map((m) => m.lat)), media(ms.map((m) => m.lon)), "", "", "geonames");
  for (const [r, ms] of regs) cat.add("region", r, conf.pais, media(ms.map((m) => m.lat)), media(ms.map((m) => m.lon)), "", "", "geonames");
  if (conf.lugares) for (const f of postal[cc]) { const m = munis.get(conf.cod(f)); if (m && f[2] !== m.nombre) cat.add("localidad", f[2], `CP ${f[1]} · ${m.ctxCompleto}`, +f[9], +f[10], f[1], m.cod, "geonames"); }
  const nl = localidades(cat, cc, (c) => munis.get(conf.codCiudad(c)), "geonames", !!conf.barrios);
  const ncp = codigosPostales(cat, postal[cc], (f) => munis.get(conf.cod(f)), "geonames", conf.notaCP || "");
  console.log(`${cc}: ${regs.size} regiones, ${munis.size} ${niveles.municipio.toLowerCase()}s, ${nl} localidades, ${ncp} CP`);
  return cat;
}

// Departamentos con el nombre que usa el INEI.
const DEP_PE = { Ancash: "Áncash", Cuzco: "Cusco" };
const peru = () => porCodigo("PE", { region: "Departamento", provincia: "Provincia", municipio: "Distrito" }, "GeoNames (CC BY 4.0) con el ubigeo oficial del INEI",
  { pais: "Perú", titulo: true, cod: (f) => f[8], nombre: (f) => f[7], prov: (f) => f[5], codCiudad: (c) => c[12], lugares: true, barrios: true,
    fila: (f) => { f[3] = DEP_PE[f[3]] || f[3]; return f; } });

// Chile: regiones con su denominación oficial por código comunal, y la Región de
// Ñuble (Ley 21.033, 2018), que GeoNames aún tiene dentro del Biobío con códigos 084xx.
const REG_CL = { "01": "Región de Tarapacá", "02": "Región de Antofagasta", "03": "Región de Atacama", "04": "Región de Coquimbo", "05": "Región de Valparaíso", "06": "Región del Libertador General Bernardo O'Higgins", "07": "Región del Maule", "08": "Región del Biobío", "09": "Región de La Araucanía", "10": "Región de Los Lagos", "11": "Región de Aysén del General Carlos Ibáñez del Campo", "12": "Región de Magallanes y de la Antártica Chilena", "13": "Región Metropolitana de Santiago", "14": "Región de Los Ríos", "15": "Región de Arica y Parinacota", "16": "Región de Ñuble" };
const NUBLE = { "08401": "16101", "08402": "16102", "08403": "16202", "08404": "16203", "08405": "16302", "08406": "16103", "08407": "16104", "08408": "16204", "08409": "16303", "08410": "16105", "08411": "16106", "08412": "16205", "08413": "16107", "08414": "16201", "08415": "16206", "08416": "16301", "08417": "16304", "08418": "16108", "08419": "16305", "08420": "16207", "08421": "16109" };
const PROV_NUBLE = { "161": "Diguillín", "162": "Itata", "163": "Punilla" };
const chile = () => porCodigo("CL", { region: "Región", provincia: "Provincia", municipio: "Comuna" }, "GeoNames (CC BY 4.0) con el código comunal oficial (actualizado con la Región de Ñuble)",
  { pais: "Chile", cod: (f) => f[8], nombre: (f) => f[7], prov: (f) => f[5].replace(/^Provincia de /, ""), codCiudad: (c) => NUBLE[c[12]] || c[12], barrios: true, notaCP: " · código postal general de la comuna",
    fila: (f) => {
      if (NUBLE[f[8]]) { f[8] = NUBLE[f[8]]; f[5] = PROV_NUBLE[f[8].slice(0, 3)]; if (f[8] === "16303") f[2] = f[7] = "Ñiquén"; }
      if (REG_CL[f[8].slice(0, 2)]) f[3] = REG_CL[f[8].slice(0, 2)];
      return f;
    } });
const ecuador = () => porCodigo("EC", { region: "Provincia", municipio: "Cantón" }, "GeoNames (CC BY 4.0) con los códigos postales de Correos del Ecuador",
  { pais: "Ecuador", cod: (f) => f[6], nombre: (f) => f[5].replace(/^Cantón /, ""), prov: () => "", codCiudad: () => null, lugares: true });

/* ================= Estados Unidos: Oficina del Censo ================= */
async function eeuu() {
  const cat = catalogo("US", { region: "Estado", provincia: "Condado", municipio: "Ciudad / localidad" },
    { census: "US Census Bureau · Gazetteer 2024 (oficial, dominio público)", geonames: "GeoNames (CC BY 4.0) para asociar cada ZIP a su ciudad" });
  const G = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/";
  const leer = (n) => tsv(unzip(bajar(G + n + ".zip", n + ".zip"), n + ".txt", "census")).slice(1).map((r) => r.map((x) => x.trim()));
  const estados = new Map(); // FIPS → nombre (GeoNames admin1 US usa la abreviatura postal)
  const abrev = new Map();
  for (const r of tsv(bajar("https://download.geonames.org/export/dump/admin1CodesASCII.txt", "admin1CodesASCII.txt"))) if (r[0].startsWith("US.")) abrev.set(r[0].slice(3), r[1]);
  // Nombre sin la categoría legal del Censo: «Boston city» → «Boston», «Abanda CDP» → «Abanda».
  const limpio = (n) => { let s = n; for (;;) { const t = s.replace(/\s+(CDP|\(balance\)|[a-z][a-z-]*)$/u, ""); if (t === s || !t) return s; s = t; } };
  const radio = (m2) => Math.sqrt(+m2 / Math.PI) / 1000; // km, círculo de igual superficie
  const add = (tipo, nombre, ctx, lat, lon, cp, cod, pob, km) => { cat.add(tipo, nombre, ctx, +lat, +lon, cp, cod, "census", pob); cat.items[cat.items.length - 1][10] = ""; cat.items[cat.items.length - 1][11] = Math.round(km * 10) / 10; };
  const porEstado = new Map();
  for (const [usps, geoid, , nombre, aland, , , , lat, lon] of leer("2024_Gaz_counties_national")) {
    const st = abrev.get(usps) || usps;
    estados.set(geoid.slice(0, 2), st);
    (porEstado.get(st) || porEstado.set(st, []).get(st)).push([+lat, +lon]);
    add("provincia", nombre, st, lat, lon, "", geoid, 0, radio(aland));
  }
  for (const [st, pts] of porEstado) cat.add("region", st, "Estados Unidos", media(pts.map((p) => p[0])), media(pts.map((p) => p[1])), "", "", "census");
  // El Gazetteer no trae población: se toma de GeoNames (mismo nombre y estado) para
  // ordenar («Brooklyn» debe dar primero el de Nueva York). También sus barrios (PPLX).
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const us = tsv(unzip(bajar("https://download.geonames.org/export/dump/cities500.zip", "cities500.zip"), "cities500.txt", "c500")).filter((c) => c[8] === "US" && c[6] === "P");
  const pob = new Map();
  for (const c of us) { const k = norm(c[1]) + "|" + c[10]; pob.set(k, Math.max(pob.get(k) || 0, +c[14])); }
  const condados = new Map(tsv(bajar("https://download.geonames.org/export/dump/admin2Codes.txt", "admin2Codes.txt")).filter((r) => r[0].startsWith("US.")).map((r) => [r[0], r[1]]));
  let np = 0, nb = 0;
  const delCenso = new Set();
  for (const [usps, geoid, , nombre, , , aland, , , , lat, lon] of leer("2024_Gaz_place_national")) {
    const n = limpio(nombre);
    delCenso.add(norm(n) + "|" + usps);
    add("municipio", n, abrev.get(usps) || usps, lat, lon, "", geoid, pob.get(norm(n) + "|" + usps) || 0, radio(aland)); np++;
  }
  // Barrios (PPLX) y núcleos que el Censo no recoge como «place»: los distritos de
  // Nueva York (Brooklyn, Queens… son capitales de condado en GeoNames).
  for (const c of us.filter((c) => c[7] === "PPLX" || (!delCenso.has(norm(c[1]) + "|" + c[10]) && +c[14] >= 1000))) {
    const st = abrev.get(c[10]);
    if (!st) continue;
    const cond = condados.get(`US.${c[10]}.${c[11]}`);
    cat.add(c[7] === "PPLX" ? "barrio" : "localidad", c[1], [cond, st].filter(Boolean).join(" · "), +c[4], +c[5], "", c[0], "geonames", +c[14]);
    cat.items[cat.items.length - 1][10] = alias(c);
    nb++;
  }
  console.log(`US: ${nb} barrios y distritos (GeoNames)`);
  // ZIP: centroide y superficie oficiales (ZCTA); ciudad y estado desde GeoNames.
  const zipInfo = new Map();
  for (const f of tsv(unzip(bajar("https://download.geonames.org/export/zip/US.zip", "zip_US.zip"), "US.txt", "zip_US"))) zipInfo.set(f[1], f);
  let nz = 0;
  for (const [zip, aland, , , , lat, lon] of leer("2024_Gaz_zcta_national")) {
    const g = zipInfo.get(zip);
    if (!g) continue;
    add("cp", zip, `${g[2]} · ${g[3]}`, lat, lon, zip, "", 0, radio(aland)); nz++;
  }
  console.log(`US: ${porEstado.size} estados, ${estados.size} FIPS, ${np} ciudades, ${nz} ZIP (Censo)`);
  return cat;
}

/* ================= Resto del mundo: GeoNames ================= */
// Nombres alternativos en alfabeto latino (para buscar «Nueva York», «Londres»…), sin mostrar.
const soloLatino = /^[\p{Script=Latin}\p{N}\s.'’()-]+$/u;
let nombresEs = null;
function enEspanol(id) {
  if (!nombresEs) {
    nombresEs = new Map();
    const f = join(TMP, "alt_es.tsv");
    if (!existsSync(f)) execFileSync("sh", ["-c", `unzip -p "${bajar("https://download.geonames.org/export/dump/alternateNamesV2.zip", "alternateNamesV2.zip")}" alternateNamesV2.txt | awk -F'	' '$3=="es" && $8!="1" && $7!="1" {print $2"	"$4"	"$5}' > "${f}"`]);
    for (const [gid, n] of tsv(f)) (nombresEs.get(gid) || nombresEs.set(gid, []).get(gid)).push(n);
  }
  return nombresEs.get(String(id)) || [];
}

function alias(c) {
  const vistos = new Set([c[1].toLowerCase()]);
  const out = [];
  for (const a of [...enEspanol(c[0]), ...(c[3] || "").split(",")]) {
    const k = a.toLowerCase();
    if (a.length < 3 || a.length > 40 || vistos.has(k) || !soloLatino.test(a) || /\d/.test(a)) continue;
    vistos.add(k); out.push(a);
    if (out.join(" ").length > 160) break;
  }
  return out.join(" ");
}

let ciudades500 = null, postalMundo = null, adm1 = null, adm2 = null, adm1Id = null;
const LATAM = ["VE", "BO", "PY", "UY", "CR", "PA", "GT", "HN", "SV", "NI", "DO", "CU", "PR", "BR"];
function generico(cc, nombrePais) {
  if (!ciudades500) {
    ciudades500 = new Map();
    for (const c of tsv(unzip(bajar("https://download.geonames.org/export/dump/cities500.zip", "cities500.zip"), "cities500.txt", "c500"))) {
      if (c[6] !== "P") continue;
      (ciudades500.get(c[8]) || ciudades500.set(c[8], []).get(c[8])).push(c);
    }
    postalMundo = new Map();
    for (const f of tsv(unzip(bajar("https://download.geonames.org/export/zip/allCountries.zip", "postal_all.zip"), "allCountries.txt", "postal_all")))
      (postalMundo.get(f[0]) || postalMundo.set(f[0], []).get(f[0])).push(f);
    adm1 = new Map(tsv(bajar("https://download.geonames.org/export/dump/admin1CodesASCII.txt", "admin1CodesASCII.txt")).map((r) => [r[0], r[1]]));
    adm1Id = new Map(tsv(join(TMP, "admin1CodesASCII.txt")).map((r) => [r[1] + "|" + r[0].split(".")[0], r[3]]));
    adm2 = new Map(tsv(bajar("https://download.geonames.org/export/dump/admin2Codes.txt", "admin2Codes.txt")).map((r) => [r[0], r[1]]));
  }
  let cs = ciudades500.get(cc) || [];
  const ps = postalMundo.get(cc) || [];
  // Latinoamérica: todas las localidades y barrios del volcado completo del país
  // (el fichero global solo trae núcleos de más de 500 habitantes).
  if (LATAM.includes(cc)) {
    const ids = new Set(cs.map((c) => c[0]));
    const vol = tsv(unzip(bajar(`https://download.geonames.org/export/dump/${cc}.zip`, `dump_${cc}.zip`), `${cc}.txt`, `volcado_${cc}`))
      .filter((c) => c[6] === "P" && /^PPL(A\d?|C|X)?$/.test(c[7]) && c[10] && !ids.has(c[0]));
    cs = cs.concat(vol);
  }
  if (!cs.length && !ps.length) return null;
  const cat = catalogo(cc, { region: "Región / estado", provincia: "Provincia / condado", municipio: "Ciudad / localidad" },
    { geonames: "GeoNames (CC BY 4.0), a partir de los datos de institutos estadísticos y correos nacionales" });
  const r1 = new Map(), r2 = new Map();
  for (const c of cs) {
    const n1 = adm1.get(`${cc}.${c[10]}`), n2 = adm2.get(`${cc}.${c[10]}.${c[11]}`);
    const ctx = [n2, n1].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" · ") || nombrePais;
    cat.add(c[7] === "PPLX" ? "barrio" : "municipio", c[1], ctx, +c[4], +c[5], "", c[0], "geonames", +c[14]);
    cat.items[cat.items.length - 1][10] = alias(c);
    if (n1) { const g = r1.get(n1) || { pts: [], cap: null }; g.pts.push(c); if (c[7] === "PPLA" || c[7] === "PPLC") g.cap = c; r1.set(n1, g); }
    if (n2 && n1) { const k = n2 + "|" + n1; const g = r2.get(k) || { pts: [], cap: null }; g.pts.push(c); if (c[7] === "PPLA2") g.cap = c; r2.set(k, g); }
  }
  const centro = (g) => (g.cap ? [+g.cap[4], +g.cap[5]] : [media(g.pts.map((p) => +p[4])), media(g.pts.map((p) => +p[5]))]);
  for (const [n, g] of r1) { const [la, lo] = centro(g); cat.add("region", n, nombrePais, la, lo, "", "", "geonames"); cat.items[cat.items.length - 1][10] = enEspanol(adm1Id.get(n + "|" + cc)).filter((x) => x !== n).join(" "); }
  for (const [k, g] of r2) { const [n2, n1] = k.split("|"); if (n2 === n1) continue; const [la, lo] = centro(g); cat.add("provincia", n2, n1, la, lo, "", "", "geonames"); }
  // Códigos postales agrupados, con la localidad y la región del propio fichero postal.
  const grupos = new Map();
  for (const f of ps) { const g = grupos.get(f[1]) || { la: [], lo: [], lug: new Set(), reg: f[3] }; if (f[9]) { g.la.push(+f[9]); g.lo.push(+f[10]); } g.lug.add(f[2]); grupos.set(f[1], g); }
  for (const [cp, g] of grupos) {
    if (!g.la.length) continue;
    const lug = [...g.lug];
    cat.add("cp", cp, [lug.slice(0, 3).join(", ") + (lug.length > 3 ? "…" : ""), g.reg].filter(Boolean).join(" · "), media(g.la), media(g.lo), cp, "", "geonames");
  }
  return cat;
}

/* ---------- salida ---------- */
const PRINCIPALES = ["ES", "MX", "CO", "PE", "CL", "AR", "EC", "US"];
const cats = [await espana(), await mexico(), await colombia(), await argentina(), peru(), chile(), ecuador(), await eeuu()];
const nombresES = new Intl.DisplayNames(["es"], { type: "region" });
const paisesInfo = tsv(bajar("https://download.geonames.org/export/dump/countryInfo.txt", "countryInfo.txt")).filter((r) => /^[A-Z]{2}$/.test(r[0]));
for (const r of paisesInfo) {
  if (PRINCIPALES.includes(r[0])) continue;
  let nombre = r[4];
  try { nombre = nombresES.of(r[0]) || nombre; } catch (e) { /* código sin nombre en español */ }
  const c = generico(r[0], nombre);
  if (c) { c.nombre = nombre; cats.push(c); }
}
const indice = [];
for (const c of cats) {
  // Sin duplicados exactos (mismo tipo, nombre y contexto).
  const vistos = new Set();
  const items = c.items.filter((i) => { const k = i[0] + "|" + i[1] + "|" + i[2]; if (vistos.has(k)) return false; vistos.add(k); return true; });
  const datos = JSON.stringify({ pais: c.cc, niveles: c.niveles, fuentes: c.fuentes, generado: new Date().toISOString().slice(0, 10), items });
  const gz = gzipSync(datos, { level: 9 });
  writeFileSync(join(SALIDA, `${c.cc}.json.gz`), gz);
  let nombre = c.nombre;
  try { nombre = nombre || nombresES.of(c.cc); } catch (e) { nombre = c.cc; }
  indice.push({ cc: c.cc, nombre, principal: PRINCIPALES.includes(c.cc), lugares: items.length, kb: Math.round(gz.length / 1024) });
}
// Índice de países: los principales primero (en su orden) y después el resto por nombre.
indice.sort((a, b) => (a.principal !== b.principal ? (a.principal ? -1 : 1) : a.principal ? PRINCIPALES.indexOf(a.cc) - PRINCIPALES.indexOf(b.cc) : a.nombre.localeCompare(b.nombre, "es")));
writeFileSync(join(SALIDA, "paises.json"), JSON.stringify(indice.map(({ cc, nombre, principal }) => ({ cc, nombre, principal }))));
console.table(indice.filter((i) => i.principal));
const resto = indice.filter((i) => !i.principal);
console.log(`Resto del mundo: ${resto.length} países, ${resto.reduce((a, i) => a + i.lugares, 0)} lugares, ${Math.round(resto.reduce((a, i) => a + i.kb, 0) / 1024)} MB · mayores: ${[...resto].sort((a, b) => b.kb - a.kb).slice(0, 6).map((i) => `${i.cc} ${i.kb} KB`).join(", ")}`);
console.log("Venezuela:", JSON.stringify(indice.find((i) => i.cc === "VE")));
