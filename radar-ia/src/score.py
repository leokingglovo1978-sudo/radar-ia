"""Motor de scoring: traduce senyales en 'dolor de IA' + estimador de euros."""
import csv, os
from db import get

VERTICALES = {
    "dental":       ["dental", "dentista", "odontolog", "sonrisa"],
    "inmobiliaria": ["inmo", "real estate", "finca", "propiedad"],
    "estetica":     ["estetica", "beauty", "spa", "peluquer", "barber"],
    "restaurante":  ["restaurant", "bar ", "cafeter", "comida", "taquer", "pizzer"],
    "taller":       ["taller", "mecanic", "auto", "neumatic", "moto"],
}
CALIENTE = {"dental","inmobiliaria","estetica","restaurante","taller"}

# ticket medio por cliente segun vertical (EUR)
TICKET = {"dental": 70, "restaurante": 25, "estetica": 35, "inmobiliaria": 150, "taller": 60, "otro": 30}

def detectar_vertical(nombre):
    n = nombre.lower()
    for vert, kws in VERTICALES.items():
        if any(k in n for k in kws): return vert
    return "otro"

def score(b):
    p, motivos = 0, []
    if b["no_contesta_count"] >= 3:
        p += 30; motivos.append(f"'no contestan' en {b['no_contesta_count']} resenyas")
    elif b["no_contesta_count"] >= 1:
        p += 25; motivos.append("1 resenya de 'no contestan' (20% de la muestra)")
    if b["resenas_mes"] >= 15:
        p += 20; motivos.append(f"{b['resenas_mes']} resenyas/mes")
    if b["vertical"] in CALIENTE:
        p += 15; motivos.append(f"vertical caliente: {b['vertical']}")
    if b["citas_dificiles_count"] >= 1:
        p += 10; motivos.append("citas dificiles en resenyas")
    if not b["tiene_reserva_online"]:
        p += 15; motivos.append("sin reserva online")
    if b["abre_extendido"]:
        p += 10; motivos.append("horario extendido")
    p = min(p, 100)
    tier = "CALIENTE" if p >= 70 else "TIBIO" if p >= 45 else "BAJO"
    return p, tier, "; ".join(motivos) or "sin senyales claras"

def estimar(b):
    """Cuanto dinero pierde el negocio al mes y que precio le propones."""
    ticket = TICKET.get(b["vertical"], 30)
    perdidos = max(1, round(b["resenas_mes"] * 0.10))      # ~10% de la demanda se pierde por friccion
    perdida = round(perdidos * ticket, -1)                  # redondeo a decenas
    setup = 150 if perdida < 200 else (250 if perdida < 500 else 490)
    mensual = 49 if perdida < 300 else 79
    return int(perdida), f"{setup} EUR de puesta en marcha + {mensual} EUR/mes"

def run():
    con = get()
    cols = [c[1] for c in con.execute("PRAGMA table_info(businesses)")]
    rows = [dict(zip(cols, r)) for r in con.execute("SELECT * FROM businesses")]
    for b in rows:
        b["vertical"] = detectar_vertical(b["nombre"])
        s, t, m = score(b)
        perdida, propuesta = estimar(b)
        con.execute("UPDATE businesses SET score=?, tier=?, motivos=?, categoria=?, perdida_mes=?, propuesta=? WHERE id=?",
                    (s, t, m, b["vertical"], perdida, propuesta, b["id"]))
    con.commit()
    os.makedirs("data", exist_ok=True)
    hot = con.execute("SELECT nombre,telefono,score,tier,motivos,quote,maps_url,perdida_mes,propuesta FROM businesses ORDER BY score DESC").fetchall()
    with open("data/leads.csv","w",newline="",encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["nombre","telefono","score","tier","motivos","quote_para_outreach","maps_url","perdida_mes_eur","propuesta_precio"])
        for r in hot: w.writerow(r)
    for n,_,s,t,_,_,_,pd_,pr in hot[:12]:
        icon = "🔥" if t=="CALIENTE" else "🟡" if t=="TIBIO" else "⚪"
        print(f"  {icon} {s:>3}  pierde ~{pd_} EUR/mes  ->  {n}  ({pr})")
    print(f"\nOK Exportado: data/leads.csv ({len(hot)} negocios)")
    con.close()

if __name__ == "__main__":
    run()