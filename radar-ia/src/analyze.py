"""Analiza reseñas con un LLM y cuenta señales de dolor de IA."""
import os, json, sqlite3
from dotenv import load_dotenv
from openai import OpenAI
from db import get

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

PROMPT = """Eres un analista de negocios. Lee estas reseñas de Google de un negocio y devuelve SOLO JSON válido con:
- "no_contesta": nº de reseñas que se quejan de que NO contestan WhatsApp/teléfono/mensajes o tardanza extrema en responder
- "citas_dificiles": nº de reseñas que mencionan que es difícil conseguir cita/reserva/turno
- "quote": la frase textual más contundente de queja sobre no contestar (o "")
Reseñas:
"""

def analizar_bloque(textos):
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": PROMPT + "\n---\n".join(f"- {t}" for t in textos)}],
        temperature=0)
    return json.loads(r.choices[0].message.content)

def run():
    con = get()
    biz = con.execute("SELECT id, nombre FROM businesses").fetchall()
    for pid, nombre in biz:
        textos = [r[0] for r in con.execute(
            "SELECT texto FROM reviews WHERE business_id=? AND texto!='' LIMIT 40", (pid,))]
        if not textos: continue
        try:
            j = analizar_bloque(textos)
        except Exception as e:
            print(f"  ✗ {nombre}: {e}"); continue
        con.execute("UPDATE businesses SET no_contesta_count=?, citas_dificiles_count=?, quote=? WHERE id=?",
                    (int(j.get("no_contesta", 0)), int(j.get("citas_dificiles", 0)),
                     j.get("quote", "")[:300], pid))
        con.execute("UPDATE reviews SET detectado=1 WHERE business_id=?", (pid,))
        con.commit()
        print(f"  ✓ {nombre}: no_contesta={j.get('no_contesta')}, citas_dificiles={j.get('citas_dificiles')}")
    con.close()
