// api/asesor.js — Briefing diario generado por IA (Kimi/Moonshot, con respaldo OpenAI)
const { createClient } = require("@supabase/supabase-js");
const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;

const SYSTEM = [
  "Eres el asesor comercial personal de Leonard Narvaez, desarrollador de Almeria que vende agentes de WhatsApp con IA a pymes locales (precio habitual: 150 EUR de puesta en marcha + 49 EUR/mes).",
  "Recibiras un JSON con: la fecha de hoy, los leads ordenados por score (campos: nombre, score, tier, telefono, email, categoria, motivos, quote, perdida_mes, zona) y las senales de intencion de las ultimas 48 horas (titulo, keyword, zona, fecha).",
  "Genera el BRIEFING DIARIO cumpliendo estas reglas:",
  "- Maximo 220 palabras. Tono directo y cercano: eres su copiloto, no un informe corporativo.",
  '- Empieza con "Buenos dias, Leonard" seguido de la fecha y UN dato llamativo del dia.',
  "- SECCION 1 - SENALES: solo las que valgan la pena (ofertas de empleo y licitaciones primero; ignora noticias genericas). Maximo 3. Si no hay, una linea.",
  "- SECCION 2 - TOP CONTACTOS DE HOY: los 3 leads con telefono mas calientes. Por cada uno: nombre, telefono, y UN argumento extraido de sus motivos, quote o perdida_mes.",
  "- SECCION 3 - ACCIONES RAPIDAS: 2 tareas extra (ej. algun lead caliente sin telefono para visitar, o algun tibio para WhatsApp).",
  "- Cierra con una frase de motivacion de maximo 10 palabras.",
  "- Escribe TODO en espanol SIN tildes ni caracteres especiales (n, vocal simple). Texto plano, usando guiones para las secciones."
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

  const sb = createClient(SB_URL, SB_SERVICE);
  const { data: leads } = await sb.from("businesses")
    .select("nombre,score,tier,telefono,email,categoria,motivos,quote,perdida_mes,propuesta,zona,ciudad")
    .order("score", { ascending: false }).limit(15);
  const hace48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: senales } = await sb.from("intent_signals")
    .select("titulo,keyword,zona,fecha").gte("fecha", hace48h)
    .order("fecha", { ascending: false }).limit(15);

  const hoy = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const contexto = JSON.stringify({ fecha_hoy: hoy, leads: leads || [], senales_ultimas_48h: senales || [] });
  const pregunta = "Genera el briefing de hoy con los datos proporcionados. Solo el briefing, sin explicaciones extra.";

  // 1) Intentar con Kimi/Moonshot
  let respuesta = "", motor = "";
  if (process.env.MOONSHOT_API_KEY) {
    try {
      const r = await fetch("https://api.moonshot.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.MOONSHOT_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.MOONSHOT_MODEL || "kimi-k2-0905-preview",
          temperature: 0.6,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: pregunta + "\n\nDATOS:\n" + contexto }] }) });
      const j = await r.json();
      if (j.choices && j.choices[0] && j.choices[0].message) { respuesta = j.choices[0].message.content; motor = "kimi"; }
    } catch (e) { /* cae al respaldo */ }
  }

  // 2) Respaldo OpenAI (ya configurado)
  if (!respuesta && process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.6,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: pregunta + "\n\nDATOS:\n" + contexto }] }) });
      const j = await r.json();
      if (j.choices && j.choices[0] && j.choices[0].message) { respuesta = j.choices[0].message.content; motor = "openai (respaldo)"; }
    } catch (e) { /* nada */ }
  }

  if (!respuesta) return res.status(500).json({ error: "Ninguna IA respondio. Revisa MOONSHOT_API_KEY y OPENAI_API_KEY en Vercel." });
  return res.json({ ok: true, briefing: respuesta, motor });
};