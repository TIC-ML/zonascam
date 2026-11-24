"""
Genera, a partir de /fuentes:
  - local/web_completa/data/centros.json -> todos los campos, legible (copia local, NO va al repositorio)
  - web/data/centros.bin                 -> solo los campos que usa la web pública, comprimido y codificado
                                            con CLAVE_DATOS de web/js/config.js (no es un JSON legible)

Entradas (en /fuentes):
  - tabla_centros+ml_def_EDU.ods          -> LISTADO DE REFERENCIA: qué centros hay, tipo, DAT y asamblea (columna ML).
                                             Se ignoran las universidades.
  - centros_educativos_Publicos_CAM.csv   -> listado oficial de centros públicos: dirección, contacto y coordenadas (UTM)
  - centros_extra.csv                     -> centros añadidos a mano (dirección y coordenadas)
  - centros_educativos_total.csv          -> directorio completo de la CAM (todas las titularidades): situación
                                             (ALTA/BAJA...), titularidad, dirección, contacto y coordenadas (UTM).
                                             Los centros que aquí estén de BAJA se quitan.
  - fichas_centros_CAM_*.csv              -> fichas oficiales (gestiona.comunidad.madrid): titular, dirección y contacto
  - coordenadas_geocodificadas.csv        -> (opcional) coordenadas de los centros que no las traen de otra fuente
  - asambleas_en_duda.csv                 -> centros cuya asamblea está "En_duda" (asam = null, cuentan como sin asamblea)
  - rh20_*_docentes_org_*.xlsx            -> plantilla orgánica por centro (nº de profesores)
  - asambleas_cruzadas.csv  (opcional)    -> cruce anterior con menoslectivas.org (solo informativo: columna asam_cruce)
  - jornadas_centros_CAM_*.csv            -> jornada continua / partida de la ficha oficial (scripts/descargar_jornadas.py)
  - horarios_centros.csv                  -> horario matutino / vespertino / nocturno consultado a mano (editable)

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
LISTADO_ML = FUENTES / "tabla_centros+ml_def_EDU.ods"
# Campos que necesita la web pública (mapa, zonas, PDF de cada zona y titular para el reparto); el resto solo en local
CAMPOS_PUBLICOS = ["id", "n", "t", "te", "dir", "cp", "mun", "dis", "tel", "mail", "web", "lat", "lon", "prof", "asam", "tit",
                   "hm", "hv", "hn"]
# Tipos que no van a la web pública (sí a la copia local y al Excel): escuelas infantiles y casas de niños, escuelas
# municipales de música/danza y de adultos, CREACIM y CREI
TIPOS_SOLO_LOCAL = {"CREACIM", "CREI", "E MUN. MUS-DANZA", "E MUN.MUSICA", "E.M.EPA", "EEI", "EEI-CN", "ZNAS.CN."}
# Titulares que sí van a la web pública: la CAM y los centros de Defensa cuya gestión está cedida a la CAM
TITULARES_PUBLICOS = {"CAM", "Defensa (cedido a CAM)"}
# Códigos que no son centros (se quedan en el Excel pero no en la web)
NO_SON_CENTROS = {"28000000": "Código genérico (MADRID DIGITAL), no es un centro.",
                  "28800010": "Registro genérico de centros docentes en el extranjero."}
# Tipos que no van a la web (solo al Excel)
TIPOS_SOLO_EXCEL = {"EST ADMI"}
# Titulares que no van a la web (solo al Excel): Defensa (salvo los cedidos a la CAM), ministerios, universidades
TITULARES_SOLO_EXCEL = {"Defensa", "Ministerio de Educación", "UAM"}
# Situaciones del directorio completo que no van a la web (solo al Excel); las de BAJA se quitan del todo
SITUACIONES_SOLO_EXCEL = {"EN TRÁMITE"}
# Área territorial del listado ML -> nombre de la DAT como en el CSV oficial
DATS = {"Capital": "Madrid-Capital", "Sur": "Madrid-Sur", "Este": "Madrid-Este", "Norte": "Madrid-Norte", "Oeste": "Madrid-Oeste"}



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


# Construye la dirección legible a partir de tipo de vía, nombre y número
def direccion(r):
    partes = [str(r.get("CDTPVIA", "")).strip().capitalize(), str(r.get("DOMICILIO", "")).strip(), str(r.get("NMVIAL", "")).strip()]
    return " ".join(p for p in partes if p and p.lower() != "nan").strip()


# Texto limpio: quita nulos, "nan" y guiones sueltos
def txt(v):
    v = "" if v is None or (isinstance(v, float) and math.isnan(v)) else str(v).strip()
    return "" if v.lower() in ("nan", "-") else v


# Lee el listado de referencia (ML): un registro por centro, sin universidades
def leer_listado_ml():
    v = pd.read_excel(LISTADO_ML, engine="odf", dtype=str).fillna("")
    v = v[~v["TIPO DE CENTRO"].str.upper().str.contains("UNIV")]
    v["CODIGO CENTRO"] = v["CODIGO CENTRO"].str.strip()
    print(f"Listado ML: {len(v)} centros (sin universidades), {(v['ML'].str.upper().str.strip().isin(['SI', 'SÍ'])).sum()} con asamblea")
    return {r["CODIGO CENTRO"]: r for _, r in v.iterrows()}


# Lee la ficha oficial más reciente de cada centro (titular, dirección, teléfono, correo)
def leer_fichas():
    ficheros = sorted(glob.glob(str(FUENTES / "fichas_centros_CAM_*.csv")))
    if not ficheros:
        sys.exit("No encuentro fuentes/fichas_centros_CAM_*.csv")
    f = pd.read_csv(ficheros[-1], dtype=str).fillna("")
    print(f"Fichas oficiales: {len(f)} ({Path(ficheros[-1]).name})")
    return {r["codigo"]: r.to_dict() for _, r in f.iterrows()}


# Lee una lista de códigos de un CSV de /fuentes (devuelve {codigo: fila}); vacío si no existe
def leer_codigos(nombre, col="CODIGO", filtro=None):
    p = FUENTES / nombre
    if not p.exists():
        return {}
    with open(p, encoding="utf-8") as fh:
        filas = [r for r in csv.DictReader(fh) if r.get(col) and (filtro is None or filtro(r))]
    return {r[col].strip(): r for r in filas}


# Pasa "Rozas de Madrid, Las" a "Las Rozas de Madrid"
def municipio_natural(m):
    p = m.rsplit(", ", 1)
    return f"{p[1]} {p[0]}" if len(p) == 2 and len(p[1]) <= 3 else m


# Etiqueta corta del titular a partir de la ficha oficial
def etiqueta_titular(titular, mun, cedido):
    t = titular.upper()
    if t.startswith("COMUN") or not t:
        return "CAM"
    if t.startswith("AYUNTAMIENTO"):
        return "Ayto. " + municipio_natural(mun)
    if "PATRONATO" in t:
        return "Patronato municipal"
    if "DEFENSA" in t:
        return "Defensa (cedido a CAM)" if cedido else "Defensa"
    if "EDUCACION" in t or "EDUCACIÓN" in t:
        return "Ministerio de Educación"
    if "UNIVERSIDAD AUTONOMA" in t:
        return "UAM"
    return titular.title()


# Separa la dirección de la ficha ("calle x 10, 28016, Madrid (Chamartín)") en dirección y código postal
def direccion_ficha(d):
    m = re.match(r"^(.*?)[,\s]*\b(28\d{3})\b", d)
    if not m:
        return d[:1].upper() + d[1:], ""
    s = m.group(1).strip(" ,")
    return s[:1].upper() + s[1:], m.group(2)


# Programa principal: une fuentes y escribe el JSON completo (local) y el codificado (web pública)
def main():
    profes = leer_plantilla()
    ml = leer_listado_ml()
    fichas = leer_fichas()
    en_duda = leer_codigos("asambleas_en_duda.csv")
    cruce = leer_codigos("asambleas_cruzadas.csv", filtro=lambda r: r.get("VALIDADO", "").strip().upper() == "SI")
    geo = leer_codigos("coordenadas_geocodificadas.csv")
    horarios = leer_codigos("horarios_centros.csv")
    fj = sorted(glob.glob(str(FUENTES / "jornadas_centros_CAM_*.csv")))
    jornadas = leer_codigos(Path(fj[-1]).name) if fj else {}
    cam = {r["CODIGO"]: r for _, r in pd.read_csv(FUENTES / "centros_educativos_Publicos_CAM.csv", sep="\t", dtype=str).fillna("").iterrows()}
    extra = {r["CODIGO"]: r for _, r in pd.read_csv(FUENTES / "centros_extra.csv", dtype=str).fillna("").iterrows()} \
        if (FUENTES / "centros_extra.csv").exists() else {}
    total = {r["CODIGO"]: r for _, r in pd.read_csv(FUENTES / "centros_educativos_total.csv", sep=";", dtype=str,
                                                    encoding="utf-8-sig").fillna("").iterrows()}
    codigos = list(dict.fromkeys(list(cam) + list(extra) + list(ml)))
    centros, bajas = [], []
    for cod in codigos:
        a, e, m, f, d = cam.get(cod), extra.get(cod), ml.get(cod), fichas.get(cod, {}), total.get(cod)
        situacion = d["SITUACIÓN"].strip() if d is not None else ""
        # Los centros de BAJA en el directorio completo se quitan
        if situacion == "BAJA":
            bajas.append(f"{cod} {a['CENTRO'] if a is not None else ''}")
            continue
        dudas, notas = [], []
        if d is None:
            notas.append("No aparece en el directorio completo (centros_educativos_total.csv): posiblemente es más reciente.")
        elif situacion != "ALTA":
            notas.append(f"Situación en el directorio completo: {situacion}.")
        if d is not None and d["TITULARIDAD"] != "PÚBLICO":
            dudas.append(f"El directorio completo dice titularidad {d['TITULARIDAD']} (titular {d['TITULAR']}); la ficha oficial dice pública.")
        # Datos básicos: el CSV oficial manda en nombre y contacto; el listado ML en tipo, DAT y asamblea
        if a is not None:
            n, t, te, dr, cp, mun, dis = a["CENTRO"], a["TIPO_ABRV"], a["TIPO_EXT"], direccion(a), a["CDPOSTAL"], a["MUNICIPIO"], a["DISTRITO"]
            dat, tel, web, mail, origen = a["DAT"], a["TELEFONO"], a["WEB"], a["E_MAIL"], "CSV CAM"
        elif e is not None:
            n, t, te, dr, cp, mun, dis = e["CENTRO"], e["TIPO_ABRV"], e["TIPO_EXT"], e["DOMICILIO"], e["CDPOSTAL"], e["MUNICIPIO"], e["DISTRITO"]
            dat, tel, web, mail, origen = "", "", "", "", "Añadido"
            if e["DUDAS"]:
                dudas.append(e["DUDAS"])
        elif d is not None:
            # Centro nuevo del listado ML que sí está en el directorio completo: nombre del ML, el resto del directorio
            n, t, te = m["CENTRO"].replace("Nş", "Nº").strip(), d["TIPO_ABRV"], d["TIPO_EXT"]
            dr, cp, mun, dis = direccion(d), d["CDPOSTAL"], d["MUNICIPIO"], d["DISTRITO"]
            dat, tel, web, mail, origen = d["DAT"], d["TELEFONO"], d["WEB"], d["E_MAIL"], "Listado ML"
        else:
            # Centro nuevo que solo está en el listado ML: dirección y contacto de su ficha oficial
            dr, cp = direccion_ficha(txt(f.get("direccion")))
            n, t, te = m["CENTRO"].replace("Nş", "Nº").strip(), m["TIPO DE CENTRO"].strip(), txt(f.get("tipo_ficha"))
            mun, dis, dat = txt(m["MUNICIPIO"]), txt(m["DISTRITO"]), ""
            tel = re.split(r"\s*/\s*", txt(f.get("telefono")))[0]
            mail = txt(f.get("correo"))
            web = "https://www.educa.madrid.org/" + mail.split("@")[0] if mail.endswith("@educa.madrid.org") else ""
            origen = "Listado ML"
        if m is not None:
            t_ml = m["TIPO DE CENTRO"].strip()
            if t_ml and t_ml != t:
                notas.append(f"Tipo actualizado según el listado ML (antes {t}).")
                t, te = t_ml, txt(f.get("tipo_ficha")) or te
            dat = DATS.get(m["AREA TERRITORIAL"].strip(), dat)
        elif situacion == "ALTA":
            notas.append("No aparece en el listado ML, pero el directorio completo lo da de ALTA.")
        else:
            notas.append("En_duda si sigue en activo: no aparece en el listado ML (tabla_centros+ml_def_EDU.ods).")
        # Coordenadas: CSV oficial (UTM), añadidos a mano, directorio completo (UTM) o geocodificadas
        lat = lon = None
        if a is not None:
            try:
                lat, lon = utm_a_latlon(float(a["UTM_X"]), float(a["UTM_Y"]))
            except ValueError:
                pass
        elif e is not None and e["LAT"]:
            lat, lon = float(e["LAT"]), float(e["LON"])
        if lat is None and d is not None:
            try:
                lat, lon = utm_a_latlon(float(d["UTM_X"]), float(d["UTM_Y"]))
            except ValueError:
                pass
        if lat is None and cod in geo and geo[cod].get("LAT"):
            lat, lon = float(geo[cod]["LAT"]), float(geo[cod]["LON"])
            if geo[cod].get("DUDAS"):
                dudas.append(geo[cod]["DUDAS"])
        if lat is None:
            dudas.append("Sin coordenadas (pendiente de geocodificar).")
        # Titular (ficha oficial); los de Defensa que ya estaban en el listado de la CAM son de uso cedido
        tit_ficha = txt(f.get("titular")) or (d["TITULAR"] if d is not None else "")
        tit = etiqueta_titular(tit_ficha, mun, cedido=(a is not None or e is not None))
        if tit == "Defensa (cedido a CAM)":
            notas.append("Titular según la ficha oficial: Ministerio de Defensa; lo gestiona la CAM.")
        if not tit_ficha:
            notas.append("Sin ficha oficial ni titular en el directorio: titular supuesto CAM.")
        elif not f:
            notas.append("Sin ficha oficial: titular del directorio completo.")
        # Asamblea: el listado ML manda; los de asambleas_en_duda.csv quedan "En_duda" (null)
        if cod in en_duda:
            asam = None
            dudas.append("Asamblea En_duda: " + en_duda[cod].get("MOTIVO", ""))
        else:
            asam = m is not None and m["ML"].strip().upper() in ("SI", "SÍ")
        if profes.get(cod) is None:
            dudas.append("Sin plantilla orgánica de la CAM: nº de docentes desconocido." +
                         (" Centro municipal: su profesorado no es de la Consejería." if tit.startswith(("Ayto", "Patronato")) else ""))
        web_pub = (cod not in NO_SON_CENTROS and t not in TIPOS_SOLO_EXCEL and tit not in TITULARES_SOLO_EXCEL
                   and situacion not in SITUACIONES_SOLO_EXCEL)
        if cod in NO_SON_CENTROS:
            notas.append(NO_SON_CENTROS[cod])
        # En la web pública solo los centros de titularidad CAM (o cedidos a la CAM) y sin los tipos de TIPOS_SOLO_LOCAL
        pub = web_pub and t not in TIPOS_SOLO_LOCAL and tit in TITULARES_PUBLICOS
        # Horario (consultado a mano) y jornada (ficha oficial): "x" si lo tiene, "" si no o sin dato
        h, j = horarios.get(cod, {}), jornadas.get(cod, {})
        marca = lambda fila, col: "x" if fila.get(col, "").strip().lower() == "x" else ""
        if h.get("DUDAS"):
            dudas.append("Horario: " + h["DUDAS"].strip())
        centros.append(dict(
            id=cod, n=n, t=t, te=te, dir=dr, cp=cp, mun=mun, dis=dis, dat=dat, tel=tel, web=web, mail=mail,
            lat=lat, lon=lon, prof=profes.get(cod), origen=origen, tit=tit, asam=asam,
            asam_cruce=cod in cruce, en_web=web_pub, pub=pub,
            hm=marca(h, "MATUTINO"), hv=marca(h, "VESPERTINO"), hn=marca(h, "NOCTURNO"), hfuente=h.get("FUENTE", "").strip(),
            jc=marca(j, "JORNADA_CONTINUA"), jp=marca(j, "JORNADA_PARTIDA"),
            dudas=" ".join(dudas), notas=" ".join(notas)))
    print(f"Quitados por estar de BAJA en el directorio completo: {len(bajas)}" + (" -> " + ", ".join(bajas) if bajas else ""))
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    web_c = [x for x in centros if x["en_web"]]
    meta = dict(generado=pd.Timestamp.now().strftime("%Y-%m-%d %H:%M"), total=len(web_c), total_excel=len(centros),
                total_publica=sum(1 for x in web_c if x["pub"]),
                con_coordenadas=sum(1 for x in web_c if x["lat"] is not None), asambleas_cargadas=True)
    SALIDA.write_text(json.dumps(dict(meta=meta, centros=centros), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK -> {SALIDA.relative_to(RAIZ)}  {meta}")
    # Versión pública: solo los centros de la web pública (pub), con los campos necesarios y codificada
    publicos = [{k: x[k] for k in CAMPOS_PUBLICOS} for x in web_c if x["pub"]]
    meta_pub = dict(generado=meta["generado"], asambleas_cargadas=True)
    texto = json.dumps(dict(meta=meta_pub, centros=publicos), ensure_ascii=False, separators=(",", ":"))
    SALIDA_PUBLICA.write_bytes(codificar(texto, leer_clave()))
    print(f"OK -> {SALIDA_PUBLICA.relative_to(RAIZ)}  ({len(publicos)} centros, {SALIDA_PUBLICA.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
