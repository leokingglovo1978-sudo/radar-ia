// Sonar de diagnostico: que ve el servidor de Vercel desde dentro.
const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  const out = { url_ref: (process.env.SUPABASE_URL || "NO_CONFIGURADA").replace("https://", "").slice(0, 18) };
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const c1 = await sb.from("businesses").select("id", { count: "exact", head: true });
    out.count = c1.count;
    out.readError = c1.error ? c1.error.message : null;

    const testId = "ping-test-" + Date.now();
    const ins = await sb.from("businesses").upsert({ id: testId, nombre: "TEST-PING" }, { onConflict: "id" });
    out.insertError = ins.error ? (ins.error.message + " | code: " + (ins.error.code || "?")) : null;

    const c2 = await sb.from("businesses").select("id", { count: "exact", head: true });
    out.countAfterInsert = c2.count;

    const del = await sb.from("businesses").delete().eq("id", testId);
    out.deleteError = del.error ? del.error.message : null;

    const c3 = await sb.from("businesses").select("id", { count: "exact", head: true });
    out.countAfterDelete = c3.count;
  } catch (e) {
    out.exception = e.message;
  }
  res.setHeader("Content-Type", "application/json");
  res.json(out);
};
