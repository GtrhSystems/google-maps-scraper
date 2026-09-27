// Genera web/static/app/brands.js con los logotipos oficiales de las marcas que muestra la interfaz.
// Fuentes: Simple Icons (CC0) y Font Awesome Brands (CC BY 4.0) para los vectoriales; para las marcas
// que no están en ninguna colección, el icono que publica la propia marca en su web (web/static/app/brands/).
// Uso: node scripts/brands/generar.mjs <carpeta de simple-icons> <carpeta de @fortawesome/free-brands-svg-icons>
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [siDir, faDir] = process.argv.slice(2);
if (!siDir || !faDir) throw new Error("Uso: node generar.mjs <simple-icons> <free-brands-svg-icons>");
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// clave → [título, fuente, id en la fuente]
const MARCAS = {
  facebook: ["Facebook", "si", "facebook"], instagram: ["Instagram", "si", "instagram"], tiktok: ["TikTok", "si", "tiktok"],
  youtube: ["YouTube", "si", "youtube"], linkedin: ["LinkedIn", "fa", "faLinkedin"], x: ["X", "si", "x"],
  whatsapp: ["WhatsApp", "si", "whatsapp"], messenger: ["Messenger", "si", "messenger"], meta: ["Meta", "si", "meta"],
  googleads: ["Google Ads", "si", "googleads"], googleanalytics: ["Google Analytics", "si", "googleanalytics"],
  googletagmanager: ["Google Tag Manager", "si", "googletagmanager"], googlemaps: ["Google Maps", "si", "googlemaps"],
  shopify: ["Shopify", "si", "shopify"], wix: ["Wix", "si", "wix"], squarespace: ["Squarespace", "si", "squarespace"],
  webflow: ["Webflow", "si", "webflow"], prestashop: ["PrestaShop", "si", "prestashop"], wordpress: ["WordPress", "si", "wordpress"],
  dialogflow: ["Dialogflow", "si", "dialogflow"], intercom: ["Intercom", "si", "intercom"], livechat: ["LiveChat", "si", "livechat"],
  zendesk: ["Zendesk", "si", "zendesk"], hubspot: ["HubSpot", "si", "hubspot"], chatwoot: ["Chatwoot", "si", "chatwoot"],
  zoho: ["Zoho", "si", "zoho"], biolink: ["Bio.link", "si", "biolink"], calendly: ["Calendly", "si", "calendly"],
  glovo: ["Glovo", "si", "glovo"], justeat: ["Just Eat", "si", "justeat"], linktree: ["Linktree", "si", "linktree"],
  tripadvisor: ["Tripadvisor", "si", "tripadvisor"], ubereats: ["Uber Eats", "si", "ubereats"], ifood: ["iFood", "si", "ifood"],
};

// Nombres tal y como llegan del servidor (plataformas, chats, redes, reservas) → clave.
const ALIAS = {
  "messenger (chat de facebook)": "messenger", "zendesk chat": "zendesk", "hubspot chat": "hubspot", "zoho salesiq": "zoho",
  "watson assistant": "watson", "microsoft copilot studio": "copilotstudio", "elfsight ai chatbot": "elfsight",
  "gohighlevel (conversation ai)": "gohighlevel", "yellow.ai": "yellowai", "tawk.to": "tawkto", "respond.io": "respondio",
  "joinchat (whatsapp)": "joinchat", "click to chat (whatsapp)": "clicktochat", "getbutton (whatsapp)": "getbutton",
  "whatsapp flotante": "whatsapp", "x (twitter)": "x", "twitter": "x", "google ads": "googleads", "google analytics": "googleanalytics",
  "analytics": "googleanalytics", "google tag manager": "googletagmanager", "google maps": "googlemaps", "bio.link": "biolink",
  "just eat": "justeat", "uber eats": "ubereats", "didi food": "didifood", "el tenedor": "eltenedor", "mesa 24/7": "mesa247",
  "píxel de meta": "meta",
};

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const oscuro = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.12; // negro o casi: se pinta con el color del texto (legible en modo oscuro)
};

