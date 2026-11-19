"""
Cruza el listado de asambleas extraído de menoslectivas.org con los centros oficiales.

Entrada:  fuentes/asambleas_menoslectivas.csv
          columnas mínimas: nombre  (opcionales: tipo, municipio, lat, lon, texto_original)
Salida:   fuentes/asambleas_cruzadas.csv
          una fila por centro de la web con CODIGO propuesto, puntuación, ESTADO y VALIDADO.
          - ESTADO=AUTO   -> coincidencia clara, VALIDADO=SI
          - ESTADO=REVISAR-> revisar a mano y poner VALIDADO=SI/NO (y corregir CODIGO si hace falta)

Uso:
    # Ejecuta el cruce desde la raíz del proyecto
    python scripts/cruzar_asambleas.py
"""
import csv
import difflib
import math
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from preparar_datos import utm_a_latlon, FUENTES  # noqa: E402

import pandas as pd

PALABRAS_TIPO = r"\b(CEIP|CEIPSO|CEIPS|IES|CP|CPEE|CEE|EEI|CEPA|IFP|CIFP|COLEGIO|PUBLICO|INSTITUTO|ESCUELA|INFANTIL|PRIMARIA|SECUNDARIA|EDUCACION|DE|DEL|LA|EL|LOS|LAS|Y)\b"


# Normaliza un nombre: sin tildes, mayúsculas, sin siglas de tipo ni signos
def norm(s):
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(PALABRAS_TIPO, " ", s)
    return re.sub(r"\s+", " ", s).strip()


# Distancia aproximada en metros entre dos puntos lat/lon
def dist_m(a, b, c, d):
    return math.hypot((a - c) * 110540, (b - d) * 111320 * math.cos(math.radians(a)))


# Programa principal: puntúa cada fila de la web contra todos los centros y elige el mejor
def main():
    entrada = FUENTES / "asambleas_menoslectivas.csv"
    web = pd.read_csv(entrada, dtype=str).fillna("")
    if web.empty:
        sys.exit("fuentes/asambleas_menoslectivas.csv está vacío: primero hay que extraer los datos de la web.")
    c = pd.read_csv(FUENTES / "centros_educativos_Publicos_CAM.csv", sep="\t", dtype=str).fillna("")
    cand = []
    for _, r in c.iterrows():
        try:
            lat, lon = utm_a_latlon(float(r["UTM_X"]), float(r["UTM_Y"]))
        except ValueError:
            lat = lon = None
        cand.append(dict(cod=r["CODIGO"], nom=r["CENTRO"], n=norm(r["CENTRO"]), mun=norm(r["MUNICIPIO"]), lat=lat, lon=lon))
    salida = []
    for _, w in web.iterrows():
        nw, mw = norm(w.get("nombre", "")), norm(w.get("municipio", ""))
        lw = float(w["lat"]) if w.get("lat") else None
        ow = float(w["lon"]) if w.get("lon") else None
        mejor = None
        for x in cand:
            s = difflib.SequenceMatcher(None, nw, x["n"]).ratio()
            if mw and x["mun"] and (mw in x["mun"] or x["mun"] in mw):
                s += 0.15
            if lw is not None and x["lat"] is not None:
                d = dist_m(lw, ow, x["lat"], x["lon"])
                s += 0.3 if d < 150 else 0.15 if d < 500 else -0.2 if d > 3000 else 0
            if mejor is None or s > mejor[0]:
                mejor = (s, x)
        s, x = mejor
        estado = "AUTO" if s >= 1.0 else "REVISAR"
        salida.append(dict(nombre_web=w.get("nombre", ""), municipio_web=w.get("municipio", ""), tipo_web=w.get("tipo", ""),
                           CODIGO=x["cod"], centro_cam=x["nom"], puntuacion=round(s, 2), ESTADO=estado,
                           VALIDADO="SI" if estado == "AUTO" else ""))
    out = FUENTES / "asambleas_cruzadas.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=list(salida[0].keys()))
        wr.writeheader()
        wr.writerows(salida)
    n_auto = sum(1 for r in salida if r["ESTADO"] == "AUTO")
    print(f"OK -> {out.name}: {len(salida)} filas, {n_auto} AUTO, {len(salida) - n_auto} REVISAR")


if __name__ == "__main__":
    main()
