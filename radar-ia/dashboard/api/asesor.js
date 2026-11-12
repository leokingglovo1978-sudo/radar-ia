// api/asesor.js — Asesor IA v4: chat + briefing, robusto ante columnas que faltan y con errores visibles.
const { createClient } = require("@supabase/supabase-js");
const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;

const SYSTEM_BASE = [
  "Eres el asesor comercial personal de Leonard Narvaez, desarrollador de Almeria que vende agentes de WhatsApp con IA a pymes locales (precio habitual: 150 EUR de puesta en marcha + 49 EUR/mes).",
  "Tienes acceso a sus datos reales: leads de su radar y senales de intencion de las ultimas 48h.",
  "ESTILO: espanol SIN tildes, tono directo y cercano, texto plano con guiones para secciones, maximo 250 palabras, no inventes datos."
].join(" ");

const SYSTEM_CHAT = SYSTEM_BASE + " " + [
  "MODO CHAT: responde la pregunta de Leonard.",
  "PROHIBIDO responder que 'no hay leads' o 'no hay nada pendiente': el bloque DATOS PRECALCULADOS es la verdad del servidor; si dice que hay pendientes, hay pendientes. Usa la lista.",
  "Si pregunta por 'leads viejos', 'pendientes', 'a quien contacto': presenta los de la lista precalculada (los 5-6 primeros con telefono), cada uno con su argumento, y menciona el total pendiente.",
  "Si pide leads 'con WhatsApp': explica en UNA linea que no podemos verificar WhatsApp, pero los moviles (6xx/7xx) casi siempre lo tienen y los fijos (950...) no reciben WhatsApp. Usa la lista de moviles; si no hay moviles entre los pendientes, dilo y ofrece los mejores con fijo recomendando LLAMADA o visita (que tambien funciona).",
  "Si pide redactar un mensaje, entregalo listo para copiar.",
  "Cierra siempre con UNA siguiente accion concreta."
].join(" ");

const SYSTEM_BRIEFING = SYSTEM_BASE + " " + [
  "MODO BRIEFING: genera el briefing diario.",
  '- Empieza con "Buenos dias, Leonard" + la fecha + UN dato llamativo.',
  "- SECCION 1 - SENALES: solo las que valgan la pena (empleo/licitaciones primero). Maximo 3.",
  "- SECCION 2 - TOP 3 CONTACTOS DE HOY: pendientes con telefono mas calientes; por cada uno nombre, telefono y UN argumento.",
  "- SECCION 3 - ACCIONES RAPIDAS: 2 tareas extra."
].join(" ");

function esMovil(tel){
  const d = (tel || "").replace(/\D/g, "").replace(/^34/, "");
  return /^[67]/.test(d);
}
function ficha(l){
  return "- " + l.nombre + " (" + l.score + " pts, " + (l.tier || "") + ", tel " + l.telefono +
    (l.perdida_mes ? ", pierde ~" + l.perdida_mes + " EUR/mes" : "") +
    (l.quote ? ", reseña: \"" + String(l.quote).slice(0, 90) + "\"" : "") + ")";
}
function listaPendientes(leads){
  const hace7dias = Date.now() - 7 * 24 * 3600 * 1000;
  const pend = (leads || []).filter(l => !l.contactado_en || new Date(l.contactado_en).getTime() < hace7dias);
  const conTel = pend.filter(l => l.telefono);
  const top = conTel.slice(0, 6).map(ficha);
  const moviles = conTel.filter(l => esMovil(l.telefono)).slice(0, 8).map(ficha);
  return { total: pend.length, top, moviles };
}