const siData = JSON.parse(readFileSync(join(siDir, "data", "simple-icons.json"), "utf8"));
const siHex = (slug, titulo) => {
  const d = siData.find((x) => x.slug === slug) || siData.find((x) => x.title === titulo);
  if (!d) throw new Error("Simple Icons sin color para " + slug);
  return d.hex;
};

const lineas = [];
for (const [k, [t, fuente, id]] of Object.entries(MARCAS)) {
  if (fuente === "si") {
    const svg = readFileSync(join(siDir, "icons", id + ".svg"), "utf8");
    const d = svg.match(/<path d="([^"]+)"/)[1];
    const hex = siHex(id, t);
    lineas.push(`  ${JSON.stringify(k)}: { t: "${esc(t)}", vb: "0 0 24 24", c: ${oscuro(hex) ? '"currentColor"' : `"#${hex}"`}, d: "${d}" },`);
  } else {
    const fa = readFileSync(join(faDir, id + ".js"), "utf8");
    const w = fa.match(/var width = (\d+)/)[1], h = fa.match(/var height = (\d+)/)[1];
    const d = fa.match(/var svgPathData = '([^']+)'/)[1];
    lineas.push(`  ${JSON.stringify(k)}: { t: "${esc(t)}", vb: "0 0 ${w} ${h}", c: "#0A66C2", d: "${d}" },`);
  }
}
for (const f of readdirSync(join(raiz, "web", "static", "app", "brands")).sort()) {
  lineas.push(`  ${JSON.stringify(f.replace(/\.\w+$/, ""))}: { img: "/static/app/brands/${f}" },`);
}

writeFileSync(join(raiz, "web", "static", "app", "brands.js"), `// Generado por scripts/brands/generar.mjs: no editar a mano.
// Logotipos oficiales: Simple Icons (CC0), Font Awesome Brands (CC BY 4.0) y los iconos publicados por cada marca en su web.
"use strict";
const MARCAS = {
${lineas.join("\n")}
};
const MARCA_ALIAS = ${JSON.stringify(ALIAS)};

// Clave de una marca a partir de su nombre ("Tawk.to", "Zendesk Chat"…); null si no tenemos su logo.
function claveMarca(nombre) {
  const n = String(nombre || "").trim().toLowerCase();
  const k = MARCA_ALIAS[n] || n.replace(/[^a-z0-9]/g, "");
  return MARCAS[k] ? k : null;
}

// HTML del logotipo oficial; si no lo hay, el icono genérico indicado (Lucide) o nada.
function marca(nombre, generico = "") {
  const k = claveMarca(nombre);
  if (!k) return generico ? \`<i data-lucide="\${generico}"></i>\` : "";
  const m = MARCAS[k];
  if (m.img) return \`<img class="logo-marca" src="\${m.img}" alt="" title="\${esc(nombreMarca(nombre))}" loading="lazy">\`;
  const fill = k === "instagram" ? "url(#brand-ig)" : m.c;
  const defs = k === "instagram" ? '<defs><radialGradient id="brand-ig" cx="30%" cy="107%" r="150%"><stop offset="0" stop-color="#fdf497"/><stop offset=".05" stop-color="#fdf497"/><stop offset=".45" stop-color="#fd5949"/><stop offset=".6" stop-color="#d6249f"/><stop offset=".9" stop-color="#285AEB"/></radialGradient></defs>' : "";
  return \`<svg class="logo-marca" viewBox="\${m.vb}" role="img" aria-label="\${m.t}"><title>\${m.t}</title>\${defs}<path fill="\${fill}" d="\${m.d}"/></svg>\`;
}

function nombreMarca(nombre) { const k = claveMarca(nombre); return k && MARCAS[k].t ? MARCAS[k].t : String(nombre || ""); }
`);
console.log(`brands.js: ${lineas.length} marcas`);
