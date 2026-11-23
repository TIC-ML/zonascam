"""
Geocodifica con CartoCiudad (Instituto Geográfico Nacional) los centros de la web que no tienen coordenadas
y las guarda en fuentes/coordenadas_geocodificadas.csv (CODIGO, LAT, LON, FUENTE, DUDAS).
Las que no coinciden con el portal exacto quedan marcadas en DUDAS.

Uso:
    # Tras preparar_datos.py; después vuelve a ejecutar preparar_datos.py para que las use
    python scripts/geocodificar.py
"""
import csv
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "fuentes" / "coordenadas_geocodificadas.csv"
URL = "https://www.cartociudad.es/geocoder/api/geocoder/find?q="


# Pregunta a CartoCiudad por una dirección y devuelve su respuesta (o None)
def buscar(q):
    try:
        with urllib.request.urlopen(URL + urllib.parse.quote(q), timeout=30) as r:
            d = json.loads(r.read().decode("utf-8") or "null")
        return d if d and d.get("lat") else None
    except Exception:
        return None


# Programa principal: geocodifica los que faltan y añade los resultados al CSV (sin repetir códigos)
def main():
    centros = json.loads((RAIZ / "local/web_completa/data/centros.json").read_text(encoding="utf-8"))["centros"]
    previos = {}
    if SALIDA.exists():
        with open(SALIDA, encoding="utf-8") as f:
            previos = {r["CODIGO"]: r for r in csv.DictReader(f)}
    faltan = [c for c in centros if c.get("en_web", True) and c["lat"] is None and c["id"] not in previos]
    for c in faltan:
        mun = re.sub(r"^(.*), (\w{1,3})$", r"\2 \1", c["mun"])
        q = f"{c['dir']}, {c['cp']} {mun}"
        d = buscar(q)
        dudas = ""
        if d is None:
            print(f"NO ENCONTRADO {c['id']} {c['n']}: {q}")
            continue
        num = re.search(r"\b(\d+)\b", c["dir"])
        if d.get("type") != "portal" or (num and str(d.get("portalNumber")) != num.group(1)):
            dudas = (f"Coordenadas aproximadas (CartoCiudad: {d.get('type')} {d.get('address')} "
                     f"{d.get('portalNumber') or ''}, {d.get('muni')}); revisar en el mapa.")
        previos[c["id"]] = dict(CODIGO=c["id"], LAT=round(d["lat"], 6), LON=round(d["lng"], 6),
                                FUENTE="CartoCiudad", DUDAS=dudas)
        print(f"{c['id']} {c['n'][:40]:40} -> {d['lat']:.5f},{d['lng']:.5f} {'(aprox.)' if dudas else ''}")
        time.sleep(0.5)
    with open(SALIDA, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["CODIGO", "LAT", "LON", "FUENTE", "DUDAS"])
        w.writeheader()
        w.writerows(previos.values())
    print(f"OK -> {SALIDA.relative_to(RAIZ)} ({len(previos)} centros)")


if __name__ == "__main__":
    main()
