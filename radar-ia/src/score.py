"""Motor de scoring: traduce señales en 'dolor de IA' (0-100)."""
import csv, os
from db import get

VERTICALES = {
    "dental":       ["dental", "dentista", "odontolog", "sonrisa"],
    "inmobiliaria": ["inmo", "real estate", "finca", "propiedad"],
    "estetica":     ["estética", "estetica", "beauty", "spa", "peluquer", "barber"],
    "restaurante":  ["restaurant", "bar ", "cafeter", "comida", "taquer", "pizzer"],
    "taller":       ["taller", "mecánic", "mecanic", "auto", "neumátic", "moto"],
}
CALIENTE = {"dental","inmobiliaria","estetica","restaurante","taller"}

def detectar_vertical(nombre):
    n = nombre.lower()
    for vert, kws in VERTICALES.items():
        if any(k in n for k in kws): return vert
    return "otro"

def score(b):
    """b: dict con las columnas del negocio. Devuelve (score, tier, motivos)."""
    p, motivos = 0, []
    if b["no_contesta_count"] >= 3:
        p += 30; motivos.append(f"'no contestan' en {b['no_contesta_count']} reseñas → chatbot/voz")
    if b["resenas_mes"] >= 15:
        p += 20; motivos.append(f"{b['resenas_mes']} reseñas/mes → volumen real")
    if b["vertical"] in CALIENTE:
        p += 15; motivos.append(f"vertical caliente: {b['vertical']}")
    if b["citas_dificiles_count"] >= 1:
        p += 10; motivos.append("citas difíciles en reseñas → agente de citas")
    if not b["tiene_reserva_online"]:
        p += 15; motivos.append("sin reserva online")
    if b["abre_extendido"]:
        p += 10; motivos.append("horario extendido → cuelgue fuera de horario")
    p = min(p, 100)
    tier = "CALIENTE" if p >= 70 else "TIBIO" if p >= 45 else "BAJO"
    return p, tier, "; ".join(motivos) or "sin señales claras"

def run():
    con = get()
    rows = [dict(zip([c[1] for c in con.execute("PRAGMA table_info(businesses)")], r))
            for r in con.execute("SELECT * FROM businesses")]
    for b in rows:
        b["vertical"] = detectar_vertical(b["nombre"])
        s, t, m = score(b)
        con.execute("UPDATE businesses SET score=?, tier=?, motivos=?, categoria=? WHERE id=?",
                    (s, t, m, b["vertical"], b["id"]))
    con.commit()
    os.makedirs("data", exist_ok=True)
    hot = con.execute("SELECT nombre,telefono,score,tier,motivos,quote,maps_url FROM businesses ORDER BY score DESC").fetchall()
    with open("data/leads.csv","w",newline="",encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["nombre","telefono","score","tier","motivos","quote_para_outreach","maps_url"])
        for r in hot: w.writerow(r)
    for n,_,s,t,_,_,_ in hot:
        icon = "🔥" if t=="CALIENTE" else "🟡" if t=="TIBIO" else "⚪"
        print(f"  {icon} {s:>3}  {t:<9}  {n}")
    print(f"\n✅ Exportado: data/leads.csv ({len(hot)} negocios)")
    con.close()

if __name__ == "__main__":
    run()
