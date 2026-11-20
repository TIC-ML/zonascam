// Configuración editable de la web. Es el ÚNICO fichero que normalmente hay que tocar.
window.CONFIG = {
  // Título que aparece en la cabecera
  TITULO: "Para todos los docentes de la pública",

  // URL de la aplicación web de Google Apps Script (ver doc/04_reservas.md).
  // Vacía = las reservas se desactivan y la web funciona solo como mapa y listado.
  URL_RESERVAS: "https://script.google.com/macros/s/AKfycbw4KfGFZ1X9PF4yX_mGvbm8LD1jFuMEsmpXHIy21nrhNaa4RcnXJ3_bAPOV6rDRmuDy7w/exec",

  // Enlace al canal de Telegram de coordinación. Si lo cambias, regenera el QR:
  //   python scripts/generar_qr.py NUEVO_ENLACE
  TELEGRAM_URL: "https://t.me/+fy5h9ckuRw42MjQ0",

  // Días de la campaña. Vacío = el calendario de reserva admite cualquier lunes a viernes desde hoy hasta 21 días.
  // Con fechas, solo esas (y entonces deben coincidir con FECHAS_VALIDAS de apps_script/Code.gs).
  // Formato: ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]
  FECHAS: [],

  // Fechas recomendadas para las visitas (desde/hasta, ambas incluidas). El calendario propone "desde" y, si se
  // elige un día fuera de este intervalo, se muestra AVISO_FECHA (avisa, pero deja reservar).
  FECHAS_RECOMENDADAS: { desde: "2026-11-23", hasta: "2026-11-26" },
  AVISO_FECHA: "Cuidado: estas fechas son posteriores a los resultados de la primera consulta (si no hay cambios, el 27).",

  // Nº de centros por zona por defecto (cada equipo visita una zona en una mañana)
  CENTROS_POR_ZONA: 5,

  // Si true, los centros "sin dato" de asamblea cuentan como "sin asamblea" al repartir zonas
  SIN_DATO_CUENTA_COMO_SIN_ASAMBLEA: true,

  // Tipos de centro (columna "Tipo") que NO entran en el reparto de zonas. En el mapa se pintan en blanco ("fuera del reparto").
  // EOEP: equipos de orientación; EEI, EEI-CN y ZNAS.CN.: escuelas infantiles y casas de niños;
  // A. HOSP. y CEPA.EP: aulas en hospitales y prisiones (no visitables)
  TIPOS_EXCLUIDOS_DEL_REPARTO: ["EOEP GENERAL", "EOEP ATEN-TEMPR", "EOEP ESPECÍFICO", "EEI", "EEI-CN", "ZNAS.CN.", "A. HOSP.", "CEPA.EP"],

  // Mínimo de docentes (plantilla orgánica) para que un centro entre en el reparto.
  // Si no se conoce el nº de docentes del centro, se supone que son más y entra.
  MIN_DOCENTES: 10,

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
