"""
Genera web/img/telegram_qr.svg con el QR del enlace del canal de Telegram.
Solo hace falta si cambia el enlace (TELEGRAM_URL en web/js/config.js).

Uso:
    # Genera el QR con el enlace indicado
    python scripts/generar_qr.py https://t.me/+fy5h9ckuRw42MjQ0
    #   primer argumento: enlace de invitación del canal/grupo

    # Genera el QR de otro enlace en otro fichero (SVG y, si hay ImageMagick, también PNG y JPG)
    python scripts/generar_qr.py https://huelgaeducativamadrid.org/ web/img/qr_huelgaeducativamadrid.svg
    #   primer argumento: enlace
    #   segundo argumento (opcional): fichero SVG de salida; el PNG y el JPG salen al lado con el mismo nombre

Necesita "segno" (pip install segno). Si no está, intenta usar OpenCV (cv2).
"""
import shutil
import subprocess
import sys
from pathlib import Path

SALIDA = Path(__file__).resolve().parent.parent / "web" / "img" / "telegram_qr.svg"


# Devuelve la matriz del QR (lista de filas de 0/1) usando segno o, si no está, OpenCV
def matriz_qr(texto):
    try:
        import segno
        qr = segno.make(texto, error="m", micro=False)
        return [[1 if v else 0 for v in fila] for fila in qr.matrix]
    except ImportError:
        import cv2
        img = cv2.QRCodeEncoder.create().encode(texto)  # 1 píxel por módulo, con un margen blanco variable
        m = [[1 if v < 128 else 0 for v in fila] for fila in img]
        filas = [i for i, f in enumerate(m) if any(f)]
        cols = [j for j in range(len(m[0])) if any(f[j] for f in m)]
        return [f[cols[0]:cols[-1] + 1] for f in m[filas[0]:filas[-1] + 1]]


# Convierte la matriz en un SVG compacto (un único path) con margen de 4 módulos
def a_svg(m, margen=4):
    n = len(m) + 2 * margen
    trazos = []
    for y, fila in enumerate(m):
        x = 0
        while x < len(fila):
            if fila[x]:
                ini = x
                while x < len(fila) and fila[x]:
                    x += 1
                trazos.append(f"M{ini + margen} {y + margen}h{x - ini}v1h-{x - ini}z")
            else:
                x += 1
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">'
            f'<rect width="{n}" height="{n}" fill="#fff"/><path fill="#000" d="{"".join(trazos)}"/></svg>')


# Programa principal
if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit("Uso: python scripts/generar_qr.py ENLACE [SALIDA.svg]")
    salida = Path(sys.argv[2]).resolve() if len(sys.argv) == 3 else SALIDA
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(a_svg(matriz_qr(sys.argv[1])), encoding="utf-8")
    print(f"OK -> {salida}")
    # Con un fichero de salida propio, saca también PNG y JPG con ImageMagick: 45 px por módulo (unos 2000 px)
    # y sin suavizado, para que los bordes queden nítidos (el SVG mide 1 unidad por módulo; 96 ppp = 1 px)
    if len(sys.argv) == 3 and shutil.which("convert"):
        for ext in ("png", "jpg"):
            destino = salida.with_suffix("." + ext)
            subprocess.run(["convert", "+antialias", "-density", str(96 * 45), str(salida),
                            "-quality", "95", str(destino)], check=True)
            print(f"OK -> {destino}")
