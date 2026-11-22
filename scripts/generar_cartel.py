"""
Genera las piezas del cartel "Muévete para que todos voten" para montarlo después en Canva:

    web/img/cartel_fondo.svg / .jpg   fondo verde de la web (degradado de la cabecera de Inicio), tamaño A4/A3 vertical
    web/img/cartel_mapa.svg  / .png   mapa de puntos con la silueta de la Comunidad de Madrid, fondo TRANSPARENTE
    web/img/cartel_mapa.jpg           el mismo mapa sobre el fondo verde (el JPG no admite transparencia)

Colores de los puntos (los mismos que el mapa de Inicio de la web):
    rojo: centros por visitar (sin asamblea, en el reparto) · verde: con asamblea · blanco tenue: fuera del reparto

Datos: local/web_completa/data/centros.json (lo genera scripts/preparar_datos.py) y
       fuentes/silueta_comunidad_madrid.geojson (límite de la Comunidad de Madrid).
Los JPG/PNG se sacan con Chrome/Chromium sin ventana (headless) e ImageMagick ("convert"). Si no están, solo salen los SVG.

Uso:
    # Genera todas las piezas en web/img
    python scripts/generar_cartel.py
"""
import json
import math
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CENTROS = RAIZ / "local" / "web_completa" / "data" / "centros.json"
SILUETA = RAIZ / "fuentes" / "silueta_comunidad_madrid.geojson"
CONFIG_JS = RAIZ / "web" / "js" / "config.js"
SALIDA = RAIZ / "web" / "img"

# Tamaño del fondo: proporción A (A4 a 300 ppp; vale también para A3)
FONDO_ANCHO, FONDO_ALTO = 2480, 3508
# Ancho del mapa en píxeles (el alto sale de la forma de la Comunidad)
MAPA_ANCHO = 2400
MARGEN = 60

# Colores de la web (web/css/estilos.css)
VERDE_NOCHE, VERDE_MEDIO, VERDE_OSC, VERDE = "#0D3B22", "#145530", "#1A6B3C", "#3BAD62"
NARANJA, NARANJA_CLARO = "#F9B234", "#FABC5B"
PUNTO_CON, PUNTO_SIN = "#3ddc84", "#ff5a5f"


# Lee de web/js/config.js los tipos excluidos y el mínimo de docentes (para clasificar los puntos igual que la web)
def leer_config():
    texto = CONFIG_JS.read_text(encoding="utf-8")
    tipos = re.search(r"TIPOS_EXCLUIDOS_DEL_REPARTO:\s*\[(.*?)\]", texto, re.S).group(1)
    minimo = int(re.search(r"MIN_DOCENTES:\s*(\d+)", texto).group(1))
    sin_dato = re.search(r"SIN_DATO_CUENTA_COMO_SIN_ASAMBLEA:\s*(true|false)", texto).group(1) == "true"
    return {"tipos": re.findall(r'"([^"]+)"', tipos), "min": minimo, "sin_dato": sin_dato}


# Clasifica un centro como en web/js/zonas.js: "con" (asamblea), "sin" (por visitar) o "fuera" (fuera del reparto)
def tipo_punto(c, cfg):
    if c.get("asam") is True:
        return "con"
    if c.get("asam") is None and not cfg["sin_dato"]:
        return "fuera"
    if c.get("t") in cfg["tipos"]:
        return "fuera"
    if c.get("prof") is not None and c["prof"] < cfg["min"]:
        return "fuera"
    return "sin"


# Devuelve una función que pasa (lon, lat) a píxeles (proyección sencilla corregida por la latitud, como la web)
def proyeccion(anillos):
    lons = [p[0] for a in anillos for p in a]
    lats = [p[1] for a in anillos for p in a]
    k = math.cos(math.radians(40.4))
    escala = (MAPA_ANCHO - 2 * MARGEN) / ((max(lons) - min(lons)) * k)
    alto = round((max(lats) - min(lats)) * escala) + 2 * MARGEN

    # Pasa una coordenada a píxeles del mapa
    def xy(lon, lat):
        return MARGEN + (lon - min(lons)) * k * escala, MARGEN + (max(lats) - lat) * escala

    return xy, alto


# Capa de degradados del fondo (la misma mezcla que la cabecera de Inicio: verde oscuro + brillos naranja y verde)
def defs_fondo(ancho, alto):
    return f"""<linearGradient id="g-fondo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{VERDE_NOCHE}"/><stop offset=".55" stop-color="{VERDE_MEDIO}"/><stop offset="1" stop-color="{VERDE_OSC}"/>
    </linearGradient>
    <radialGradient id="g-naranja" cx="{.88 * ancho}" cy="{.22 * alto}" r="{.55 * max(ancho, alto)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="{NARANJA}" stop-opacity=".22"/><stop offset="1" stop-color="{NARANJA}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g-verde" cx="{.05 * ancho}" cy="{1.05 * alto}" r="{.6 * max(ancho, alto)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="{VERDE}" stop-opacity=".38"/><stop offset="1" stop-color="{VERDE}" stop-opacity="0"/>
    </radialGradient>"""


# Rectángulos que pintan el fondo con los degradados anteriores
def capas_fondo():
    return ('<rect width="100%" height="100%" fill="url(#g-fondo)"/>'
            '<rect width="100%" height="100%" fill="url(#g-naranja)"/>'
            '<rect width="100%" height="100%" fill="url(#g-verde)"/>')


# SVG del fondo solo (sin textos: los textos se ponen en Canva)
def svg_fondo():
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{FONDO_ANCHO}" height="{FONDO_ALTO}" viewBox="0 0 {FONDO_ANCHO} {FONDO_ALTO}">
  <defs>{defs_fondo(FONDO_ANCHO, FONDO_ALTO)}</defs>
  {capas_fondo()}
