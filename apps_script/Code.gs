/**
 * Backend de reservas — "Para todos los docentes de la pública"
 * Google Apps Script vinculado a una Hoja de cálculo de Google (gratis).
 * Instalación paso a paso: doc/04_reservas.md
 *
 * Hoja "Reservas" (se crea sola): una fila por reserva.
 * Reglas:
 *   - Una zona solo se puede reservar UNA vez en toda la campaña (de cualquier día).
 *   - Un equipo solo puede tener UNA zona por día.
 *   - Solo días de lunes a jueves dentro de los próximos 21 días (o los de FECHAS_VALIDAS).
 *   - Hace falta el código de acceso de la campaña (CODIGO_CAMPANA) para reservar/cancelar.
 *   - Para cancelar hace falta la clave que puso el equipo (se guarda cifrada con SHA-256).
 * El listado público NO devuelve email, teléfono, Telegram ni clave (solo se ven en la Hoja).
 * Rendimiento: el listado se guarda 30 s en caché (CacheService) para aguantar picos de visitas;
 * cada reserva o cancelación borra la caché para que nadie vea datos viejos.
 */

// Código que se reparte por los grupos (NO lo pongas en el repositorio público, solo aquí)
const CODIGO_CAMPANA = 'cambia-este-codigo';
// Fechas permitidas (vacío = cualquier lunes-jueves de los próximos 21 días). Ej.: ['2026-11-23','2026-11-24']
const FECHAS_VALIDAS = [];
const HOJA = 'Reservas';
const CABECERA = ['creada', 'version', 'zona', 'dia', 'equipo', 'responsable', 'email', 'telefono', 'telegram', 'personas', 'coche', 'clave_sha256', 'estado'];
const CLAVE_CACHE = 'listado_reservas';
const SEGUNDOS_CACHE = 30;

// Devuelve la hoja de reservas, creándola con cabecera si no existe
function hoja_() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let h = libro.getSheetByName(HOJA);
  if (!h) {
    h = libro.insertSheet(HOJA);
    h.appendRow(CABECERA);
    h.setFrozenRows(1);
  }
  return h;
}

// Lee todas las reservas activas como objetos
function leer_() {
  const v = hoja_().getDataRange().getValues();
  const cab = v.shift();
  return v.map((fila, i) => {
    const o = { _fila: i + 2 };
    cab.forEach((c, j) => (o[c] = fila[j] instanceof Date ? Utilities.formatDate(fila[j], 'Europe/Madrid', 'yyyy-MM-dd') : String(fila[j])));
    return o;
  }).filter((o) => o.estado === 'activa');
}

// Respuesta JSON
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// SHA-256 en hexadecimal
function sha_(txt) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(txt), Utilities.Charset.UTF_8)
    .map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// Normaliza nombres de equipo para comparar (sin tildes, minúsculas, sin espacios extra)
function norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Comprueba que la fecha es válida para la campaña
function diaValido_(dia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  if (FECHAS_VALIDAS.length) return FECHAS_VALIDAS.indexOf(dia) >= 0;
  const d = new Date(dia + 'T12:00:00');
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dias = (d - hoy) / 86400000;
  return d.getDay() >= 1 && d.getDay() <= 4 && dias >= 0 && dias <= 21;
}

// GET ?accion=listar -> reservas públicas (sin datos de contacto ni clave), con caché de 30 s
function doGet(e) {
  const accion = (e && e.parameter && e.parameter.accion) || 'listar';
  if (accion !== 'listar') return json_({ ok: false, error: 'Acción no válida' });
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(CLAVE_CACHE);
  if (guardado) return ContentService.createTextOutput(guardado).setMimeType(ContentService.MimeType.JSON);
  const reservas = leer_().map((r) => ({
    version: r.version, zona: r.zona, dia: r.dia, equipo: r.equipo, responsable: r.responsable,
    personas: Number(r.personas), coche: r.coche, creada: r.creada,
  }));
  const texto = JSON.stringify({ ok: true, reservas: reservas });
  if (texto.length < 90000) cache.put(CLAVE_CACHE, texto, SEGUNDOS_CACHE);
  return ContentService.createTextOutput(texto).setMimeType(ContentService.MimeType.JSON);
}

// Borra la caché del listado (tras reservar o cancelar)
function limpiarCache_() {
  CacheService.getScriptCache().remove(CLAVE_CACHE);
}

