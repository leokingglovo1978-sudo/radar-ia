// Descartar leads o senyales (borrado real en Supabase, solo administrador)
const { createClient } = require("@supabase/supabase-js");
const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Solo POST" });

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const sbUser = createClient(SB_URL, SB_ANON);
  const { data: { user }, error: authErr } = await sbUser.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Debes iniciar sesion." });

  const { tipo, id } = req.body || {};
  if (!tipo || !id) return res.status(400).json({ error: "Falta tipo o id" });

  const sb = createClient(SB_URL, SB_SERVICE);
  if (tipo === "lead") {
    await sb.from("reviews").delete().eq("business_id", id);   // primero las resenyas (clave foranea)
    const { error } = await sb.from("businesses").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
  } else if (tipo === "senal") {
    const { error } = await sb.from("intent_signals").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    return res.status(400).json({ error: "tipo debe ser 'lead' o 'senal'" });
  }
  return res.json({ ok: true });
};