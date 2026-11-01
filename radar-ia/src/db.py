import sqlite3, os

DB = os.path.join(os.path.dirname(__file__), "..", "data", "radar.db")

def get():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute("""CREATE TABLE IF NOT EXISTS businesses(
        id TEXT PRIMARY KEY, nombre TEXT, categoria TEXT,
        direccion TEXT, telefono TEXT, web TEXT, rating REAL,
        total_resenas INTEGER, resenas_mes INTEGER,
        tiene_reserva_online INTEGER, abre_extendido INTEGER,
        sucursales INTEGER DEFAULT 1, no_contesta_count INTEGER DEFAULT 0,
        citas_dificiles_count INTEGER DEFAULT 0, quote TEXT,
        score INTEGER DEFAULT 0, tier TEXT, motivos TEXT, maps_url TEXT)""")
    con.execute("""CREATE TABLE IF NOT EXISTS reviews(
        business_id TEXT, autor TEXT, texto TEXT, fecha TEXT,
        estrellas INTEGER, detectado INTEGER DEFAULT 0)""")
    return con

def upsert_business(con, b):
    cols = ", ".join(b.keys()); ph = ", ".join("?"*len(b))
    con.execute(f"INSERT OR REPLACE INTO businesses({cols}) VALUES({ph})", tuple(b.values()))
    con.commit()
