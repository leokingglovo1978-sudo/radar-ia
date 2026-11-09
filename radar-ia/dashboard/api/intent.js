// Radar de intencion: lee feeds RSS de Google Alerts y guarda senyales en Supabase.
const { createClient } = require("@supabase/supabase-js");

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;

function parseFeed(xml) {
  // Soporta Atom (Google Alerts) y RSS 2.0
  const items = [];
  let m;
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  while ((m = entryRe.exec(xml))) {
    const e = m[1];
    const title = (e.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || "";
    const link = ((e.match(/<link[^>]*href="([^"]+)"/) || [])[1]) || "";
    const fecha = (e.match(/<published>([^<]+)<\/published>/) || e.match(/<updated>([^<]+)<\/updated>/) || [])[1] || "";
    const fuente = ((e.match(/<author>[\s\S]*?<name>([^<]*)<\/name>/) || [])[1]) || "";
    if (title && link) items.push({ titulo: title.trim(), link, fecha, fuente });
  }
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  while ((m = itemRe.exec(xml))) {
    const e = m[1];
    const title = (e.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || "";
    const link = (e.match(/<link>([^<]+)<\/link>/) || [])[1] || "";
    const fecha = (e.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || "";
    if (title && link) items.push({ titulo: title.trim(), link, fecha, fuente: "" });
  }
  return items;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Solo POST" });

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const sbUser = createClient(SB_URL, SB_ANON);
  const { data: { user }, error: authErr } = await sbUser.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Debes iniciar sesion." });

  const sbAdmin = createClient(SB_URL, SB_SERVICE);
  const { data: fuentes } = await sbAdmin.from("intent_sources").select("*");
  if (!fuentes || !fuentes.length)
    return res.json({ mensaje: "0 fuentes configuradas. Anade feeds de Google Alerts en la tabla intent_sources." });

  let nuevas = 0, errores = 0;
  for (const f of fuentes) {
    try {
      const r = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
      const xml = await r.text();
      const items = parseFeed(xml);
      for (const it of items.slice(0, 20)) {
        const limpio = (s) => (s || "").replace(/<[^>]*>/g, "").trim();
        const id = Buffer.from(it.link + "|" + it.fecha).toString("base64").replace(/[+/=]/g, "_");
        const { error } = await sbAdmin.from("intent_signals").upsert({
          id, titulo: limpio(it.titulo).slice(0, 500), link: it.link, fuente: it.fuente,
          keyword: f.keyword || "", fecha: it.fecha, resumen: "" }, { onConflict: "id" });
        if (!error) nuevas++;
      }
    } catch (e) { errores++; }
  }
  const total = (await sbAdmin.from("intent_signals").select("id", { count: "exact", head: true })).count;
  return res.json({ ok: true, mensaje: "Fuentes: " + fuentes.length + " | senyales en base: " + total + " | (fuentes con error: " + errores + ")", total });
};