const COLS_CON_CONTACTO = "nombre,score,tier,telefono,email,categoria,motivos,quote,perdida_mes,propuesta,ciudad,contactado_en";
const COLS_BASICAS = "nombre,score,tier,telefono,email,categoria,motivos,quote,perdida_mes,propuesta,ciudad";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Solo POST" });

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const sbUser = createClient(SB_URL, SB_ANON);
  const { data: { user }, error: authErr } = await sbUser.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Debes iniciar sesion." });

  let body = {};
  try { body = req.body || {}; } catch (e) { body = {}; }
  const modo = body.modo || (body.pregunta ? "chat" : "briefing");
  const pregunta = (body.pregunta || "").toString().slice(0, 500);

  const sb = createClient(SB_URL, SB_SERVICE);

  // Leads: intenta con contactado_en; si la columna no existe, reintenta sin ella
  let leads = null, errLeads = null;
  ({ data: leads, error: errLeads } = await sb.from("businesses").select(COLS_CON_CONTACTO).order("score", { ascending: false }).limit(30));
  if (errLeads) {
    const r2 = await sb.from("businesses").select(COLS_BASICAS).order("score", { ascending: false }).limit(30);
    if (r2.error) return res.status(500).json({ error: "Error leyendo leads en Supabase: " + r2.error.message + " (ejecuta: alter table businesses add column if not exists contactado_en timestamptz;)" });
    leads = r2.data;
  }

  const hace48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: senales } = await sb.from("intent_signals")
    .select("titulo,keyword,zona,fecha").gte("fecha", hace48h)
    .order("fecha", { ascending: false }).limit(15);

  if (!leads || !leads.length) return res.status(500).json({ error: "El asesor no recibió leads de Supabase (tabla businesses vacía o sin permisos). Revisa la base de datos." });

  // conteo real de pendientes en toda la tabla
  const hace7diasISO = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { count: pendientesReales } = await sb.from("businesses")
    .select("id", { count: "exact", head: true })
    .or("contactado_en.is.null,contactado_en.lt." + hace7diasISO);

  const hoy = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const pend = listaPendientes(leads);
  pend.total = pendientesReales !== null ? pendientesReales : pend.total;

  const autoridad = [
    "=== DATOS PRECALCULADOS POR EL SERVIDOR (son la verdad; NO los contradigas jamas) ===",
    "total_leads: " + leads.length,
    "leads_pendientes_de_contacto: " + pend.total + " (sin contactar, o contactados hace mas de 7 dias)",
    "TOP PENDIENTES CON TELEFONO:",
    pend.top.join("\n") || "- (ninguno con telefono)",
    "TOP PENDIENTES CON MOVIL (empiezan por 6 o 7: casi seguro que tienen WhatsApp):",
    pend.moviles.join("\n") || "- (ninguno con movil entre los pendientes: todos son fijos 950...)",
    "=== FIN DATOS PRECALCULADOS ==="
  ].join("\n");

  const contexto = JSON.stringify({
    fecha_hoy: hoy, total_leads: leads.length,
    leads_pendientes_contacto: pend.total,
    leads, senales_ultimas_48h: senales || []
  });

  const system = modo === "chat" ? SYSTEM_CHAT : SYSTEM_BRIEFING;
  const mensajeUsuario = modo === "chat"
    ? ("PREGUNTA DE LEONARD: " + pregunta + "\n\n" + autoridad + "\n\nDATOS COMPLETOS:\n" + contexto)
    : (autoridad + "\n\nGenera el briefing de hoy. DATOS COMPLETOS:\n" + contexto);

  let respuesta = "", motor = "";
  if (process.env.MOONSHOT_API_KEY) {
    try {
      const r = await fetch("https://api.moonshot.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.MOONSHOT_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.MOONSHOT_MODEL || "kimi-k2-0905-preview",
          temperature: 0.5,
          messages: [{ role: "system", content: system }, { role: "user", content: mensajeUsuario }] }) });
      const j = await r.json();
      if (j.choices && j.choices[0] && j.choices[0].message) { respuesta = j.choices[0].message.content; motor = "kimi"; }
    } catch (e) { /* respaldo */ }
  }
  if (!respuesta && process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.5,
          messages: [{ role: "system", content: system }, { role: "user", content: mensajeUsuario }] }) });
      const j = await r.json();
      if (j.choices && j.choices[0] && j.choices[0].message) { respuesta = j.choices[0].message.content; motor = "openai (respaldo)"; }
    } catch (e) { /* nada */ }
  }

  if (!respuesta) return res.status(500).json({ error: "Ninguna IA respondio. Revisa MOONSHOT_API_KEY y OPENAI_API_KEY en Vercel." });
  respuesta = respuesta.replace(/\*\*/g, "").replace(/^#+\s*/gm, "");
  return res.json({ ok: true, respuesta, briefing: respuesta, motor, modo });
};