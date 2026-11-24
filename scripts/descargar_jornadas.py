"""
Descarga la ficha oficial de cada centro (gestiona.comunidad.madrid, "Buscador de colegios") y extrae su jornada:
"Jornada continuada" y/o "Jornada dividida en 2 sesiones" (partida). La ficha marca la opción activa con el
icono "...On.png"; si no marca ninguna, la jornada queda vacía (sin dato).

Entrada:  local/web_completa/data/centros.json (lista de códigos; ejecuta antes preparar_datos.py)
Salida:   fuentes/jornadas_centros_CAM_AAAA-MM-DD.csv  (CODIGO, JORNADA_CONTINUA, JORNADA_PARTIDA)
Caché:    local/fichas_html/<codigo>.html (no se vuelve a descargar lo que ya está)

Uso:
    # Ejecuta el script desde la raíz del proyecto
    python scripts/descargar_jornadas.py
"""
import csv
import datetime
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CACHE = RAIZ / "local" / "fichas_html"
URL = "https://gestiona.comunidad.madrid/wpad_pub/run/j/MostrarFichaCentro.icm?cdCentro="
SALIDA = RAIZ / "fuentes" / f"jornadas_centros_CAM_{datetime.date.today():%Y-%m-%d}.csv"
# Descargas simultáneas (pocas, para no saturar el servidor de la CAM)
HILOS = 6


# Descarga la ficha de un centro (con reintentos) y la guarda en la caché; devuelve el HTML
def ficha(cod):
    p = CACHE / f"{cod}.html"
    if p.exists() and p.stat().st_size > 10000:
        return p.read_text(encoding="utf-8")
    for intento in range(3):
        try:
            html = urllib.request.urlopen(URL + cod, timeout=40).read().decode("latin-1")
            p.write_text(html, encoding="utf-8")
            return html
        except Exception:
            time.sleep(2 + 3 * intento)
    return ""


# Lee de la ficha si la jornada continuada (C) y la partida (O) están marcadas ("On") o no
def jornada(html):
    def marcada(sufijo):
        m = re.search(r'fcOpcJorDiv(On|Off)\.png"\s*/?>\s*<input[^>]*id="CdTpJornada' + sufijo + '"', html)
        return None if not m else m.group(1) == "On"
    return marcada("C"), marcada("O")


# Programa principal: descarga todas las fichas y escribe el CSV de jornadas
def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    codigos = [c["id"] for c in json.loads((RAIZ / "local/web_completa/data/centros.json").read_text(encoding="utf-8"))["centros"]]
    with ThreadPoolExecutor(HILOS) as ex:
        htmls = list(ex.map(ficha, codigos))
    filas, sin_ficha = [], 0
    for cod, html in zip(codigos, htmls):
        if not html:
            sin_ficha += 1
        c, o = jornada(html) if html else (None, None)
        filas.append({"CODIGO": cod, "JORNADA_CONTINUA": "x" if c else "", "JORNADA_PARTIDA": "x" if o else ""})
    with open(SALIDA, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["CODIGO", "JORNADA_CONTINUA", "JORNADA_PARTIDA"])
        w.writeheader()
        w.writerows(filas)
    print(f"OK -> {SALIDA.relative_to(RAIZ)}: {len(filas)} centros, {sum(1 for f in filas if f['JORNADA_CONTINUA'])} continua, "
          f"{sum(1 for f in filas if f['JORNADA_PARTIDA'])} partida, {sin_ficha} sin ficha descargada")


if __name__ == "__main__":
    main()
