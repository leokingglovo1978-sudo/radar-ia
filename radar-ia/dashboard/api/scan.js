// Endpoint de escaneo: busca en Google, analiza con OpenAI, guarda en Supabase.
// Protegido: solo usuarios logueados en Supabase Auth pueden ejecutarlo.
const { createClient } = require("@supabase/supabase-js");

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const VERTICALES = {
  dental: ["dental","dentista","odontolog","sonrisa"],
  inmobiliaria: ["inmo","real estate","finca","propiedad"],
  estetica: ["estetica","beauty","spa","peluquer","barber"],
  restaurante: ["restaurant","bar ","cafeter","comida","taquer","pizzer"],
  taller: ["taller","mecanic","auto","neumatic","moto"],
};
const CALIENTE = new Set(["dental","inmobiliaria","estetica","restaurante","taller"]);
const TICKET = { dental:70, restaurante:25, estetica:35, inmobiliaria:150, taller:60, otro:30 };

const PROMPT = `Eres un analista de negocios. Lee estas resenyas de Google y devuelve SOLO JSON valido con:
- "no_contesta": numero de resenyas que se quejan de que NO contestan telefono/WhatsApp o tardanza extrema
- "citas_dificiles": numero de resenyas que mencionan dificultad para conseguir cita/reserva/turno
- "quote": la frase textual mas contundente EN ESPANOL de queja sobre no contestar o citas dificiles (o "")
Resenyas:
`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function verticalOf(nombre) {
  const n = (nombre || "").toLowerCase();
  for (const [v, kws] of Object.entries(VERTICALES)) if (kws.some(k => n.includes(k))) return v;
  return "otro";
}
function scoreBiz(b) {
  let p = 0; const m = [];
  if (b.no_contesta_count >= 3) { p += 30; m.push("'no contestan' en " + b.no_contesta_count + " resenyas"); }
  else if (b.no_contesta_count >= 1) { p += 25; m.push("1 resenya de 'no contestan' (20% de la muestra)"); }
  if (b.resenas_mes >= 15) { p += 20; m.push(b.resenas_mes + " resenyas/mes"); }
  if (CALIENTE.has(b.vertical)) { p += 15; m.push("vertical caliente: " + b.vertical); }
  if (b.citas_dificiles_count >= 1) { p += 10; m.push("citas dificiles en resenyas"); }
  if (!b.tiene_reserva_online) { p += 15; m.push("sin reserva online"); }
  if (b.abre_extendido) { p += 10; m.push("horario extendido"); }
  p = Math.min(p, 100);
  return { score: p, tier: p >= 70 ? "CALIENTE" : p >= 45 ? "TIBIO" : "BAJO", motivos: m.join("; ") };
}
function estimate(b) {
  const ticket = TICKET[b.vertical] || 30;
  const perdidos = Math.max(1, Math.round(b.resenas_mes * 0.10));
  const perdida = Math.round(perdidos * ticket / 10) * 10;
  const setup = perdida < 200 ? 150 : perdida < 500 ? 250 : 490;
  const mensual = perdida < 300 ? 49 : 79;
  return { perdida_mes: perdida, propuesta: setup + " EUR de puesta en marcha + " + mensual + " EUR/mes" };
}

