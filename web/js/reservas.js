// Cliente del backend de reservas (Google Apps Script). Ver apps_script/Code.gs y doc/04_reservas.md
// Incluye reintentos automáticos para aguantar picos (Apps Script admite 30 ejecuciones simultáneas).
window.Reservas = (function () {
  "use strict";

  const INTENTOS = 3;

  // Devuelve true si hay backend configurado
  function activo() {
    return !!(window.CONFIG && CONFIG.URL_RESERVAS);
  }

  // Espera unos milisegundos (con algo de azar para que no reintenten todos a la vez)
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * 600));

  // Error que merece reintento: red caída, respuesta no JSON (servidor saturado) o "servidor ocupado"
  function errorReintentable(msg) {
    const e = new Error(msg);
    e.reintentable = true;
    return e;
  }

  // Hace una petición y devuelve el JSON; marca como reintentables los fallos de red/saturación
  async function pedir(url, opciones) {
    let r;
    try {
      r = await fetch(url, opciones);
    } catch (e) {
      throw errorReintentable("Sin conexión con el servidor de reservas");
    }
    let j;
    try {
      j = await r.json();
    } catch (e) {
      throw errorReintentable("El servidor de reservas está saturado");
    }
    if (!j.ok && /ocupado/i.test(j.error || "")) throw errorReintentable(j.error);
    return j;
  }

  // Ejecuta fn hasta INTENTOS veces si el error es reintentable; fn recibe el nº de intento (0, 1, 2)
  async function conReintentos(fn) {
    for (let i = 0; ; i++) {
      try {
        return await fn(i);
      } catch (e) {
        if (!e.reintentable || i >= INTENTOS - 1) throw e;
        await esperar(1000 * (i + 1));
      }
    }
  }

  // Descarga todas las reservas públicas (sin datos de contacto ni claves)
  async function listar() {
    if (!activo()) return [];
    const j = await conReintentos(() => pedir(CONFIG.URL_RESERVAS + "?accion=listar&t=" + Date.now()));
    if (!j.ok) throw new Error(j.error || "Error al listar reservas");
    return j.reservas || [];
  }

  // Envía una acción (reservar/cancelar). Se usa text/plain para evitar la petición previa CORS.
  // Si un intento anterior llegó a guardarse pero no recibimos respuesta, el reintento dirá
  // "ya reservada por <nuestro equipo>" o "no encuentro esa reserva": se considera éxito.
  async function enviar(datos) {
    return conReintentos(async (intento) => {
      const j = await pedir(CONFIG.URL_RESERVAS, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(datos),
      });
      if (j.ok) return j;
      const yaHecho = intento > 0 && (
        (datos.accion === "reservar" && (j.error || "").includes('"' + datos.equipo + '"')) ||
        (datos.accion === "cancelar" && /no encuentro/i.test(j.error || "")));
      if (yaHecho) return { ok: true };
      throw new Error(j.error || "Error en la reserva");
    });
  }

  return {
    activo,
    listar,
    reservar: (d) => enviar(Object.assign({ accion: "reservar" }, d)),
    cancelar: (d) => enviar(Object.assign({ accion: "cancelar" }, d)),
  };
})();
