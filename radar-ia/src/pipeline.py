"""Radar IA — pipeline completo: extract → analyze → score."""
import sys, os, subprocess, shutil
from db import get, upsert_business

DEMO = [
    {"id":"d1","nombre":"Clínica Dental Sonrisas","telefono":"+34 600111222","web":"","rating":4.3,"total_resenas":790,"resenas_mes":22,"tiene_reserva_online":0,"abre_extendido":1,"maps_url":"https://maps.google.com/?cid=d1"},
    {"id":"d2","nombre":"Restaurante El Fogón","telefono":"+34 600333444","web":"","rating":4.1,"total_resenas":1100,"resenas_mes":31,"tiene_reserva_online":0,"abre_extendido":1,"maps_url":"https://maps.google.com/?cid=d2"},
    {"id":"d3","nombre":"InmoLuxe Madrid","telefono":"+34 600555666","web":"","rating":4.0,"total_resenas":320,"resenas_mes":9,"tiene_reserva_online":0,"abre_extendido":1,"maps_url":"https://maps.google.com/?cid=d3"},
    {"id":"d4","nombre":"Estética Glow","telefono":"+34 600777888","web":"https://esteticaglow.com/reservas","rating":4.8,"total_resenas":510,"resenas_mes":14,"tiene_reserva_online":1,"abre_extendido":1,"maps_url":"https://maps.google.com/?cid=d4"},
    {"id":"d5","nombre":"Taller Mecánico Rápido","telefono":"+34 600999000","web":"","rating":3.9,"total_resenas":210,"resenas_mes":6,"tiene_reserva_online":0,"abre_extendido":1,"maps_url":"https://maps.google.com/?cid=d5"},
]
DEMO_REVIEWS = {
 "d1":[(5,"Excelentes doctores pero NADIE contesta el WhatsApp, tuve que llamar 5 veces"),
       (4,"Muy buena atención, aunque para pedir cita por teléfono es imposible, no contestan"),
       (5,"El mejor dentista, solo les falta contestar los mensajes más rápido"),
       (5,"Trato inmejorable"),(4,"Bien, pero esperé 3 días a que me contestaran la solicitud"),
       (5,"Profesionales de lujo")],
 "d2":[(3,"La comida es buenísima pero para reservar mesa es un infierno, nunca contestan el teléfono"),
       (4,"Rico todo, la única pega es que no responden mensajes"),
       (2,"Llamé 4 veces para reservar y nada, fui a otro sitio"),
       (5,"Genial"),(3,"Bien pero contesten el WhatsApp por favor"),
       (5,"Espectacular arroz"),(1,"Intenté reservar por Instagram y nunca contestaron"),
       (4,"Muy rico")],
 "d3":[(4,"Buenas propiedades pero tardan siglos en contestar las consultas"),
       (5,"Muy profesionales"),(3,"No contestan el teléfono, tuve que ir en persona"),
       (5,"Me ayudaron con el piso perfecto"),(4,"Bien en general")],
 "d4":[(5,"Reservé online en 1 minuto, todo perfecto"),(5,"Genial"),(5,"Excelente")],
 "d5":[(4,"Buen trabajo pero es difícil conseguir cita, no contestan a la primera"),
      (3,"El taller bien, pero nadie contesta el WhatsApp para pedir presupuesto"),
      (5,"Rápidos y baratos"),(4,"Bien")],
}

def demo():
    shutil.rmtree("data", ignore_errors=True); os.makedirs("data")
    con = get()
    for b in DEMO:
        upsert_business(con, {**b,"categoria":"","direccion":"","sucursales":1,
                              "no_contesta_count":0,"citas_dificiles_count":0,
                              "quote":"","score":0,"tier":""})
        for estrellas, texto in DEMO_REVIEWS[b["id"]]:
            con.execute("INSERT INTO reviews VALUES(?,?,?,?,?,0)",(b["id"],"demo",texto,"2026-10",estrellas))
    con.commit(); con.close()
    print("1/3 Datos demo cargados")
    subprocess.run([sys.executable, "src/analyze_demo.py"])
    print("3/3 Scoring y export:")
    subprocess.run([sys.executable, "src/score.py"])

if __name__ == "__main__":
    if len(sys.argv) < 2: print("Uso: python src/pipeline.py demo | extract 'consulta' --max N"); sys.exit()
    cmd = sys.argv[1]
    if cmd == "demo": demo()
    elif cmd == "extract":
        q = sys.argv[2]; mx = int(sys.argv[sys.argv.index("--max")+1]) if "--max" in sys.argv else 20
        cd = sys.argv[sys.argv.index("--ciudad")+1] if "--ciudad" in sys.argv else ""
        from extract import extract; print("Extrayendo…"); extract(q, mx, cd)
    elif cmd == "analyze": from analyze import run; print("Analizando reseñas…"); run()
    elif cmd == "score": from score import run; run()