// Recorta un dato de texto opcional
function contacto_(v, max) {
  return String(v || '').trim().slice(0, max);
}

// Prefija con apóstrofo para que Sheets guarde el texto tal cual (nunca como fórmula o número)
function txt_(v) {
  return v ? "'" + v : '';
}

// POST (cuerpo JSON en texto plano) -> {accion: 'reservar' | 'cancelar', ...}
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Datos no válidos' }); }
  if (String(d.codigo || '') !== CODIGO_CAMPANA) return json_({ ok: false, error: 'Código de acceso de la campaña incorrecto' });
  const cerrojo = LockService.getScriptLock();
  try {
    cerrojo.waitLock(15000);
  } catch (err) {
    return json_({ ok: false, error: 'Servidor ocupado, inténtalo de nuevo en unos segundos' });
  }
  try {
    let res;
    if (d.accion === 'reservar') res = reservar_(d);
    else if (d.accion === 'cancelar') res = cancelar_(d);
    else return json_({ ok: false, error: 'Acción no válida' });
    if (res.ok) limpiarCache_();
    return json_(res);
    return json_({ ok: false, error: 'Acción no válida' });
  } finally {
    cerrojo.releaseLock();
  }
}

// Valida y guarda una reserva
function reservar_(d) {
  const zona = String(d.zona || '').trim(), dia = String(d.dia || '').trim(), version = String(d.version || '').trim();
  const equipo = String(d.equipo || '').trim().slice(0, 60), responsable = String(d.responsable || '').trim().slice(0, 60);
  const personas = parseInt(d.personas, 10), coche = d.coche === 'Sí' ? 'Sí' : 'No';
  if (!/^Z\d{3,4}$/.test(zona)) return { ok: false, error: 'Zona no válida' };
  if (!version) return { ok: false, error: 'Falta la versión de zonas' };
  if (!diaValido_(dia)) return { ok: false, error: 'Día no válido (solo lunes a jueves de la campaña)' };
  if (!equipo || !responsable) return { ok: false, error: 'Faltan equipo o responsable' };
  if (/[<>]/.test(equipo + responsable)) return { ok: false, error: 'No uses los caracteres < o > en equipo ni responsable' };
  if (!(personas >= 1 && personas <= 50)) return { ok: false, error: 'Nº de personas no válido' };
  if (String(d.clave || '').length < 4) return { ok: false, error: 'La clave debe tener al menos 4 caracteres' };
  const email = contacto_(d.email, 80), telefono = contacto_(d.telefono, 20).replace(/[^0-9+ ]/g, ''), telegram = contacto_(d.telegram, 40);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'El correo no parece válido' };
  if (telegram && !/^@?[A-Za-z0-9_]{4,32}$/.test(telegram)) return { ok: false, error: 'El usuario de Telegram no parece válido (ej.: @nombre_usuario)' };
  const activas = leer_().filter((r) => r.version === version);
  const ocupada = activas.find((r) => r.zona === zona);
  if (ocupada) return { ok: false, error: 'Esa zona ya está reservada por "' + ocupada.equipo + '" (' + ocupada.dia + ')' };
  const mismoDia = activas.find((r) => r.dia === dia && norm_(r.equipo) === norm_(equipo));
  if (mismoDia) return { ok: false, error: 'Vuestro equipo ya tiene la zona ' + mismoDia.zona + ' ese día' };
  const tg = telegram ? '@' + telegram.replace(/^@/, '') : '';
  hoja_().appendRow([new Date(), version, zona, txt_(dia), txt_(equipo), txt_(responsable), txt_(email), txt_(telefono), txt_(tg), personas, coche, sha_(d.clave), 'activa']);
  return { ok: true };
}

// Cancela una reserva comprobando la clave del equipo
function cancelar_(d) {
  const r = leer_().find((x) => x.version === String(d.version) && x.zona === String(d.zona) && x.dia === String(d.dia) && norm_(x.equipo) === norm_(d.equipo));
  if (!r) return { ok: false, error: 'No encuentro esa reserva' };
  if (r.clave_sha256 !== sha_(d.clave)) return { ok: false, error: 'Clave incorrecta' };
  hoja_().getRange(r._fila, CABECERA.indexOf('estado') + 1).setValue('cancelada');
  return { ok: true };
}
