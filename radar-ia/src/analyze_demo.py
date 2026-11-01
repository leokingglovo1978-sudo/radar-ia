"""Analizador de reseñas por keywords — modo demo offline."""
import re
from db import get

PATRONES = [r"no contesta\w*", r"nunca contesta\w*", r"nadie contesta", r"no responde\w*",
            r"no contestan", r"imposible.*(contestar|llamar)", r"es dif.cil.*(cita|reserva)"]

def run():
    con = get()
    print("2/3 Analizando reseñas (keywords, offline)…")
    for pid, nombre in con.execute("SELECT id, nombre FROM businesses"):
        textos = [r[0] for r in con.execute("SELECT texto FROM reviews WHERE business_id=?", (pid,))]
        n_no = sum(1 for t in textos if re.search(PATRONES[0], t, re.I) or re.search(PATRONES[1], t, re.I)
                   or re.search(PATRONES[2], t, re.I) or re.search(PATRONES[3], t, re.I) or re.search(PATRONES[4], t, re.I))
        n_citas = sum(1 for t in textos if re.search(PATRONES[5], t, re.I) or re.search(PATRONES[6], t, re.I))
        quote = next((t for t in textos if re.search("no contesta", t, re.I)), "")
        con.execute("UPDATE businesses SET no_contesta_count=?, citas_dificiles_count=?, quote=? WHERE id=?",
                    (n_no, n_citas, quote[:300], pid))
    con.commit(); con.close()

if __name__ == "__main__":
    run()
