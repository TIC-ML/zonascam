// Algoritmo de reparto en zonas por cortes rectos sucesivos (bisección recursiva).
// - Cada zona tiene exactamente N centros (si no cuadra, algunas tienen N-1).
// - En cada corte se elige la dirección y el punto de corte que dejan los centros más juntos.
// - Como cada zona vive en su propia "celda" delimitada por cortes rectos, las zonas NO se superponen.
// Funciona en el navegador y en Node (para pruebas): no depende de ninguna librería.
(function (raiz) {
  "use strict";

  // Nº de direcciones de corte que se prueban (cada 180/ANGULOS grados)
  const ANGULOS = 36;
  // Margen (m) alrededor de los centros al dibujar el polígono de la zona
  const MARGEN = 200;
  // Separación mínima (m) entre los dos lados de un corte: evita partir centros que comparten edificio
  const HUECO = 1;

  // Proyecta lat/lon a metros en un plano local (suficiente para la escala de la Comunidad de Madrid)
  function proyectar(lat, lon, lat0) {
    return [lon * 111320 * Math.cos((lat0 * Math.PI) / 180), lat * 110540];
  }

  // Distancia al cuadrado entre dos puntos proyectados
  function d2(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return dx * dx + dy * dy;
  }

  // Ordena los centros de una zona con "vecino más cercano" empezando por el más alejado del centro
  function ruta(puntos, centroide) {
    if (puntos.length <= 1) return puntos.map((_, i) => i);
    let ini = 0;
    puntos.forEach((p, i) => { if (d2(p, centroide) > d2(puntos[ini], centroide)) ini = i; });
    const orden = [ini], usado = new Set([ini]);
    while (orden.length < puntos.length) {
      const u = puntos[orden[orden.length - 1]];
      let best = -1, bd = Infinity;
      puntos.forEach((p, i) => { if (!usado.has(i) && d2(u, p) < bd) { bd = d2(u, p); best = i; } });
      orden.push(best); usado.add(best);
    }
    return orden;
  }

  // Envolvente convexa (cadena monótona) de puntos proyectados
  function envolvente(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  // Recorta un polígono convexo y se queda con la parte donde signo*(p·u - t) <= 0 (Sutherland-Hodgman)
  function recortar(poli, u, t, signo) {
    const f = (p) => signo * (p[0] * u[0] + p[1] * u[1] - t);
    const out = [];
    for (let i = 0; i < poli.length; i++) {
      const a = poli[i], b = poli[(i + 1) % poli.length], fa = f(a), fb = f(b);
      if (fa <= 0) out.push(a);
      if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
        const k = fa / (fa - fb);
        out.push([a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1])]);
      }
    }
    return out;
  }

  /**
   * Divide recursivamente los puntos idx en kg zonas, de las que rg tienen n-1 centros (el resto n).
   * celda: polígono convexo donde viven esos puntos. Añade a "salida" un {idx, celda} por zona.
   */
  function particionar(P, idx, kg, rg, n, celda, salida) {
    if (kg <= 1) { salida.push({ idx, celda }); return; }
    const m = idx.length;
    let mejor = null;
    // Primero solo cortes con hueco (no separan centros del mismo edificio); si no hay ninguno, cualquiera
    for (const hueco of [HUECO, -1]) {
      for (let a = 0; a < ANGULOS; a++) {
        const ang = (Math.PI * a) / ANGULOS, u = [Math.cos(ang), Math.sin(ang)];
        // Ordena los puntos según su proyección en la dirección u
        const orden = idx.map((i) => [P[i][0] * u[0] + P[i][1] * u[1], i]).sort((x, y) => x[0] - y[0]);
        // Sumas acumuladas para calcular la dispersión de cualquier tramo en tiempo constante
        const sx = [0], sy = [0], sq = [0];
        orden.forEach(([, i], j) => {
          sx.push(sx[j] + P[i][0]); sy.push(sy[j] + P[i][1]); sq.push(sq[j] + P[i][0] ** 2 + P[i][1] ** 2);
        });
        // Dispersión (suma de distancias al cuadrado al centroide) de los puntos [desde, hasta)
        const disp = (d, h) => { const c = h - d, X = sx[h] - sx[d], Y = sy[h] - sy[d]; return sq[h] - sq[d] - (X * X + Y * Y) / c; };
        // Prueba todos los repartos posibles de zonas (k1 a un lado, kg-k1 al otro)
        for (let k1 = 1; k1 < kg; k1++) {
          const k2 = kg - k1;
          for (let r1 = Math.max(0, rg - k2); r1 <= Math.min(rg, k1); r1++) {
            const m1 = k1 * n - r1;
            if (m1 <= 0 || m1 >= m || orden[m1][0] - orden[m1 - 1][0] < hueco) continue;
            const coste = disp(0, m1) + disp(m1, m);
            if (!mejor || coste < mejor.coste) {
              mejor = { coste, u, orden, m1, k1, r1, t: (orden[m1 - 1][0] + orden[m1][0]) / 2 };
            }
          }
        }
      }
      if (mejor) break;
    }
    const izq = mejor.orden.slice(0, mejor.m1).map((x) => x[1]);
    const der = mejor.orden.slice(mejor.m1).map((x) => x[1]);
    particionar(P, izq, mejor.k1, mejor.r1, n, recortar(celda, mejor.u, mejor.t, 1), salida);
    particionar(P, der, kg - mejor.k1, rg - mejor.r1, n, recortar(celda, mejor.u, mejor.t, -1), salida);
  }

  /**
   * Calcula las zonas.
   * centros: [{id, lat, lon, prof, mun, dis, ...}]  (solo los que hay que visitar)
   * opciones: {porZona, semilla, kmCoche}
   * Devuelve {version, generado, porZona, zonas:[{id, centros:[ids en orden de ruta], ...}]}
   */
  function calcularZonas(centros, opciones) {
    const o = Object.assign({ porZona: 5, semilla: 42, kmCoche: 6 }, opciones || {});
    // Orden estable por código para que el resultado sea reproducible
    const cs = centros.filter((c) => c.lat != null && c.lon != null).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!cs.length) return { version: "", zonas: [] };
    const lat0 = cs.reduce((s, c) => s + c.lat, 0) / cs.length;
    const P = cs.map((c) => proyectar(c.lat, c.lon, lat0));
    const n = Math.max(1, o.porZona);
    const k = Math.ceil(cs.length / n);
    const r = k * n - cs.length; // zonas que tendrán n-1 centros
    // Celda inicial: rectángulo que contiene todos los centros con 5 km de margen
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]), M = 5000;
    const x0 = Math.min(...xs) - M, x1 = Math.max(...xs) + M, y0 = Math.min(...ys) - M, y1 = Math.max(...ys) + M;
    const grupos = [];
    particionar(P, cs.map((_, i) => i), k, r, n, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], grupos);
    // Construye cada zona con sus estadísticas, ruta y polígono
    const inv = (x, y) => [y / 110540, x / (111320 * Math.cos((lat0 * Math.PI) / 180))];
    let zonas = grupos.map(({ idx, celda }) => {
      const pts = idx.map((i) => P[i]);
      const cen = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
      const orden = ruta(pts, cen).map((x) => idx[x]);
      let km = 0;
      for (let t = 1; t < orden.length; t++) km += Math.sqrt(d2(P[orden[t - 1]], P[orden[t]])) / 1000;
      // Polígono: envolvente de los centros ensanchada MARGEN metros y recortada a su celda (así no se solapa)
      const anillo = [];
      pts.forEach((p) => { for (let a = 0; a < 12; a++) anillo.push([p[0] + MARGEN * Math.cos(a * Math.PI / 6), p[1] + MARGEN * Math.sin(a * Math.PI / 6)]); });
      let poli = envolvente(anillo);
      // Recorta el polígono contra cada lado de la celda
      for (let i = 0; i < celda.length && poli.length; i++) {
        const a = celda[i], b = celda[(i + 1) % celda.length];
        const nrm = [b[1] - a[1], a[0] - b[0]]; // normal hacia fuera si la celda va en sentido antihorario
        const t = nrm[0] * a[0] + nrm[1] * a[1];
        const dentro = nrm[0] * cen[0] + nrm[1] * cen[1] - t <= 0 ? 1 : -1;
        poli = recortar(poli, nrm, t, dentro);
      }
      const ms = orden.map((i) => cs[i]);
      return {
        centros: ms.map((c) => c.id),
        n_centros: ms.length,
        profesores: ms.reduce((s, c) => s + (c.prof || 0), 0),
        municipios: [...new Set(ms.map((c) => c.mun))].join(", "),
        distritos: [...new Set(ms.map((c) => c.dis).filter(Boolean))].join(", "),
        km_ruta: Math.round(km * 10) / 10,
        coche: km > o.kmCoche,
        centro: inv(cen[0], cen[1]),
        poligono: poli.length >= 3 ? poli.map(([x, y]) => inv(x, y)) : null,
      };
    });
    // Identificadores por prioridad: Z001 = zona con más profesores
    zonas.sort((a, b) => b.profesores - a.profesores || a.centros[0].localeCompare(b.centros[0]));
    zonas = zonas.map((z, i) => Object.assign({ id: "Z" + String(i + 1).padStart(3, "0") }, z));
    // Huella de la versión: cambia si cambian los datos o N
    let h = 0;
    const firma = o.porZona + "|" + zonas.map((z) => z.centros.join(",")).join(";");
    for (let i = 0; i < firma.length; i++) h = (Math.imul(31, h) + firma.charCodeAt(i)) | 0;
    return {
      version: "N" + o.porZona + "-" + (h >>> 0).toString(36),
      generado: new Date().toISOString().slice(0, 16).replace("T", " "),
      porZona: o.porZona,
      zonas,
    };
  }

  // Motivo por el que un centro NO entra en el reparto de zonas ("" si entra), según web/js/config.js.
  // Entra si tiene coordenadas, no tiene asamblea, su tipo no está excluido y tiene al menos MIN_DOCENTES docentes
  // (si no se sabe cuántos docentes tiene, se supone que son más y entra).
  function motivoExclusion(c, cfg) {
    if (c.asam === true) return "Ya tiene asamblea";
    if (c.asam == null && !cfg.SIN_DATO_CUENTA_COMO_SIN_ASAMBLEA) return "Sin dato de asamblea";
    if ((cfg.TIPOS_EXCLUIDOS_DEL_REPARTO || []).includes(c.t)) return "Tipo de centro excluido: " + c.t;
    if (c.prof != null && c.prof < (cfg.MIN_DOCENTES || 0)) return "Menos de " + cfg.MIN_DOCENTES + " docentes";
    if (c.lat == null) return "Sin coordenadas (no se puede situar en el mapa)";
    return "";
  }

  // Decide si un centro entra en el reparto de zonas (no tiene motivo de exclusión)
  function entraEnReparto(c, cfg) {
    return !motivoExclusion(c, cfg);
  }

  // Enlace de Google Maps con la ruta a pie/coche/transporte entre los centros (el usuario elige el modo)
  function enlaceRuta(puntos) {
    return "https://www.google.com/maps/dir/" + puntos.map((p) => p.lat + "," + p.lon).join("/");
  }

  const api = { calcularZonas, enlaceRuta, entraEnReparto, motivoExclusion };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Zonas = api;
})(this);
