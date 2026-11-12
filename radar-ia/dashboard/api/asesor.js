// api/asesor.js — Asesor IA: modo "chat" (responde preguntas) y modo "briefing" (resumen del dia).
// Cerebro: Kimi/Moonshot con respaldo OpenAI. Devuelve { ok, respuesta, motor }.
const { createClient } = require("@supabase/supabase-js");
const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;

const SYSTEM_BASE = [
  "Eres el asesor comercial personal de Leonard Narvaez, desarrollador de Almeria que vende agentes de WhatsApp con IA a pymes locales (precio habitual: 150 EUR de puesta en marcha + 49 EUR/mes).",
  "Tienes acceso a sus datos reales: leads de su radar (puntuados por 'score' de dolor de IA) y senales de intencion (ofertas de empleo, licitaciones) de las ultimas 48h.",
  "REGLAS DE ESTILO PARA TODAS LAS RESPUESTAS: espanol SIN tildes ni caracteres especiales, tono directo y cercano (copiloto, no informe corporativo), texto plano con guiones para secciones, nunca superes 250 palabras, no inventes datos que no esten en el JSON."
].join(" ");

const SYSTEM_BRIEFING = SYSTEM_BASE + " " + [
  "MODO BRIEFING: genera el briefing diario.",
  '- Empieza con "Buenos dias, Leonard" + la fecha + UN dato llamativo.',
  "- SECCION 1 - SENALES: solo las que valgan la pena (empleo/licitaciones primero; ignora noticias genericas). Maximo 3.",
  "- SECCION 2 - TOP 3 CONTACTOS DE HOY: leads con telefono mas calientes; por cada uno nombre, telefono y UN argumento de sus motivos/quote/perdida_mes.",
  "- SECCION 3 - ACCIONES RAPIDAS: 2 tareas extra (lead caliente sin telefono para visitar, tibio para WhatsApp...)."
].join(" ");

const SYSTEM_CHAT = SYSTEM_BASE + " " + [
  "MODO CHAT: responde la pregunta concreta de Leonard usando el JSON de datos.",
  "REGLA DE ORO: nunca digas que 'no hay leads', 'no hay nada que hacer' o 'no hay contactos'. El radar tiene leads (ver total_leads y leads_pendientes). Siempre hay trabajo: prioriza los pendientes.",
  "CAMPO contactado_en: fecha en que Leonard contacto al lead por ultima vez, o null si aun NO ha sido contactado. 'Leads viejos', 'pendientes' o 'a quien contacto' = leads con contactado_en null o de hace mas de 7 dias. Ofrece los 5 mejores CON telefono, ordenados por score, cada uno con su argumento (motivos/quote/perdida_mes). Indica tambien cuantos quedan pendientes en total.",
  "Si pide redactar un mensaje, entregalo listo para copiar.",
  "Si la pregunta no se puede responder con los datos, dilo en una linea y ofrece lo mas cercano util.",
  "Termina siempre con UNA sugerencia de siguiente accion concreta."
].join(" ");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Solo POST" });

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const sbUser = createClient(SB_URL, SB_ANON);
  const { data: { user }, error: authErr } = await sbUser.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Debes iniciar sesion." });

  // body puede venir vacio (boton briefing antiguo)
  let body = {};
  try { body = req.body || {}; } catch (e) { body = {}; }
  const modo = body.modo || (body.pregunta ? "chat" : "briefing");
  const pregunta = (body.pregunta || "").toString().slice(0, 500);

  const sb = createClient(SB_URL, SB_SERVICE);
  const { data: leads } = await sb.from("businesses")
    .select("nombre,score,tier,telefono,email,categoria,motivos,quote,perdida_mes,propuesta,zona,ciudad,contactado_en")
    .order("score", { ascending: false }).limit(30);
  const hace48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: senales } = await sb.from("intent_signals")
    .select("titulo,keyword,zona,fecha").gte("fecha", hace48h)
    .order("fecha", { ascending: false }).limit(15);

  const hoy = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const hace7dias = Date.now() - 7 * 24 * 3600 * 1000;
  const pendientes = (leads || []).filter(l => !l.contactado_en || new Date(l.contactado_en).getTime() < hace7dias).length;
  const contexto = JSON.stringify({
    fecha_hoy: hoy,
    total_leads: (leads || []).length,
    leads_pendientes_contacto: pendientes,
    leads: leads || [],
    senales_ultimas_48h: senales || []
  });

  const system = modo === "chat" ? SYSTEM_CHAT : SYSTEM_BRIEFING;
  const mensajeUsuario = modo === "chat"
    ? ("PREGUNTA DE LEONARD: " + pregunta + "\n\nDATOS:\n" + contexto)
    : ("Genera el briefing de hoy. DATOS:\n" + contexto);

  let respuesta = "", motor = "";
  if (process.env.MOONSHOT_API_KEY) {
    try {
      const r = await fetch("https://api.moonshot.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.MOONSHOT_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.MOONSHOT_MODEL || "kimi-k2-0905-preview",
          temperature: 0.6,
          messages: [{ role: "system", content: system }, { role: "user", content: mensajeUsuario }] }) });
      const j = await r.json();
      if (j.choices && j.choices[0] && j.choices[0].message) { respuesta = j.choices[0].message.content; motor = "kimi"; }
    } catch (e) { /* cae al respaldo */ }
  }
  if (!respuesta && process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.6,
          messages: [{ role: "system", content: system }, { role: "user", content: mensajeUsuario }] }) });
      const j = await r.json();
      if (j.choices && j.choices[0] && j.choices[0].message) { respuesta = j.choices[0].message.content; motor = "openai (respaldo)"; }
    } catch (e) { /* nada */ }
  }

  if (!respuesta) return res.status(500).json({ error: "Ninguna IA respondio. Revisa MOONSHOT_API_KEY y OPENAI_API_KEY en Vercel." });
  // 'briefing' se mantiene por compatibilidad con el modal antiguo
  return res.json({ ok: true, respuesta, briefing: respuesta, motor, modo });
};