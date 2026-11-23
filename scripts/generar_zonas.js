// Calcula el reparto de zonas con el MISMO código que la web (web/js/zonas.js y web/js/config.js).
//
// Escribe:
//   - local/web_completa/data/reparto.json -> para cada centro: si entra en el reparto, motivo y zona (lo usa el Excel)
//   - web/data/zonas.json                  -> SOLO con --publicar (zonas oficiales: invalida las reservas anteriores)
//
// Uso (desde la raíz del proyecto):
//   # Solo calcula el reparto y las zonas para el Excel, sin tocar las zonas publicadas
//   node scripts/generar_zonas.js
//   # Calcula y publica las zonas nuevas en web/data/zonas.json
//   node scripts/generar_zonas.js --publicar
//     --publicar: sobrescribe web/data/zonas.json (las reservas hechas con la versión anterior dejan de valer)
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.resolve(__dirname, "..");
const publicar = process.argv.includes("--publicar");

// Carga un fichero JS del navegador en un contexto con "window" y devuelve ese contexto
function cargarJs(ctx, fichero) {
  vm.runInContext(fs.readFileSync(path.join(RAIZ, fichero), "utf8"), ctx, { filename: fichero });
}

const ctx = vm.createContext({ window: {}, console });
ctx.window.window = ctx.window;
cargarJs(ctx, "web/js/config.js");
cargarJs(ctx, "web/js/zonas.js");
const CONFIG = ctx.window.CONFIG;
const Zonas = ctx.window.Zonas || ctx.Zonas;
if (!Zonas) throw new Error("No se ha podido cargar Zonas desde web/js/zonas.js");

// Centros de la copia local completa (los que no van a la web no entran en el reparto)
const datos = JSON.parse(fs.readFileSync(path.join(RAIZ, "local/web_completa/data/centros.json"), "utf8"));
const centros = datos.centros.filter((c) => c.en_web !== false);
const aVisitar = centros.filter((c) => Zonas.entraEnReparto(c, CONFIG));

// Calcula las zonas con los parámetros de config.js
const zonas = Zonas.calcularZonas(aVisitar, { porZona: CONFIG.CENTROS_POR_ZONA, semilla: CONFIG.SEMILLA, kmCoche: CONFIG.KM_PARA_COCHE });
const zonaDe = {};
zonas.zonas.forEach((z) => z.centros.forEach((id) => (zonaDe[id] = z.id)));

// Reparto por centro (también los que solo van al Excel, con su motivo)
const reparto = {};
datos.centros.forEach((c) => {
  const motivo = c.en_web === false ? "No está en la web (no es un centro visitable, titular no CAM/municipal o en trámite)" : Zonas.motivoExclusion(c, CONFIG);
  reparto[c.id] = { reparto: !motivo, motivo, zona: zonaDe[c.id] || "" };
});
fs.writeFileSync(path.join(RAIZ, "local/web_completa/data/reparto.json"),
  JSON.stringify({ version: zonas.version, generado: zonas.generado, porZona: zonas.porZona, reparto }));
console.log(`Reparto: ${aVisitar.length} centros en ${zonas.zonas.length} zonas (versión ${zonas.version})` +
  ` -> local/web_completa/data/reparto.json`);

if (publicar) {
  fs.writeFileSync(path.join(RAIZ, "web/data/zonas.json"), JSON.stringify(zonas));
  console.log("Publicadas -> web/data/zonas.json (las reservas de la versión anterior ya no valen)");
} else {
  console.log("web/data/zonas.json NO se ha tocado (usa --publicar para publicarlas)");
}
