"""
Genera, a partir de /fuentes:
  - local/web_completa/data/centros.json -> todos los campos, legible (copia local, NO va al repositorio)
  - web/data/centros.bin                 -> solo los campos que muestra la web pública, comprimido y codificado
                                            con CLAVE_DATOS de web/js/config.js (no es un JSON legible)

Entradas (en /fuentes):
  - centros_educativos_Publicos_CAM.csv   -> listado oficial de centros (tabulado, UTM ETRS89 huso 30)
  - rh20_*_docentes_org_*.xlsx            -> plantilla orgánica por centro (nº de profesores)
  - centros_extra.csv                     -> centros públicos que no están en el CSV (añadidos a mano)
  - asambleas_cruzadas.csv  (opcional)    -> centros con asamblea ya cruzados con su CODIGO
                                             (lo genera scripts/cruzar_asambleas.py; solo cuenta VALIDADO=SI)

Uso:
    # Ejecuta el script desde la raíz del proyecto
    python scripts/preparar_datos.py
"""
import csv
import glob
import json
import math
import re
import sys
import zlib
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
FUENTES = RAIZ / "fuentes"
SALIDA = RAIZ / "local" / "web_completa" / "data" / "centros.json"
SALIDA_PUBLICA = RAIZ / "web" / "data" / "centros.bin"
CONFIG_JS = RAIZ / "web" / "js" / "config.js"
# Campos que necesita la web pública (mapa, zonas y PDF de cada zona); el resto solo vive en la copia local
CAMPOS_PUBLICOS = ["id", "n", "t", "dir", "cp", "mun", "dis", "tel", "mail", "web", "lat", "lon", "prof", "asam"]


# Comprime el texto y lo mezcla (XOR) con la clave: la web hace lo contrario en js/app.js (leerCentros)
def codificar(texto, clave):
    datos = zlib.compress(texto.encode("utf-8"), 9)
    k = clave.encode("utf-8")
    return bytes(b ^ k[i % len(k)] for i, b in enumerate(datos))


# Lee CLAVE_DATOS de web/js/config.js para usar la misma clave que la web
def leer_clave():
    m = re.search(r'CLAVE_DATOS:\s*"([^"]+)"', CONFIG_JS.read_text(encoding="utf-8"))
    if not m:
        sys.exit("Falta CLAVE_DATOS en web/js/config.js")
    return m.group(1)


# Convierte UTM (ETRS89/WGS84, huso 30 norte) a latitud/longitud en grados.
# Fórmulas estándar de Krüger (precisión < 1 m), sin depender de pyproj.
def utm_a_latlon(x, y, huso=30):
    a = 6378137.0
    f = 1 / 298.257222101
    k0 = 0.9996
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    x = x - 500000.0
    m = y / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    phi1 = (mu + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
            + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
            + (151 * e1**3 / 96) * math.sin(6 * mu)
            + (1097 * e1**4 / 512) * math.sin(8 * mu))
    n1 = a / math.sqrt(1 - e2 * math.sin(phi1) ** 2)
    t1 = math.tan(phi1) ** 2
    c1 = ep2 * math.cos(phi1) ** 2
    r1 = a * (1 - e2) / (1 - e2 * math.sin(phi1) ** 2) ** 1.5
    d = x / (n1 * k0)
    lat = phi1 - (n1 * math.tan(phi1) / r1) * (
        d**2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * ep2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * ep2 - 3 * c1**2) * d**6 / 720)
    lon0 = math.radians((huso - 1) * 6 - 180 + 3)
    lon = lon0 + (d - (1 + 2 * t1 + c1) * d**3 / 6
                  + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * ep2 + 24 * t1**2) * d**5 / 120) / math.cos(phi1)
    return round(math.degrees(lat), 6), round(math.degrees(lon), 6)


# Lee la plantilla orgánica: filas "CODIGO-NOMBRE (Municipio)" seguidas de filas "ESPECIALIDAD | nº plazas"
def leer_plantilla():
    ficheros = sorted(glob.glob(str(FUENTES / "rh20_*docentes*.xlsx")))
    if not ficheros:
        sys.exit("No encuentro fuentes/rh20_*docentes*.xlsx")
    df = pd.read_excel(ficheros[-1], header=None)
    total, actual = {}, None
    for a, b in zip(df[0], df[1]):
        a = "" if pd.isna(a) else str(a).strip()
        m = re.match(r"^(\d{8})-", a)
        if m:
            actual = m.group(1)
            total.setdefault(actual, 0)
        elif actual and pd.notna(b) and re.match(r"^\d{4}", a):
            total[actual] += int(b)
    print(f"Plantilla: {len(total)} centros, {sum(total.values())} plazas ({Path(ficheros[-1]).name})")
    return total


