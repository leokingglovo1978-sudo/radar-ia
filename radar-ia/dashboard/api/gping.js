// Sonar de Google: que responde Google Places a un textSearch identico al de scan.js
module.exports = async (req, res) => {
  const out = { key_prefix: (process.env.GOOGLE_PLACES_API_KEY || "NO_CONFIGURADA").slice(0, 8) };
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "places.id,places.displayName,nextPageToken"
      },
      body: JSON.stringify({ textQuery: "peluquerias en Almeria", pageSize: 20, languageCode: "es" })
    });
    out.status = r.status;
    const j = await r.json();
    if (j.error) {
      out.error = j.error.message || JSON.stringify(j.error);
      out.code = j.error.code || j.error.status || "?";
    } else {
      out.encontrados = (j.places || []).length;
      out.muestra = (j.places || []).slice(0, 3).map(p => (p.displayName && p.displayName.text) || p.id).join(" | ");
    }
  } catch (e) { out.exception = e.message; }
  res.setHeader("Content-Type", "application/json");
  res.json(out);
};
