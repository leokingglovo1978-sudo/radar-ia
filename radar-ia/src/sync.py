"""Sincroniza la base de datos local (radar.db) con Supabase."""
import os, sqlite3
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
SB = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

COLS_B = ["id","nombre","categoria","direccion","telefono","web","rating",
          "total_resenas","resenas_mes","tiene_reserva_online","abre_extendido",
          "sucursales","no_contesta_count","citas_dificiles_count","quote",
          "score","tier","motivos","maps_url"]
COLS_R = ["business_id","autor","texto","fecha","estrellas","detectado"]

def rows_dicts(cur, cols):
    return [dict(zip(cols, r)) for r in cur.fetchall()]

def run():
    con = sqlite3.connect(os.path.join(os.path.dirname(__file__), "..", "data", "radar.db"))
    biz = rows_dicts(con.execute("SELECT * FROM businesses"), COLS_B)
    rev = rows_dicts(con.execute("SELECT * FROM reviews"), COLS_R)
    # limpiar y volcar (volumen pequeno: simple y robusto)
    SB.table("reviews").delete().neq("business_id", "").execute()
    SB.table("businesses").delete().neq("id", "").execute()
    for i in range(0, len(biz), 100):
        SB.table("businesses").upsert(biz[i:i+100]).execute()
    for i in range(0, len(rev), 200):
        SB.table("reviews").upsert(rev[i:i+200]).execute()
    print(f"OK Sincronizado: {len(biz)} negocios, {len(rev)} resenas a Supabase")

if __name__ == "__main__":
    run()
