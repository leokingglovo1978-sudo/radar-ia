// api/marcar.js — Marcar/desmarcar un lead como contactado (toggle)
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

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Falta id" });

  const sb = createClient(SB_URL, SB_SERVICE);
  const { data: row } = await sb.from("businesses").select("contactado_en").eq("id", id).single();
  const nuevoValor = row && row.contactado_en ? null : new Date().toISOString();  // toggle
  const { error } = await sb.from("businesses").update({ contactado_en: nuevoValor }).eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, contactado: !!nuevoValor });
};