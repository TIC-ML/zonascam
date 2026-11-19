// Configuración editable de la web. Es el ÚNICO fichero que normalmente hay que tocar.
window.CONFIG = {
  // Título que aparece en la cabecera
  TITULO: "Para todos los docentes de la pública",

  // URL de la aplicación web de Google Apps Script (ver doc/04_reservas.md).
  // Vacía = las reservas se desactivan y la web funciona solo como mapa y listado.
  URL_RESERVAS: "",

  // Enlace al canal de Telegram de coordinación. Si lo cambias, regenera el QR:
  //   python scripts/generar_qr.py NUEVO_ENLACE
  TELEGRAM_URL: "https://t.me/+fy5h9ckuRw42MjQ0",

  // Días de la campaña. Vacío = se calcula solo: lunes a jueves de la semana que viene.
  // Formato: ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]
  FECHAS: [],

  // Nº de centros por zona por defecto (cada equipo visita una zona en una mañana)
  CENTROS_POR_ZONA: 5,

  // Si true, los centros "sin dato" de asamblea cuentan como "sin asamblea" al repartir zonas
  SIN_DATO_CUENTA_COMO_SIN_ASAMBLEA: true,

  // Tipos de centro (columna "Tipo") que NO entran en el reparto de zonas: aulas en hospitales y prisiones (no visitables).
  // En el mapa se pintan aparte ("no visitable") para que ningún punto rojo quede fuera de una zona.
  TIPOS_EXCLUIDOS_DEL_REPARTO: ["A. HOSP.", "CEPA.EP"],

  // Si true, el reparto solo incluye centros con profesores en la plantilla orgánica (deja fuera escuelas
  // infantiles, casas de niños, CET, UFIL, CTIF…, que tienen 0 profesores en plantilla)
  SOLO_CON_PROFESORES: false,

  // Recorrido en línea recta (km) a partir del cual una zona se marca como "mejor con coche"
  KM_PARA_COCHE: 6,

  // Semilla del algoritmo de zonas (misma semilla + mismos datos = mismas zonas)
  SEMILLA: 42,

  // Clave con la que se codifican los datos de centros (web/data/centros.bin). Si la cambias, vuelve a ejecutar
  //   python scripts/preparar_datos.py
  // No es seguridad real (la clave viaja con la web): solo evita que los datos sean un JSON legible.
  CLAVE_DATOS: "pTdlp-2026-mapa",

  // Colores de las zonas por nº de profesores (de menos a más)
  COLORES: ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"],
};