async function gpost(url, body, fields) {
  const r = await fetch(url, { method: "POST",
    headers: { "X-Goog-Api-Key": GOOGLE_KEY, "Content-Type": "application/json", "X-Goog-FieldMask": fields },
    body: JSON.stringify(body) });
  return r.json();
}
async function gget(url, fields) {
  const r = await fetch(url, { headers: { "X-Goog-Api-Key": GOOGLE_KEY, "X-Goog-FieldMask": fields } });
  return r.json();
}
async function analizar(textos) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST",
    headers: { Authorization: "Bearer " + OPENAI_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "user", content: PROMPT + textos.join("\n---\n") }] }) });
  const j = await r.json();
  try { return JSON.parse(j.choices[0].message.content); } catch (e) { return { no_contesta: 0, citas_dificiles: 0, quote: "" }; }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Solo POST" });

  // 1) LOGIN: verificar JWT de Supabase
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const sbUser = createClient(SB_URL, SB_ANON);
  const { data: { user }, error: authErr } = await sbUser.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Debes iniciar sesion para escanear." });

  const { query, ciudad = "", max = 20 } = req.body || {};
  if (!query) return res.status(400).json({ error: "Indica que buscar, ej: 'peluquerias en Almeria'" });
  const maxN = Math.min(Math.max(5, Number(max) || 20), 25); // tope: 25 por escaneo

  // 2) Busqueda en Google Places
  const F_SEARCH = "places.id,places.displayName,nextPageToken";
  let ids = [], pageToken = null;
  while (ids.length < maxN) {
    const body = { textQuery: query, pageSize: 20, languageCode: "es" };
    if (pageToken) body.pageToken = pageToken;
    const j = await gpost("https://places.googleapis.com/v1/places:searchText", body, F_SEARCH);
    if (j.error) return res.status(502).json({ error: "Google: " + (j.error.message || "error") });
    for (const p of j.places || []) if (p.id && !ids.includes(p.id)) ids.push(p.id);
    pageToken = j.nextPageToken;
    if (!pageToken) break;
    await sleep(2000);
  }
  ids = ids.slice(0, maxN);

  // 3) Detalles + resenyas + coordenadas + analisis IA (con concurrencia 5)
  const F_DET = "reviews,rating,userRatingCount,regularOpeningHours,websiteUri,nationalPhoneNumber,displayName,formattedAddress,googleMapsUri,location";
  const sbAdmin = createClient(SB_URL, SB_SERVICE);
  const negocios = [];
  let idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const id = ids[idx++];
      try {
        const p = await gget("https://places.googleapis.com/v1/places/" + id, F_DET);
        const reviews = (p.reviews || []).map(rv => (rv.text && rv.text.text) || "");
        let a = { no_contesta: 0, citas_dificiles: 0, quote: "" };
        if (reviews.length) a = await analizar(reviews.slice(0, 40));
        const weekday = ((p.regularOpeningHours || {}).weekdayDescriptions) || [];
        const extendido = weekday.some(s => /sábado|sabado|domingo|PM/i.test(s)) ? 1 : 0;
        const web = p.websiteUri || "";
        const tieneReserva = /book|reserv|cita/i.test(web) ? 1 : 0;
        const b = {
          id, nombre: (p.displayName && p.displayName.text) || "", categoria: "",
          direccion: p.formattedAddress || "", telefono: p.nationalPhoneNumber || "", web,
          rating: p.rating || 0, total_resenas: p.userRatingCount || 0,
          resenas_mes: Math.round((p.userRatingCount || 0) / 36),
          tiene_reserva_online: tieneReserva, abre_extendido: extendido, sucursales: 1,
          no_contesta_count: a.no_contesta || 0, citas_dificiles_count: a.citas_dificiles || 0,
          quote: (a.quote || "").slice(0, 300), maps_url: p.googleMapsUri || "",
          lat: p.location ? p.location.latitude : null, lng: p.location ? p.location.longitude : null,
          ciudad,
        };
        b.vertical = verticalOf(b.nombre);
        Object.assign(b, scoreBiz(b));
        Object.assign(b, estimate(b));
        negocios.push(b);
      } catch (e) { /* negocio fallido: se omite */ }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));

  // 4) Guardar en Supabase
  for (let i = 0; i < negocios.length; i += 50) {
    await sbAdmin.from("businesses").upsert(negocios.slice(i, i + 50), { onConflict: "id" });
  }
  const hot = negocios.filter(n => n.tier === "CALIENTE").length;
  return res.json({ ok: true, escaneados: negocios.length, calientes: hot,
    total_bd: (await sbAdmin.from("businesses").select("id", { count: "exact", head: true })).count });
};