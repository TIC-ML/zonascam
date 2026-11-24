"""
Genera el Excel con toda la información de los centros en /resultados/centros_completo_AAAA-MM-DD.xlsx

Lee:
  - local/web_completa/data/centros.json   (lo genera scripts/preparar_datos.py)
  - local/web_completa/data/reparto.json   (lo genera scripts/generar_zonas.js: reparto, motivo y zona)
  - fuentes/centros_educativos_total.csv   (columnas del directorio que no usa la web: NIF, fax, UTM, situación...)
  - fuentes/rh20_*_docentes_org_*.xlsx     (detalle de la plantilla orgánica)

Hojas: Centros, Por_titular, Por_municipio, Madrid_por_distrito, Plantilla_detalle, Notas

Uso:
    # Primero los datos y el reparto; después el Excel
    python scripts/preparar_datos.py
    node scripts/generar_zonas.js
    python scripts/generar_excel.py
"""
import glob
import json
import re
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
FUENTES = RAIZ / "fuentes"
LOCAL = RAIZ / "local" / "web_completa" / "data"
RESULTADOS = RAIZ / "resultados"
# Columnas del CSV oficial que se conservan tal cual (no las usa la web)
COLS_CSV = ["TITULAR", "NIF_TITULAR", "NIF_CENTRO", "TELEFONO2", "TELEFONO3", "TELEFONO4", "FAX", "E_MAIL2", "UTM_X", "UTM_Y", "SITUACIÓN", "FECHA CONSTITUCIÓN"]


# Texto de la asamblea para el Excel
def txt_asamblea(a):
    return "Sí" if a is True else "No" if a is False else "En_duda"


# Lee la plantilla orgánica con su detalle por especialidad (una fila por especialidad y centro)
def plantilla_detalle():
    fichero = sorted(glob.glob(str(FUENTES / "rh20_*docentes*.xlsx")))[-1]
    df = pd.read_excel(fichero, header=None)
    filas, actual = [], None
    for a, b in zip(df[0], df[1]):
        a = "" if pd.isna(a) else str(a).strip()
        m = re.match(r"^(\d{8})-(.*)$", a)
        if m:
            actual = (m.group(1), m.group(2).strip())
        elif actual and pd.notna(b) and re.match(r"^\d{4}", a):
            filas.append(dict(CODIGO=actual[0], CENTRO_PLANT=actual[1], ESPECIALIDAD=a, PLAZAS=int(b)))
    return pd.DataFrame(filas), Path(fichero).name


# Resumen por una columna: nº de centros, docentes y centros con asamblea / en duda / en el reparto
def resumen(df, col):
    g = df.groupby(col, dropna=False)
    return pd.DataFrame({
        "NUM_CENTROS": g.size(),
        "NUM_PROFESORES": g["NUM_PROFESORES"].sum(min_count=1).fillna(0).astype(int),
        "CON_ASAMBLEA": g["ASAMBLEA"].apply(lambda s: (s == "Sí").sum()),
        "ASAMBLEA_EN_DUDA": g["ASAMBLEA"].apply(lambda s: (s == "En_duda").sum()),
        "EN_REPARTO": g["EN_REPARTO"].apply(lambda s: (s == "Sí").sum()),
    }).reset_index().sort_values("NUM_CENTROS", ascending=False)


