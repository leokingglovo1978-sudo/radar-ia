"""Extracción de negocios y reseñas vía Google Places API (New)."""
import os, time, requests
from dotenv import load_dotenv
from db import get, upsert_business

load_dotenv()
KEY = os.getenv("GOOGLE_PLACES_API_KEY")
HEADERS = {"X-Goog-Api-Key": KEY, "Content-Type": "application/json"}
FIELDS_SEARCH = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.regularOpeningHours,places.websiteUri,places.googleMapsUri,nextPageToken"
FIELDS_DETAILS = "reviews,rating,userRatingCount,regularOpeningHours,websiteUri,nationalPhoneNumber,displayName,formattedAddress,googleMapsUri,location"

def text_search(query, max_results=20):
    """Devuelve lista de place_id para una consulta tipo 'dentistas en Madrid'."""
    url = "https://places.googleapis.com/v1/places:searchText"
    ids, token = [], None
    while len(ids) < max_results:
        body = {"textQuery": query, "pageSize": 20, "languageCode": "es"}
        if token: body["pageToken"] = token
        r = requests.post(url, json=body, headers={**HEADERS, "X-Goog-FieldMask": FIELDS_SEARCH}, timeout=30)
        r.raise_for_status(); j = r.json()
        for p in j.get("places", []):
            if p.get("id"): ids.append(p["id"])
        token = j.get("nextPageToken")
        if not token: break
        time.sleep(2)  # Google exige esperar antes de usar el pageToken
    return ids[:max_results]

def fetch_details(place_id):
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    r = requests.get(url, headers={**HEADERS, "X-Goog-FieldMask": FIELDS_DETAILS}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"Google devolvio {r.status_code}: {r.text[:300]}")
    p = r.json()
    hours = p.get("regularOpeningHours", {})
    weekday = (hours.get("weekdayDescriptions") or [])
    extendido = any(any(d in s for d in ("Saturday","Domingo","sábado","Sábado","domingo")) or 
                    any(f"{h}:00 PM" in s or f"{h} PM" in s for h in range(7,12)) for s in weekday)
    web = p.get("websiteUri", "") or ""
    reserva_kw = ("reserv","cita","booking","appointment","agenda")
    tiene_reserva = any(k in web.lower() for k in ("book","reserv","cita")) if web else False
    return {
        "id": place_id,
        "nombre": p.get("displayName", {}).get("text", ""),
        "categoria": "",   # se rellena en scoring por keyword del nombre/categoría
        "direccion": p.get("formattedAddress", ""),
        "telefono": p.get("nationalPhoneNumber", ""),
        "web": web,
        "rating": p.get("rating", 0),
        "total_resenas": p.get("userRatingCount", 0),
        "resenas_mes": round(p.get("userRatingCount", 0) / 36),  # estimación prudente
        "tiene_reserva_online": int(tiene_reserva),
        "abre_extendido": int(bool(extendido)),
        "maps_url": p.get("googleMapsUri", ""),
    }, p.get("reviews", [])

def extract(query, max_results=20, ciudad=""):
    con = get()
    for pid in text_search(query, max_results):
        b, reviews = fetch_details(pid)
        upsert_business(con, b)
        for rv in reviews:
            con.execute("INSERT INTO reviews VALUES(?,?,?,?,?,?)",
                (pid, rv.get("authorAttribution",{}).get("displayName",""),
                 rv.get("text",{}).get("text","") or "", rv.get("publishTime",""),
                 int(rv.get("rating", 0) or 0), 0))
        con.commit()
        print(f"  ✓ {b['nombre']} ({len(reviews)} reseñas)")
    con.close()