# Lee los códigos de centro con asamblea validada (si el fichero existe)
def leer_asambleas():
    p = FUENTES / "asambleas_cruzadas.csv"
    if not p.exists():
        print("AVISO: no existe fuentes/asambleas_cruzadas.csv -> asamblea = sin dato (null) en todos los centros")
        return None
    with open(p, encoding="utf-8") as f:
        filas = list(csv.DictReader(f))
    cods = {r["CODIGO"].strip() for r in filas if r.get("VALIDADO", "").strip().upper() == "SI" and r.get("CODIGO")}
    print(f"Asambleas validadas: {len(cods)}")
    return cods


# Construye la dirección legible a partir de tipo de vía, nombre y número
def direccion(r):
    partes = [str(r.get("CDTPVIA", "")).strip().capitalize(), str(r.get("DOMICILIO", "")).strip(), str(r.get("NMVIAL", "")).strip()]
    return " ".join(p for p in partes if p and p.lower() != "nan").strip()


# Programa principal: une fuentes y escribe el JSON compacto para la web
def main():
    profes = leer_plantilla()
    asambleas = leer_asambleas()
    c = pd.read_csv(FUENTES / "centros_educativos_Publicos_CAM.csv", sep="\t", dtype=str).fillna("")
    centros = []
    for _, r in c.iterrows():
        lat = lon = None
        try:
            lat, lon = utm_a_latlon(float(r["UTM_X"]), float(r["UTM_Y"]))
        except ValueError:
            pass
        dudas = []
        if r["CODIGO"] not in profes:
            dudas.append("Sin plantilla orgánica: nº de docentes desconocido.")
        if lat is None:
            dudas.append("Sin coordenadas.")
        centros.append(dict(
            id=r["CODIGO"], n=r["CENTRO"], t=r["TIPO_ABRV"], te=r["TIPO_EXT"],
            dir=direccion(r), cp=r["CDPOSTAL"], mun=r["MUNICIPIO"], dis=r["DISTRITO"], dat=r["DAT"],
            tel=r["TELEFONO"], web=r["WEB"], mail=r["E_MAIL"], lat=lat, lon=lon,
            prof=profes.get(r["CODIGO"]), origen="CSV CAM", tit="CAM", dudas=" ".join(dudas)))
    extra = FUENTES / "centros_extra.csv"
    if extra.exists():
        e = pd.read_csv(extra, dtype=str).fillna("")
        for _, r in e.iterrows():
            lat = float(r["LAT"]) if r["LAT"] else None
            lon = float(r["LON"]) if r["LON"] else None
            dudas = r["DUDAS"] + ("" if lat is not None else " Sin coordenadas: pendiente de geocodificar.")
            centros.append(dict(
                id=r["CODIGO"], n=r["CENTRO"], t=r["TIPO_ABRV"], te=r["TIPO_EXT"], dir=r["DOMICILIO"],
                cp=r["CDPOSTAL"], mun=r["MUNICIPIO"], dis=r["DISTRITO"], dat="", tel="", web="", mail="",
                lat=lat, lon=lon, prof=profes.get(r["CODIGO"]), origen="Añadido", tit=r["TITULARIDAD_REAL"],
                dudas=dudas.strip()))
    for x in centros:
        x["asam"] = None if asambleas is None else (x["id"] in asambleas)
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    meta = dict(generado=pd.Timestamp.now().strftime("%Y-%m-%d %H:%M"), total=len(centros),
                con_coordenadas=sum(1 for x in centros if x["lat"] is not None),
                asambleas_cargadas=asambleas is not None)
    SALIDA.write_text(json.dumps(dict(meta=meta, centros=centros), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK -> {SALIDA.relative_to(RAIZ)}  {meta}")
    # Versión pública: solo los campos necesarios y codificada
    publicos = [{k: x[k] for k in CAMPOS_PUBLICOS} for x in centros]
    meta_pub = dict(generado=meta["generado"], asambleas_cargadas=meta["asambleas_cargadas"])
    texto = json.dumps(dict(meta=meta_pub, centros=publicos), ensure_ascii=False, separators=(",", ":"))
    SALIDA_PUBLICA.write_bytes(codificar(texto, leer_clave()))
    print(f"OK -> {SALIDA_PUBLICA.relative_to(RAIZ)}  ({SALIDA_PUBLICA.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
