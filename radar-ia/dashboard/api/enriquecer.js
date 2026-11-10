// Enriquecer leads con email: visita la web de cada negocio y extrae el mailto.
const { createClient } = require("@supabase/supabase-js");
const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;

function extraerEmails(html) {
  const mails = (html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
    .map(m => m.toLowerCase())
    .filter(m => !/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(m))
    .filter(m => !/(sentry|wixpress|godaddy|schema|example|@2x|doubleclick|googleapis|fontawesome|bootstrap|jquery|cloudflare|gstatic|w3\.org)/i.test(m))
    .filter(m => m.length < 60);
  return mails;
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

  const sb = createClient(SB_URL, SB_SERVICE);
  const { data: leads } = await sb.from("businesses")
    .select("id, web").not("web", "eq", "").or("email.is.null,email.eq.")
    .limit(25);
  if (!leads || !leads.length) return res.json({ ok: true, procesados: 0, encontrados: 0, mensaje: "Todos los leads con web ya tienen email (o no tienen web)." });

  let encontrados = 0;
  for (const l of leads) {
    try {
      const r = await fetch(l.web, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }, signal: AbortSignal.timeout(6000) });
      const html = await r.text();
      const mails = extraerEmails(html);
      if (mails.length) {
        await sb.from("businesses").update({ email: mails[0] }).eq("id", l.id);
        encontrados++;
      }
    } catch (e) { /* web inaccesible: se omite */ }
  }
  return res.json({ ok: true, procesados: leads.length, encontrados,
    mensaje: "Procesados " + leads.length + " | emails encontrados: " + encontrados + " | quedan mas: " + (leads.length === 25) });
};