</svg>
"""


# SVG del mapa: silueta con brillo, puntos tenues, verdes y rojos (los rojos encima y con halo)
def svg_mapa(centros, anillos, con_fondo):
    xy, alto = proyeccion(anillos)
    camino = " ".join("M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in (xy(*p) for p in a)) + " Z" for a in anillos)
    grupos = {"fuera": [], "con": [], "sin": []}
    for c in centros:
        x, y = xy(c["lon"], c["lat"])
        grupos[c["_tipo"]].append(f'<circle cx="{x:.1f}" cy="{y:.1f}"/>')
    fondo = capas_fondo() if con_fondo else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{MAPA_ANCHO}" height="{alto}" viewBox="0 0 {MAPA_ANCHO} {alto}">
  <defs>
    {defs_fondo(MAPA_ANCHO, alto)}
    <linearGradient id="g-silueta" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".16"/><stop offset="1" stop-color="{VERDE}" stop-opacity=".22"/>
    </linearGradient>
    <filter id="f-brillo" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="f-halo" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  {fondo}
  <!-- Silueta de la Comunidad de Madrid: brillo naranja difuminado, relleno translúcido y borde -->
  <path d="{camino}" fill="none" stroke="{NARANJA}" stroke-opacity=".55" stroke-width="22" stroke-linejoin="round" filter="url(#f-brillo)"/>
  <path d="{camino}" fill="url(#g-silueta)" stroke="{NARANJA_CLARO}" stroke-width="5" stroke-linejoin="round"/>
  <!-- Centros fuera del reparto (tenues) -->
  <g fill="#ffffff" fill-opacity=".28">{"".join(grupos["fuera"]).replace("<circle", '<circle r="5"')}</g>
  <!-- Centros con asamblea (verdes) -->
  <g fill="{PUNTO_CON}" stroke="#ffffff" stroke-opacity=".6" stroke-width="1.5">{"".join(grupos["con"]).replace("<circle", '<circle r="7.5"')}</g>
  <!-- Centros por visitar (rojos, con halo) -->
  <g fill="{PUNTO_SIN}" filter="url(#f-halo)">{"".join(grupos["sin"]).replace("<circle", '<circle r="8.5"')}</g>
</svg>
""", alto


# Pasa un SVG a PNG con Chrome/Chromium sin ventana (fondo transparente) y, si se pide, a JPG con ImageMagick
def rasterizar(svg, ancho, alto, png=None, jpg=None):
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    if not chrome:
        print("  (sin Chrome/Chromium: no se generan PNG/JPG)")
        return
    with tempfile.TemporaryDirectory() as tmp:
        tmp_png = Path(tmp) / "salida.png"
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--default-background-color=00000000", f"--window-size={ancho},{alto}",
                        f"--screenshot={tmp_png}", svg.as_uri()], check=True, capture_output=True)
        if png:
            shutil.copy(tmp_png, png)
            print("  ->", png.relative_to(RAIZ))
        if jpg:
            if not shutil.which("convert"):
                print("  (sin ImageMagick: no se genera el JPG)")
                return
            # Aplana sobre negro (no se nota: el SVG ya trae el fondo verde) y guarda en JPG de calidad alta
            subprocess.run(["convert", str(tmp_png), "-background", VERDE_NOCHE, "-flatten", "-quality", "92", str(jpg)], check=True)
            print("  ->", jpg.relative_to(RAIZ))


# Genera todas las piezas
def main():
    cfg = leer_config()
    centros = [c for c in json.loads(CENTROS.read_text(encoding="utf-8"))["centros"] if c.get("lat") is not None]
    for c in centros:
        c["_tipo"] = tipo_punto(c, cfg)
    geo = json.loads(SILUETA.read_text(encoding="utf-8"))["features"][0]["geometry"]
    poligonos = geo["coordinates"] if geo["type"] == "MultiPolygon" else [geo["coordinates"]]
    anillos = [p[0] for p in poligonos]  # solo el borde exterior de cada polígono

    print("Fondo:")
    (SALIDA / "cartel_fondo.svg").write_text(svg_fondo(), encoding="utf-8")
    print("  ->", (SALIDA / "cartel_fondo.svg").relative_to(RAIZ))
    rasterizar(SALIDA / "cartel_fondo.svg", FONDO_ANCHO, FONDO_ALTO, jpg=SALIDA / "cartel_fondo.jpg")

    print("Mapa:")
    texto, alto = svg_mapa(centros, anillos, con_fondo=False)
    (SALIDA / "cartel_mapa.svg").write_text(texto, encoding="utf-8")
    print("  ->", (SALIDA / "cartel_mapa.svg").relative_to(RAIZ))
    rasterizar(SALIDA / "cartel_mapa.svg", MAPA_ANCHO, alto, png=SALIDA / "cartel_mapa.png")
    with tempfile.TemporaryDirectory() as tmp:
        # El JPG del mapa lleva el fondo verde dentro (el JPG no admite transparencia)
        svg_tmp = Path(tmp) / "mapa_con_fondo.svg"
        svg_tmp.write_text(svg_mapa(centros, anillos, con_fondo=True)[0], encoding="utf-8")
        rasterizar(svg_tmp, MAPA_ANCHO, alto, jpg=SALIDA / "cartel_mapa.jpg")

    n = {t: sum(1 for c in centros if c["_tipo"] == t) for t in ("sin", "con", "fuera")}
    print(f"Puntos: {n['sin']} por visitar (rojos), {n['con']} con asamblea (verdes), {n['fuera']} fuera del reparto")


if __name__ == "__main__":
    main()
