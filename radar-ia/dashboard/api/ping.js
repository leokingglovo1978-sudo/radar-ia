// Sonar v2: prueba lectura, fila minima Y fila completa (igual que scan.js)
const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  const out = { url_ref: (process.env.SUPABASE_URL || "NO_CONFIGURADA").replace("https://", "").slice(0, 18) };
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const c1 = await sb.from("businesses").select("id", { count: "exact", head: true });
    out.count = c1.count;

    // PRUEBA A: fila minima (como antes)
    const testId = "ping-min-" + Date.now();
    const insA = await sb.from("businesses").upsert({ id: testId, nombre: "TEST-MIN" }, { onConflict: "id" });
    out.minInsertError = insA.error ? insA.error.message : null;
    await sb.from("businesses").delete().eq("id", testId);

    // PRUEBA B: fila COMPLETA con todos los campos y tipos que manda scan.js
    const testId2 = "ping-full-" + Date.now();
    const filaCompleta = {
      id: testId2, nombre: "TEST-FULL", categoria: "estetica", direccion: "calle x",
      telefono: "600000000", web: "", rating: 4.5, total_resenas: 120, resenas_mes: 3,
      tiene_reserva_online: 0, abre_extendido: 1, sucursales: 1,
      no_contesta_count: 0, citas_dificiles_count: 0, quote: "una frase",
      score: 45, tier: "TIBIO", motivos: "sin reserva online",
      maps_url: "https://maps.google.com/?cid=x", lat: 36.84, lng: -2.46,
      ciudad: "Almeria", perdida_mes: 100, propuesta: "150 EUR + 49 EUR/mes"
    };
    const insB = await sb.from("businesses").upsert(filaCompleta, { onConflict: "id" });
    out.fullInsertError = insB.error ? (insB.error.message + " | code: " + (insB.error.code || "?") + " | hint: " + (insB.error.hint || "-")) : null;
    out.fullInsertStatus = insB.status;
    if (!insB.error) {
      const c2 = await sb.from("businesses").select("id", { count: "exact", head: true });
      out.countAfterFullInsert = c2.count;
      await sb.from("businesses").delete().eq("id", testId2);
    }
  } catch (e) { out.exception = e.message; }
  res.setHeader("Content-Type", "application/json");
  res.json(out);
};