# Programa principal: junta todo y escribe el Excel
def main():
    datos = json.loads((LOCAL / "centros.json").read_text(encoding="utf-8"))
    rep = json.loads((LOCAL / "reparto.json").read_text(encoding="utf-8"))
    csv_cam = pd.read_csv(FUENTES / "centros_educativos_total.csv", sep=";", dtype=str, encoding="utf-8-sig").fillna("")
    csv_cam = csv_cam.set_index("CODIGO")[COLS_CSV].rename(columns={"TITULAR": "TITULAR_DIRECTORIO"})
    filas = []
    for c in datos["centros"]:
        r = rep["reparto"].get(c["id"], {})
        filas.append({
            "CODIGO": c["id"], "CENTRO": c["n"], "TIPO_ABRV": c["t"], "TIPO_EXT": c["te"],
            "TITULAR": c["tit"], "TITULARIDAD": "PÚBLICO", "DAT": c["dat"],
            "DIRECCION": c["dir"], "CDPOSTAL": c["cp"], "MUNICIPIO": c["mun"], "DISTRITO": c["dis"],
            "TELEFONO": c["tel"], "WEB": c["web"], "E_MAIL": c["mail"], "LAT": c["lat"], "LON": c["lon"],
            "NUM_PROFESORES": c["prof"], "ASAMBLEA": txt_asamblea(c["asam"]),
            "ASAMBLEA_CRUCE_ANTERIOR": "Sí" if c.get("asam_cruce") else "No",
            "EN_REPARTO": "Sí" if r.get("reparto") else "No", "MOTIVO_EXCLUSION": r.get("motivo", ""),
            "ZONA": r.get("zona", ""), "SIN_HORARIO_MANANA": "Sí" if r.get("sin_manana") else "",
            "HORARIO_MATUTINO": c.get("hm", ""), "HORARIO_VESPERTINO": c.get("hv", ""), "HORARIO_NOCTURNO": c.get("hn", ""),
            "FUENTE_HORARIO": c.get("hfuente", ""), "JORNADA_CONTINUA": c.get("jc", ""), "JORNADA_PARTIDA": c.get("jp", ""),
            "EN_WEB": "Sí" if c.get("en_web", True) else "No", "EN_WEB_PUBLICA": "Sí" if c.get("pub") else "No", "ORIGEN": c["origen"],
            "DUDAS": c["dudas"], "NOTAS": c.get("notas", ""),
        })
    df = pd.DataFrame(filas).join(csv_cam, on="CODIGO")
    df = df.sort_values(["DAT", "MUNICIPIO", "CENTRO"])
    plant, nombre_plant = plantilla_detalle()
    madrid = df[df["MUNICIPIO"] == "Madrid"]
    notas = pd.DataFrame([
        ("Generado", datos["meta"]["generado"]),
        ("Centros", "Listado de referencia: fuentes/tabla_centros+ml_def_EDU.ods (sin universidades) + "
                    "los centros que ya teníamos y no están en él (columna NOTAS)."),
        ("Asamblea", "Columna ML del listado nuevo. 'En_duda': nuestro cruce con menoslectivas.org decía que sí y ML no "
                     "(fuentes/asambleas_en_duda.csv). ASAMBLEA_CRUCE_ANTERIOR: lo que decía nuestro cruce."),
        ("Titular", "Ficha oficial de cada centro (gestiona.comunidad.madrid), descargada el 23/11/2026. Todos son de "
                    "titularidad pública. 'Defensa (cedido a CAM)': titular Defensa, gestionado por la CAM. "
                    "TITULAR_DIRECTORIO y SITUACIÓN: fuentes/centros_educativos_total.csv (se quitan los de BAJA)."),
        ("Profesores", f"{nombre_plant}: plantilla orgánica (plazas estables, no el total real de docentes). "
                       "Los centros municipales no tienen plantilla de la CAM."),
        ("Reparto", f"Reglas de web/js/config.js. Zonas: versión {rep['version']} ({rep['porZona']} centros/zona), "
                    "calculada con scripts/generar_zonas.js."),
        ("Horario", "HORARIO_*: consultado a mano (fuentes/horarios_centros.csv, de momento solo conservatorios); vacío = sin dato, "
                    "se supone matutino. JORNADA_*: ficha oficial (fuentes/jornadas_centros_CAM_*.csv)."),
        ("Web pública", "EN_WEB_PUBLICA = No: titular distinto de la CAM, o escuelas infantiles, casas de niños, escuelas "
                        "municipales de música/danza/adultos, CREACIM y CREI (TIPOS_SOLO_LOCAL de preparar_datos.py)."),
        ("Contacto", "Teléfono, web y correo son los institucionales del centro (datos públicos)."),
    ], columns=["Tema", "Detalle"])
    RESULTADOS.mkdir(exist_ok=True)
    salida = RESULTADOS / f"centros_completo_{datos['meta']['generado'][:10]}.xlsx"
    with pd.ExcelWriter(salida, engine="openpyxl") as x:
        df.to_excel(x, sheet_name="Centros", index=False)
        resumen(df, "TITULAR").to_excel(x, sheet_name="Por_titular", index=False)
        resumen(df, "MUNICIPIO").to_excel(x, sheet_name="Por_municipio", index=False)
        resumen(madrid, "DISTRITO").to_excel(x, sheet_name="Madrid_por_distrito", index=False)
        plant.to_excel(x, sheet_name="Plantilla_detalle", index=False)
        notas.to_excel(x, sheet_name="Notas", index=False)
        # Filtros y primera fila fija en todas las hojas
        for h in x.sheets.values():
            h.auto_filter.ref = h.dimensions
            h.freeze_panes = "A2"
    print(f"OK -> {salida.relative_to(RAIZ)}  ({len(df)} centros)")


if __name__ == "__main__":
    main()
