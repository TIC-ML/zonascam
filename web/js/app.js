// Lógica principal de la web: carga datos, pinta mapa, zonas (con PDF por zona), reservas e información.
// La copia local completa (local/web_completa/) usa ESTE MISMO fichero: cambia las rutas con window.RUTAS_WEB
// y añade lo suyo (listado de centros, exportaciones, simulación) en su completa.js a través de window.App.
(function () {
  "use strict";

  // Rutas de los datos (la copia local las cambia definiendo window.RUTAS_WEB antes de cargar este fichero)
  const RUTAS = Object.assign({ centros: "data/centros.bin", zonas: "data/zonas.json", info: "info.md", material: "material.md", intro: "intro.md" }, window.RUTAS_WEB || {});
  // Funciones que la copia local registra para ejecutarse al arrancar y en cada repintado
  const GANCHOS = { alIniciar: [], alRefrescar: [] };

  const E = {
    centros: [],          // todos los centros (data/centros.bin, codificado)
    porId: {},            // índice id -> centro
    zonasPublicadas: null,// contenido de data/zonas.json (oficial, el que vale para reservar)
    zonas: null,          // zonas mostradas ahora (publicadas o simulación)
    simulacion: false,
    reservas: [],
    fechas: [],
  };
  const $ = (s) => document.querySelector(s);
  const NOMBRE_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  // ---------- Utilidades ----------

  // Enlace de Google Maps a un punto
  const gmaps = (c) => (c.lat != null ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}` : "");
  // Enlace de OpenStreetMap a un punto
  const osm = (c) => (c.lat != null ? `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=18/${c.lat}/${c.lon}` : "");
  // Texto del estado de asamblea
  const txtAsam = (a) => (a === true ? "Sí" : a === false ? "No" : "En duda");
  // Escapa texto para meterlo en HTML
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  // Formatea una fecha YYYY-MM-DD como "lunes 23/11"
  const fmtDia = (f) => { const d = new Date(f + "T12:00:00"); return `${NOMBRE_DIA[d.getDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`; };
  // Muestra u oculta el aviso superior
  const aviso = (html) => { const a = $("#aviso"); a.innerHTML = html || ""; a.classList.toggle("oculto", !html); };
  // Nombre del día de la semana de una fecha YYYY-MM-DD ("" si no hay fecha)
  const diaSemana = (f) => (f ? NOMBRE_DIA[new Date(f + "T12:00:00").getDay()] : "");
  // Días de la semana en los que se puede visitar (para los desplegables de filtro)
  const DIAS_CAMPANA = ["lunes", "martes", "miércoles", "jueves", "viernes"];
  // Convierte una fecha de JS en texto YYYY-MM-DD (hora local)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Fechas de la campaña: las de config o lunes-jueves de la semana que viene
  function calcularFechas() {
    if (CONFIG.FECHAS && CONFIG.FECHAS.length) return CONFIG.FECHAS.slice().sort();
    const hoy = new Date();
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() + (((8 - hoy.getDay()) % 7) || 7));
    return [0, 1, 2, 3].map((i) => {
      const d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      return iso(d);
    });
  }

  // ---------- Filtros (tablas y mapa) ----------

  // Pasa un texto a minúsculas y sin tildes para comparar
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // Filtro de texto: el valor contiene lo escrito (sin distinguir mayúsculas ni tildes)
  const filtroTexto = (buscado, valor) => !buscado || norm(valor).includes(norm(buscado).trim());
  // Filtro numérico que entiende ">300", "<5", ">=10", "<=2.5", "=150", "100-300" o un número exacto
  function filtroNumero(buscado, valor) {
    const t = String(buscado ?? "").replace(/,/g, ".").replace(/\s+/g, "");
    if (!t) return true;
    if (valor == null || valor === "") return false;
    const v = Number(valor);
    const rango = t.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (rango) return v >= +rango[1] && v <= +rango[2];
    const m = t.match(/^(<=|>=|<|>|=)?(\d+(?:\.\d+)?)$/);
    if (!m) return true; // mientras se escribe (p. ej. solo ">") no se filtra
    const n = +m[2];
    return { "<": v < n, ">": v > n, "<=": v <= n, ">=": v >= n }[m[1]] ?? v === n;
  }
  // Ayuda que se muestra en los filtros numéricos
  const AYUDA_NUMERO = "Escribe >300, <300, >=300, <=300, 100-300 o un número exacto";
  // Filtro de cabecera de Tabulator con calendario (input type=date); devuelve la fecha YYYY-MM-DD
  function editorFecha(cell, onRendered, success) {
    const i = document.createElement("input");
    i.type = "date"; i.style.width = "100%"; i.title = "Filtra por un día del calendario";
    i.addEventListener("change", () => success(i.value));
    return i;
  }
  // Máximo de valores distintos de una columna para ofrecer la lista con casillas (menos de 10)
  const MAX_OPCIONES_LISTA = 9;
  // Cierra cualquier lista de casillas abierta
  const cerrarListas = () => document.querySelectorAll(".panel-elegible").forEach((p) => p.remove());
  document.addEventListener("click", cerrarListas);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarListas(); });

  // Filtro de cabecera de Tabulator: caja para buscar por palabras + botón ▾ que, si la columna tiene menos de 10
  // valores distintos, abre una lista con casillas (marcar/quitar varios a la vez). El valor del filtro es
  // { texto, excluidos: [valores desmarcados] }. Con params.valores se fija la lista (p. ej. días de la semana).
  function editorElegible(cell, onRendered, success, cancel, params) {
    const columna = cell.getColumn(), campo = columna.getField(), tabla = columna.getTable();
    const caja = document.createElement("div");
    caja.className = "filtro-elegible";
    caja.innerHTML = `<input type="search" placeholder="buscar…"><button type="button" class="filtro-boton" title="Elegir de la lista">▾</button>`;
    const input = caja.querySelector("input"), boton = caja.querySelector("button");
    let excluidos = new Set(), espera = null;
    // Que los clics en el filtro no ordenen la columna ni cierren la lista
    ["click", "mousedown"].forEach((ev) => caja.addEventListener(ev, (e) => e.stopPropagation()));

    // Valores posibles de la columna con cuántas filas tiene cada uno (de todos los datos, no solo los filtrados)
    function opciones() {
      const n = new Map();
      tabla.getData().forEach((d) => { const v = String(d[campo] ?? ""); n.set(v, (n.get(v) || 0) + 1); });
      const lista = params && params.valores ? params.valores.slice() : [...n.keys()].sort((a, b) => a.localeCompare(b, "es"));
      return lista.map((v) => ({ v, n: n.get(v) || 0 }));
    }
    // Valor actual del filtro ("" si no filtra nada)
    const valor = () => (input.value || excluidos.size ? { texto: input.value, excluidos: [...excluidos] } : "");
    // Tabulator lee y escribe .value del elemento del filtro (al teclear y al quitar filtros): se le da uno propio
    Object.defineProperty(caja, "value", {
      get: valor,
      set: (v) => { if (!v) { input.value = ""; excluidos.clear(); marcarBoton(); } },
    });
    // Envía el filtro a Tabulator y actualiza el botón
    function aplicar() {
      success(valor());
      marcarBoton();
    }
    // Muestra el botón solo si hay pocas opciones; si hay valores quitados, indica cuántos quedan
    function marcarBoton() {
      const total = opciones().length;
      boton.hidden = total < 1 || total > MAX_OPCIONES_LISTA;
      boton.classList.toggle("activo", excluidos.size > 0);
      boton.textContent = excluidos.size ? `▾ ${total - excluidos.size}/${total}` : "▾";
    }
    // Abre la lista de casillas debajo del filtro
    function abrirLista() {
      cerrarListas();
      const panel = document.createElement("div");
      panel.className = "panel-elegible";
      const ops = opciones();
      panel.innerHTML = `<div class="pe-botones"><button type="button" data-todos="1">✔ Todos</button><button type="button" data-todos="0">✖ Ninguno</button></div>` +
        ops.map((o, i) => `<label><input type="checkbox" data-i="${i}" ${excluidos.has(o.v) ? "" : "checked"}> ${o.v === "" ? "<i>(vacío)</i>" : esc(o.v)} <small>${o.n}</small></label>`).join("");
      panel.addEventListener("click", (e) => e.stopPropagation());
      panel.addEventListener("change", (e) => {
        const o = ops[e.target.dataset.i];
        if (e.target.checked) excluidos.delete(o.v); else excluidos.add(o.v);
        aplicar();
      });
      panel.querySelectorAll("[data-todos]").forEach((b) => b.addEventListener("click", () => {
        const todos = b.dataset.todos === "1";
        excluidos = new Set(todos ? [] : ops.map((o) => o.v));
        panel.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = todos));
        aplicar();
      }));
      document.body.appendChild(panel);
      const r = caja.getBoundingClientRect();
      panel.style.top = `${r.bottom + 2}px`;
      panel.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    }

    input.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(aplicar, 250); });
    boton.addEventListener("click", () => (document.querySelector(".panel-elegible") ? cerrarListas() : abrirLista()));
    // Al cambiar los datos se recalcula si hay pocas opciones; si se quitan los filtros desde fuera, se vacía
    tabla.on("dataProcessed", marcarBoton);
    tabla.on("dataFiltered", () => {
      if (!columna.getHeaderFilterValue() && (input.value || excluidos.size)) { input.value = ""; excluidos.clear(); marcarBoton(); }
    });
    onRendered(marcarBoton);
    return caja;
  }
  // Comprueba una fila contra el filtro de editorElegible (palabras y valores desmarcados)
  const filtroElegible = (h, v) => filtroTexto(h.texto, v) && !(h.excluidos || []).includes(String(v ?? ""));
  const vacioElegible = (h) => !h || (!h.texto && !(h.excluidos || []).length);

  // Columnas de filtro comunes a todas las tablas
  const colTexto = (title, field, extra) => Object.assign({ title, field, minWidth: 110, headerFilter: editorElegible,
    headerFilterFunc: filtroElegible, headerFilterEmptyCheck: vacioElegible, formatter: (c) => esc(c.getValue()) }, extra);
  const colNumero = (title, field, ejemplo) => ({ title, field, minWidth: 95, sorter: "number", hozAlign: "right", headerFilter: "input",
    headerFilterPlaceholder: "ej.: " + (ejemplo || ">300"), headerFilterFunc: (h, v) => filtroNumero(h, v), headerTooltip: AYUDA_NUMERO });
  const colFecha = (title, field) => ({ title, field, minWidth: 150, sorter: "string", headerFilter: editorFecha,
    headerFilterFunc: (h, v) => v === h, formatter: (c) => (c.getValue() ? fmtDia(c.getValue()) : "") });
  const colDiaSemana = (title, field) => colTexto(title, field, { headerFilterParams: { valores: DIAS_CAMPANA } });

  // Centros que entran en el reparto (regla en Zonas.entraEnReparto, configurable en config.js)
  function centrosAVisitar() {
    return E.centros.filter((c) => Zonas.entraEnReparto(c, CONFIG));
  }
  // Nº de docentes para mostrar ("¿?" si no se conoce)
  const txtProf = (p) => (p == null ? "¿?" : p);

  // Reservas válidas para la versión de zonas publicada, indexadas por zona
  function reservasPorZona() {
    const v = E.zonasPublicadas && E.zonasPublicadas.version, m = {};
    E.reservas.filter((r) => r.version === v).forEach((r) => (m[r.zona] = r));
    return m;
  }

  // Cortes de color por quintiles de profesores de las zonas
  function cortes(zonas) {
    const v = zonas.map((z) => z.profesores).sort((a, b) => a - b);
    return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.floor(q * (v.length - 1))] || 0);
  }
  // Color de una zona según sus profesores
  function color(prof, cs) {
    let i = 0;
    while (i < cs.length && prof > cs[i]) i++;
    return CONFIG.COLORES[i];
  }

  // ---------- Pestañas ----------

  // Activa la pestaña indicada. Las tablas se redibujan del todo al mostrarse: si se crearon con la pestaña
  // oculta, no pudieron medir el ancho de sus columnas.
  function irA(tab) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("activa", b.dataset.tab === tab));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("activo", p.id === "tab-" + tab));
    if (tab === "mapa") setTimeout(() => { mapa.invalidateSize(); contarCentros(); }, 50);
    if (tab === "info") pintarInfo();
    if (tab === "material") pintarMaterial();
    if (tab === "inicio") pintarIntro();
    // La pestaña queda en la dirección (#mapa, #reservas…) para poder compartir el enlace
    history.replaceState(null, "", tab === "inicio" ? location.pathname + location.search : "#" + tab);
    document.querySelectorAll(`#tab-${tab} .tabulator`).forEach((el) => {
      (Tabulator.findTable(el) || []).forEach((tabla) => tabla.redraw(true));
    });
  }
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => irA(b.dataset.tab)));
  // Los enlaces a #mapa, #zonas, #reservas, #info… (p. ej. en intro.md) abren esa pestaña; #telegram abre el canal
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const destino = a.getAttribute("href").slice(1);
    if (destino === "telegram") { e.preventDefault(); $("#btn-telegram").click(); return; }
    if (destino && $("#tab-" + destino)) { e.preventDefault(); irA(destino); window.scrollTo(0, 0); }
  });
  // Si cambia el # de la dirección (enlace pegado, botón Atrás…), se abre esa pestaña
  window.addEventListener("hashchange", () => {
    const destino = location.hash.slice(1) || "inicio";
    if ($("#tab-" + destino) && !$("#tab-" + destino).classList.contains("activo")) irA(destino);
  });

  // ---------- Mapa ----------

  const mapa = L.map("mapa", { preferCanvas: true }).setView([40.42, -3.7], 10);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  const capas = { sin: L.layerGroup(), con: L.layerGroup(), nodato: L.layerGroup(), novis: L.layerGroup(), zonas: L.layerGroup() };
  const marcadores = {};

  // HTML del popup de un centro
  function popupCentro(c) {
    const z = zonaDeCentro(c.id);
    const etq = c.asam === true ? "si" : c.asam === false ? "no" : "nd";
    return `<div class="popup"><h3>${esc(c.t)} ${esc(c.n)}</h3>
      <p>${esc(c.dir)}${c.cp ? ", " + esc(c.cp) : ""} · ${esc(c.mun)}${c.dis ? " (" + esc(c.dis) + ")" : ""}</p>
      <p><b>${txtProf(c.prof)}</b> docentes (plantilla orgánica) · Asamblea: <span class="etq ${etq}">${txtAsam(c.asam)}</span></p>
      ${z ? `<p>Zona: <b>${z.id}</b></p>` : ""}
      <p><a href="${gmaps(c)}" target="_blank" rel="noopener">Google Maps</a> · <a href="${osm(c)}" target="_blank" rel="noopener">OpenStreetMap</a>
      ${c.web ? ` · <a href="${esc(c.web)}" target="_blank" rel="noopener">Web</a>` : ""}</p>
      ${c.dudas ? `<p class="ayuda">⚠️ ${esc(c.dudas)}</p>` : ""}
</div>`;
  }

  // Pinta los puntos de todos los centros
  function pintarCentros() {
    Object.values(capas).forEach((g) => g !== capas.zonas && g.clearLayers());
    E.centros.forEach((c) => {
      if (c.lat == null) return;
      // Los centros sin asamblea que no entran en el reparto (tipo excluido o pocos docentes) se pintan aparte
      const excluido = c.asam !== true && !Zonas.entraEnReparto(c, CONFIG);
      const tipo = excluido ? "novis" : c.asam === true ? "con" : c.asam === false ? "sin" : "nodato";
      const col = { con: "#1a9641", sin: "#d7191c", nodato: "#9e9e9e", novis: "#ffffff" }[tipo];
      const m = L.circleMarker([c.lat, c.lon], { radius: 5, color: "#333", weight: 1, fillColor: col, fillOpacity: 0.9 })
        .bindPopup(() => popupCentro(c));
      m.centro = c; // para sumar sus docentes en el contador del mapa
      m.addTo(capas[tipo]);
      marcadores[c.id] = m;
    });
  }

  // Busca la zona que contiene un centro
  function zonaDeCentro(id) {
    return E.zonas ? E.zonas.zonas.find((z) => z.centros.includes(id)) : null;
  }

  // HTML del popup de una zona
  function popupZona(z, res) {
    const cs = z.centros.map((id) => E.porId[id]);
    const r = res[z.id];
    return `<div class="popup"><h3>Zona ${z.id} · ${z.profesores} docentes</h3>
      <p>${z.n_centros} centros · ${esc(z.municipios)}${z.distritos ? " (" + esc(z.distritos) + ")" : ""}</p>
      <p>Recorrido aprox. ${z.km_ruta} km en línea recta${z.coche ? " · 🚗 mejor con coche" : ""}</p>
      <ol>${cs.map((c) => `<li>${esc(c.t)} ${esc(c.n)} (${txtProf(c.prof)}) – <a href="${gmaps(c)}" target="_blank" rel="noopener">mapa</a></li>`).join("")}</ol>
      <p><a href="${Zonas.enlaceRuta(cs)}" target="_blank" rel="noopener">🧭 Ruta en Google Maps</a> · <button onclick="window.__pdf('${z.id}')">📄 PDF de la zona</button></p>
      ${r ? `<p><span class="etq res">Reservada: ${esc(r.equipo)} · ${fmtDia(r.dia)}</span></p>`
          : E.simulacion ? `<p class="ayuda">Simulación: no se puede reservar.</p>`
          : `<p><button class="boton-reservar" onclick="window.__reservar('${z.id}')">📅 Reservar esta zona</button></p>`}</div>`;
  }

  // Datos de una zona para tablas y filtros (con su reserva, si la tiene)
  function datosZona(z, res) {
    const r = res[z.id];
    return {
      id: z.id, profesores: z.profesores, n_centros: z.n_centros, municipios: z.municipios, distritos: z.distritos,
      km_ruta: z.km_ruta, coche: z.coche ? "Sí" : "No",
      estado: r ? "Reservada" : "Libre", equipo: r ? r.equipo : "", responsable: r ? r.responsable : "",
      fecha: r ? r.dia : "", diaSemana: r ? diaSemana(r.dia) : "",
      centros: z.centros.map((id) => E.porId[id].n).join(" · "),
      ruta: Zonas.enlaceRuta(z.centros.map((id) => E.porId[id])),
    };
  }

  // Lee la barra de filtros del mapa y devuelve una función que dice si una zona (datosZona) pasa
  function filtroMapa() {
    const v = (id) => $(id).value;
    const f = { zona: v("#fm-zona"), centro: v("#fm-centro"), responsable: v("#fm-responsable"), dia: v("#fm-dia"),
      fecha: v("#fm-fecha"), docentes: v("#fm-docentes"), km: v("#fm-km") };
    return (d) => filtroTexto(f.zona, d.id) && filtroTexto(f.centro, d.centros) && filtroTexto(f.responsable, d.responsable) &&
      (!f.dia || d.diaSemana === f.dia) && (!f.fecha || d.fecha === f.fecha) &&
      filtroNumero(f.docentes, d.profesores) && filtroNumero(f.km, d.km_ruta);
  }

  // Pinta los polígonos de las zonas coloreados por nº de profesores (solo las que pasan los filtros del mapa)
  function pintarZonas() {
    capas.zonas.clearLayers();
    if (!E.zonas) return;
    const res = E.simulacion ? {} : reservasPorZona(), cs = cortes(E.zonas.zonas), ocultar = $("#ocultar-reservadas").checked;
    const pasa = filtroMapa();
    let visibles = 0;
    E.zonas.zonas.forEach((z) => {
      const r = res[z.id];
      if (ocultar && r) return;
      if (!pasa(datosZona(z, res))) return;
      visibles++;
      // Las zonas reservadas se pintan en gris; las libres, por nº de docentes
      const estilo = r ? { color: "#666", weight: 2, fillColor: "#9e9e9e", fillOpacity: 0.55 }
        : { color: "#555", weight: 1, fillColor: color(z.profesores, cs), fillOpacity: 0.45 };
      const capa = z.poligono ? L.polygon(z.poligono, estilo) : L.circle(z.centro, Object.assign({ radius: 300 }, estilo));
      capa.bindPopup(() => popupZona(z, res)).bindTooltip(`${z.id}${r ? " · reservada" : " · pulsa para reservar"}`, { sticky: true });
      capa.addTo(capas.zonas);
    });
    $("#leyenda").innerHTML = "Docentes/zona: " + CONFIG.COLORES.map((c, i) =>
      `<i style="background:${c}"></i>${i === 0 ? "≤" + cs[0] : i === 4 ? ">" + cs[3] : ""}`).join("") +
      ` <i style="background:#9e9e9e"></i>reservada`;
    $("#contador-mapa").textContent = `${visibles} de ${E.zonas.zonas.length} zonas`;
  }

  // Filtros del mapa: repintan las zonas al escribir; "Limpiar" los vacía; "Encuadrar" centra el mapa en lo que se ve
  document.querySelectorAll("#filtros-mapa input, #filtros-mapa select").forEach((e) => e.addEventListener("input", pintarZonas));
  $("#fm-limpiar").addEventListener("click", () => {
    document.querySelectorAll("#filtros-mapa input, #filtros-mapa select").forEach((e) => (e.value = ""));
    pintarZonas();
  });
  $("#fm-encuadrar").addEventListener("click", () => {
    const capasVisibles = capas.zonas.getLayers();
    if (capasVisibles.length) mapa.fitBounds(L.featureGroup(capasVisibles).getBounds().pad(0.2));
  });

  // Muestra u oculta capas según las casillas
  function sincronizarCapas() {
    [["#ver-sin", capas.sin], ["#ver-con", capas.con], ["#ver-nodato", capas.nodato], ["#ver-novis", capas.novis], ["#ver-zonas", capas.zonas]]
      .forEach(([sel, g]) => ($(sel).checked ? g.addTo(mapa) : g.remove()));
    capas.sin.eachLayer((l) => l.bringToFront && l.bringToFront());
    contarCentros();
  }

  // Cuenta los centros que se ven en el mapa (según las casillas marcadas) y cuántos caen en la vista actual
  function contarCentros() {
    const visibles = [["#ver-sin", capas.sin], ["#ver-con", capas.con], ["#ver-nodato", capas.nodato], ["#ver-novis", capas.novis]]
      .filter(([sel]) => $(sel).checked).flatMap(([, g]) => g.getLayers());
    const vista = mapa.getBounds();
    const enVista = visibles.filter((m) => vista.contains(m.getLatLng()));
    // Suma la plantilla orgánica de unos marcadores (los centros sin dato de plantilla no suman)
    const docentes = (ms) => ms.reduce((s, m) => s + (m.centro.prof || 0), 0).toLocaleString("es-ES");
    $("#contador-centros").innerHTML = `<span><b>${visibles.length.toLocaleString("es-ES")}</b> centros en el mapa · ` +
      `<b title="Plantilla orgánica de los centros marcados (solo plazas estables; los centros sin dato no suman)">≈ ${docentes(visibles)}</b> docentes</span>` +
      (enVista.length < visibles.length
        ? `<small>${enVista.length.toLocaleString("es-ES")} centros y ≈ ${docentes(enVista)} docentes en esta vista del mapa</small>` : "");
  }
  // Al mover o hacer zoom cambia cuántos centros caen en la vista
  mapa.on("moveend", () => contarCentros());
  ["#ver-sin", "#ver-con", "#ver-nodato", "#ver-novis", "#ver-zonas"].forEach((s) => $(s).addEventListener("change", sincronizarCapas));
  $("#ocultar-reservadas").addEventListener("change", pintarZonas);

  // ---------- Zonas ----------

  let tablaZonas = null;
  // Filas de la tabla de zonas (con estado de reserva)
  function filasZonas() {
    const res = E.simulacion ? {} : reservasPorZona();
    return E.zonas.zonas.map((z) => datosZona(z, res));
  }
  // Crea o refresca la tabla de zonas
  function pintarTablaZonas() {
    if (!E.zonas) return;
    const filas = filasZonas();
    if (tablaZonas) { tablaZonas.replaceData(filas); return; }
    tablaZonas = new Tabulator("#tabla-zonas", {
      data: filas, layout: "fitData", height: "calc(100vh - 230px)",
      initialSort: [{ column: "profesores", dir: "desc" }],
      columns: [
        colTexto("Zona", "id"),
        colNumero("Docentes", "profesores"),
        { title: "Centros", field: "n_centros", hozAlign: "right" },
        colTexto("Municipios", "municipios"),
        colTexto("Distritos", "distritos"),
        colNumero("Km", "km_ruta", "<5"),
        colTexto("Coche", "coche"),
        colTexto("Estado", "estado"),
        colFecha("Fecha", "fecha"),
        colDiaSemana("Día", "diaSemana"),
        colTexto("Equipo", "equipo"),
        colTexto("Responsable", "responsable"),
        { title: "", field: "estado", headerSort: false, hozAlign: "center",
          formatter: (c) => (c.getValue() === "Libre" && !E.simulacion ? '<button class="boton-reservar">📅 Reservar</button>' : ""),
          cellClick: (e, cell) => { if (e.target.tagName === "BUTTON") window.__reservar(cell.getRow().getData().id); } },
        { title: "Ruta", field: "ruta", formatter: "link", formatterParams: { label: "Google Maps", target: "_blank" }, headerSort: false },
        { title: "PDF", formatter: () => "📄", hozAlign: "center", headerSort: false, tooltip: "Descargar el PDF de esta zona", cellClick: (e, cell) => pdfZona(cell.getRow().getData().id) },
        colTexto("Centros", "centros"),
      ],
    });
    tablaZonas.on("dataFiltered", (f, rows) => ($("#contador-zonas").textContent = `${rows.length} de ${filas.length} zonas`));
    tablaZonas.on("rowDblClick", (e, row) => verZona(row.getData().id));
  }
  // Centra el mapa en una zona
  function verZona(id) {
    const z = E.zonas.zonas.find((x) => x.id === id);
    if (!z) return;
    irA("mapa");
    const b = L.latLngBounds(z.centros.map((cid) => [E.porId[cid].lat, E.porId[cid].lon]));
    mapa.fitBounds(b.pad(0.5));
  }
  // Contador de zonas: total, reservadas, libres y docentes aproximados en las zonas libres
  function pintarResumen() {
    if (!E.zonas) return;
    const res = E.simulacion ? {} : reservasPorZona();
    const total = E.zonas.zonas.length, libres = E.zonas.zonas.filter((z) => !res[z.id]);
    const docentes = libres.reduce((s, z) => s + z.profesores, 0);
    const html = `<span><b>${total}</b> zonas</span><span><b>${total - libres.length}</b> reservadas</span>` +
      `<span><b>${libres.length}</b> por reservar</span>` +
      `<details class="nota-docentes"><summary>≈ <b>${docentes.toLocaleString("es-ES")}</b> docentes por alcanzar <span class="info">ⓘ</span></summary>
        <div class="nota-texto">
          <p>En realidad el número de docentes es mucho mayor porque solo hemos encontrado las plazas estables y no tiene en cuenta mucha interinidad.</p>
          <p>La plantilla orgánica es la relación de puestos de trabajo estables creados jurídicamente y se establece en cada curso a partir de la resolución definitiva del Concurso de Traslados convocado en el curso anterior. Comprende las plazas vinculadas a cada centro.</p>
          <p>Fecha de validación de datos: 12 de noviembre de 2025.</p>
        </div></details>`;
    // Al repintar se conserva si la nota estaba abierta
    document.querySelectorAll(".resumen").forEach((e) => {
      const abierta = !!e.querySelector("details[open]");
      e.innerHTML = html;
      e.querySelector("details").open = abierta;
    });
  }
  // Texto de estado de las zonas mostradas
  function estadoZonas() {
    const z = E.zonas;
    if (!z) { $("#estado-zonas").textContent = "No hay zonas."; return; }
    $("#estado-zonas").innerHTML = E.simulacion
      ? `Zonas <b>provisionales</b> (${z.porZona} centros/zona, ${z.zonas.length} zonas). Todavía no se pueden reservar.`
      : `Zonas publicadas: versión <b>${esc(z.version)}</b> (${z.porZona} centros/zona, ${z.zonas.length} zonas, ${esc(z.generado)}).`;
  }
  // Quita los caracteres que la fuente estándar del PDF no sabe pintar (emojis, etc.)
  const limpiar = (t) => String(t ?? "").replace(/[^\x20-\xFF]/g, "").trim();

  // Genera y descarga el PDF de una zona: datos para localizar y contactar cada centro, con enlaces
  function pdfZona(id) {
    const z = E.zonas.zonas.find((x) => x.id === id);
    if (!z) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const IZQ = 15, ANCHO = 180, FONDO = 280;
    let y = 18;
    // Salta de página si no cabe un bloque de "alto" mm
    const sitio = (alto) => { if (y + alto > FONDO) { doc.addPage(); y = 18; } };
    // Escribe un texto (partido en líneas) y avanza
    const texto = (t, tam, negrita) => {
      doc.setFont("helvetica", negrita ? "bold" : "normal"); doc.setFontSize(tam);
      const lineas = doc.splitTextToSize(limpiar(t), ANCHO);
      sitio(lineas.length * tam * 0.45);
      doc.text(lineas, IZQ, y); y += lineas.length * tam * 0.45;
    };
    // Escribe una fila de enlaces separados por " · "
    const enlaces = (lista) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(26, 107, 60);
      let x = IZQ;
      lista.filter((e) => e[1]).forEach(([etq, url], i) => {
        if (i) { doc.setTextColor(0); doc.text(" · ", x, y); x += doc.getTextWidth(" · "); doc.setTextColor(26, 107, 60); }
        doc.textWithLink(limpiar(etq), x, y, { url }); x += doc.getTextWidth(limpiar(etq));
      });
      doc.setTextColor(0); y += 5;
    };
    const cs = z.centros.map((cid) => E.porId[cid]);
    texto(`Zona ${z.id}`, 18, true); y += 1;
    texto(`${z.municipios}${z.distritos ? " (" + z.distritos + ")" : ""}`, 11);
    texto(`${z.n_centros} centros · recorrido aprox. ${z.km_ruta} km en línea recta${z.coche ? " · mejor con coche" : ""}`, 10);
    y += 1; enlaces([["Ruta completa en Google Maps", Zonas.enlaceRuta(cs)]]); y += 3;
    cs.forEach((c, i) => {
      sitio(32);
      doc.setDrawColor(200); doc.line(IZQ, y - 4, IZQ + ANCHO, y - 4);
      texto(`${i + 1}. ${c.t} ${c.n}`, 12, true); y += 1;
      texto(`${c.dir}${c.cp ? ", " + c.cp : ""} ${c.mun}${c.dis ? " (" + c.dis + ")" : ""}`, 10);
      const contacto = [c.tel && "Tel.: " + c.tel, c.mail && "Correo: " + c.mail].filter(Boolean).join("   ");
      if (contacto) texto(contacto, 10);
      y += 1;
      enlaces([["Google Maps", gmaps(c)], ["OpenStreetMap", osm(c)], ["Web del centro", c.web],
        ["Llamar", c.tel && "tel:" + c.tel.replace(/\s/g, "")], ["Escribir correo", c.mail && "mailto:" + c.mail]]);
      y += 4;
    });
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(limpiar(`${CONFIG.TITULO} · zonas ${E.zonas.version || "provisionales"}`), IZQ, 290);
    doc.save(`zona_${z.id}.pdf`);
  }
  // Permite pedir el PDF desde el popup de la zona en el mapa
  window.__pdf = pdfZona;

  // ---------- Reservas ----------

  let tablaReservas = null;
  // Rellena el desplegable de zonas libres y prepara el calendario del día (sin perder lo ya elegido)
  function rellenarFormulario() {
    const res = reservasPorZona();
    const libres = E.zonasPublicadas ? E.zonasPublicadas.zonas.filter((z) => !res[z.id]) : [];
    const elegida = $("#r-zona").value;
    $("#r-zona").innerHTML = '<option value="">— elige zona (ordenadas por nº de docentes) —</option>' +
      libres.map((z) => `<option value="${z.id}">${z.id} · ${z.profesores} docentes · ${esc(z.municipios)}${z.distritos ? " (" + esc(z.distritos) + ")" : ""}${z.coche ? " · 🚗" : ""}</option>`).join("");
    if (libres.some((z) => z.id === elegida)) $("#r-zona").value = elegida;
    // Calendario: con FECHAS en config, entre la primera y la última; si no, desde hoy hasta 21 días (lo que admite el backend)
    const dia = $("#r-dia");
    if (CONFIG.FECHAS && CONFIG.FECHAS.length) { dia.min = E.fechas[0]; dia.max = E.fechas[E.fechas.length - 1]; }
    else { const hoy = new Date(), fin = new Date(); fin.setDate(hoy.getDate() + 21); dia.min = iso(hoy); dia.max = iso(fin); }
    // Por defecto, el primer día recomendado (si aún no ha pasado)
    const rec = CONFIG.FECHAS_RECOMENDADAS || {};
    if (!dia.value) dia.value = rec.desde && rec.desde >= dia.min ? rec.desde : E.fechas[0];
    validarDia();
    try { if (!$("#r-codigo").value) $("#r-codigo").value = localStorage.getItem("codigoCampana") || ""; } catch (e) { /* sin almacenamiento */ }
  }
  // Comprueba el día elegido en el calendario (lunes a viernes, dentro de la campaña) y muestra el día de la semana
  function validarDia() {
    const dia = $("#r-dia"), f = dia.value;
    let error = "";
    if (f) {
      const n = new Date(f + "T12:00:00").getDay();
      if (n < 1 || n > 5) error = "Solo se puede reservar de lunes a viernes";
      else if ((dia.min && f < dia.min) || (dia.max && f > dia.max)) error = "Esa fecha está fuera de la campaña";
      else if (CONFIG.FECHAS && CONFIG.FECHAS.length && !CONFIG.FECHAS.includes(f)) error = "Esa fecha no es un día de la campaña";
    }
    dia.setCustomValidity(error);
    $("#r-dia-info").textContent = error ? "✖ " + error : f ? "📅 " + fmtDia(f) : "";
    $("#r-dia-info").className = error ? "ayuda msg error" : "ayuda";
  }
  $("#r-dia").addEventListener("input", validarDia);
  // ¿Está la fecha fuera de las fechas recomendadas (config.js → FECHAS_RECOMENDADAS)?
  function fueraDeRecomendadas(f) {
    const rec = CONFIG.FECHAS_RECOMENDADAS;
    return !!(f && rec && ((rec.desde && f < rec.desde) || (rec.hasta && f > rec.hasta)));
  }
  // Al elegir un día válido fuera de las fechas recomendadas, avisa con una ventana (pero deja reservar)
  $("#r-dia").addEventListener("change", () => {
    const f = $("#r-dia").value;
    if (f && !$("#r-dia").validationMessage && fueraDeRecomendadas(f)) mostrarAviso(CONFIG.AVISO_FECHA);
  });
  // Muestra una ventana de aviso con un texto y el botón "Entendido"
  function mostrarAviso(texto) {
    $("#modal-aviso-texto").textContent = texto;
    $("#modal-aviso").classList.remove("oculto");
    $("#modal-aviso-ok").focus();
  }
  // Cierra la ventana de aviso (botón, ✖, clic fuera o Escape)
  const cerrarAviso = () => $("#modal-aviso").classList.add("oculto");
  ["#modal-aviso-ok", "#cerrar-aviso"].forEach((s) => $(s).addEventListener("click", cerrarAviso));
  $("#modal-aviso").addEventListener("click", (e) => { if (e.target.id === "modal-aviso") cerrarAviso(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarAviso(); });
  // Muestra el detalle de la zona elegida en el formulario
  $("#r-zona").addEventListener("change", () => {
    const z = E.zonasPublicadas && E.zonasPublicadas.zonas.find((x) => x.id === $("#r-zona").value);
    $("#r-zona-info").innerHTML = z ? z.centros.map((id) => esc(E.porId[id].n)).join(" · ") + ` — ${z.km_ruta} km` : "";
  });
  // Pinta la tabla de reservas, ordenada por fecha (y zona dentro del mismo día), con filtros en cada columna
  function pintarReservas() {
    const v = E.zonasPublicadas && E.zonasPublicadas.version;
    const filas = E.reservas.filter((r) => r.version === v).map((r) => {
      const z = E.zonasPublicadas.zonas.find((x) => x.id === r.zona) || { centros: [] };
      return Object.assign({}, r, {
        diaSemana: diaSemana(r.dia), profesores: z.profesores, km_ruta: z.km_ruta, municipios: z.municipios,
        centros: z.centros.map((id) => (E.porId[id] || {}).n).join(" · "),
      });
    }).sort((a, b) => a.dia.localeCompare(b.dia) || a.zona.localeCompare(b.zona));
    const cols = [
      colFecha("Fecha", "dia"),
      colDiaSemana("Día", "diaSemana"),
      colTexto("Zona", "zona"),
      colTexto("Responsable", "responsable"),
      colTexto("Equipo", "equipo"),
      colNumero("Docentes", "profesores"),
      colNumero("Km", "km_ruta", "<5"),
      colTexto("Municipios", "municipios"),
      { title: "Personas", field: "personas", hozAlign: "right" },
      { title: "Coche", field: "coche" },
      { title: "", formatter: () => "✖", hozAlign: "center", headerSort: false, tooltip: "Cancelar esta reserva", cellClick: (e, cell) => cancelar(cell.getRow().getData()) },
      colTexto("Centros", "centros"),
    ];
    if (tablaReservas) { tablaReservas.replaceData(filas); return; }
    tablaReservas = new Tabulator("#tabla-reservas", { data: filas, layout: "fitData", columns: cols, initialSort: [{ column: "dia", dir: "asc" }], placeholder: "Sin reservas todavía" });
    // Contador de reservas visibles (se actualiza al filtrar y al recargar datos)
    const contar = () => ($("#contador-reservas").textContent = `${tablaReservas.getDataCount("active")} de ${tablaReservas.getDataCount()} reservas`);
    tablaReservas.on("dataFiltered", () => setTimeout(contar));
    tablaReservas.on("dataProcessed", contar);
  }
  // Pide la clave y cancela una reserva
  async function cancelar(r) {
    const clave = prompt(`Cancelar la reserva de ${r.zona} (${fmtDia(r.dia)}).\nIntroduce la clave del equipo:`);
    if (!clave) return;
    try {
      await Reservas.cancelar({ zona: r.zona, dia: r.dia, equipo: r.equipo, clave, version: r.version, codigo: $("#r-codigo").value });
      await cargarReservas();
    } catch (e) { alert("No se pudo cancelar: " + e.message); }
  }
  // Envía el formulario de reserva
  $("#form-reserva").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = $("#r-msg");
    msg.className = "msg"; msg.textContent = "Enviando…"; $("#r-enviar").disabled = true;
    try {
      try { localStorage.setItem("codigoCampana", $("#r-codigo").value); } catch (e) { /* sin almacenamiento */ }
      await Reservas.reservar({
        zona: $("#r-zona").value, dia: $("#r-dia").value, equipo: $("#r-equipo").value.trim(),
        responsable: $("#r-responsable").value.trim(), email: $("#r-email").value.trim(),
        telefono: $("#r-telefono").value.trim(), telegram: $("#r-telegram").value.trim(),
        personas: parseInt($("#r-personas").value, 10), coche: $("#r-coche").value,
        clave: $("#r-clave").value, codigo: $("#r-codigo").value, version: E.zonasPublicadas.version,
      });
      msg.className = "msg ok"; msg.textContent = "✔ Reserva hecha. ¡Gracias!";
      $("#r-zona").value = ""; $("#r-zona-info").textContent = "";
      await cargarReservas();
    } catch (e) {
      msg.className = "msg error"; msg.textContent = "✖ " + e.message;
    } finally { $("#r-enviar").disabled = false; }
  });
  $("#refrescar-reservas").addEventListener("click", () => cargarReservas());
  // Abre el formulario con una zona preseleccionada (botón del popup)
  window.__reservar = (id) => { irA("reservas"); $("#r-zona").value = id; $("#r-zona").dispatchEvent(new Event("change")); };

  // Descarga las reservas del backend y refresca todo
  async function cargarReservas() {
    if (!Reservas.activo()) return;
    try { E.reservas = await Reservas.listar(); } catch (e) { aviso("No se pudieron cargar las reservas: " + esc(e.message)); }
    refrescarTodo();
  }

  // ---------- Telegram ----------

  // Rellena los enlaces del canal y gestiona la ventana con el QR
  function prepararTelegram() {
    const url = CONFIG.TELEGRAM_URL;
    if (!url) { document.querySelectorAll("#btn-telegram, .tg-bloque").forEach((e) => e.remove()); return; }
    document.querySelectorAll(".tg-enlace").forEach((a) => { a.href = url; a.textContent = url.replace(/^https?:\/\//, ""); });
    const modal = $("#modal-telegram");
    $("#btn-telegram").addEventListener("click", () => modal.classList.remove("oculto"));
    $("#cerrar-telegram").addEventListener("click", () => modal.classList.add("oculto"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("oculto"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") modal.classList.add("oculto"); });
  }

  // ---------- Info ----------

  const textosMd = {};
  // Descarga un fichero Markdown (una sola vez) y lo devuelve como texto
  async function leerMd(ruta) {
    if (textosMd[ruta] == null) textosMd[ruta] = await (await fetch(ruta, { cache: "no-cache" })).text();
    return textosMd[ruta];
  }
  // Pasa Markdown a HTML y cambia los marcadores {{nombre}}: solos en un párrafo (bloques) o dentro de una frase
  const mdConMarcadores = (texto, m) =>
    marked.parse(texto).replace(/<p>\s*\{\{(\w+)\}\}\s*<\/p>|\{\{(\w+)\}\}/g, (todo, a, b) => m[a || b] ?? "");
  // Formatea un número con separador de miles
  const num = (n) => Number(n).toLocaleString("es-ES");
  // Pasa un nombre en MAYÚSCULAS a formato frase ("ESCUELA INFANTIL" -> "Escuela infantil")
  const frase = (s) => { const x = String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); return x.charAt(0).toUpperCase() + x.slice(1); };
  // Calcula las piezas de la pestaña Info que se meten en los marcadores {{...}} de info.md
  function marcadoresInfo() {
    const cs = E.centros, enMapa = cs.filter((c) => c.lat != null);
    const motivos = {}, tipos = {};
    cs.forEach((c) => {
      const m = Zonas.motivoExclusion(c, CONFIG);
      const tp = tipos[c.t] || (tipos[c.t] = { t: c.t, te: c.te || "", total: 0, reparto: 0, asam: 0 });
      tp.total++; if (!m) tp.reparto++; if (c.asam === true) tp.asam++;
      if (m && m !== "Ya tiene asamblea") {
        const clave = m.startsWith("Tipo de centro excluido") ? "tipo:" + c.t : m;
        (motivos[clave] = motivos[clave] || { m, t: c.t, te: c.te, n: 0 }).n++;
      }
    });
    const enReparto = cs.filter((c) => Zonas.entraEnReparto(c, CONFIG)).length;
    const docentes = cs.reduce((s, c) => s + (c.prof || 0), 0);
    const resumen = `<ul class="info-cifras">
      <li><b>${num(cs.length)}</b> centros públicos en total (<b>${num(enMapa.length)}</b> con coordenadas en el mapa).</li>
      <li><b>${num(cs.filter((c) => c.asam === true).length)}</b> con asamblea docente y <b>${num(cs.filter((c) => c.asam === false).length)}</b> sin asamblea${
        cs.some((c) => c.asam == null) ? ` (<b>${num(cs.filter((c) => c.asam == null).length)}</b> en duda)` : ""}.</li>
      <li><b>${num(docentes)}</b> plazas de docentes en plantilla orgánica (${num(cs.filter((c) => c.prof == null).length)} centros sin dato de plantilla).</li>
      <li><b>${num(enReparto)}</b> centros sin asamblea entran en el reparto, en <b>${num(E.zonas ? E.zonas.zonas.length : 0)}</b> zonas.</li>
      <li><b>${num(cs.length - enReparto - cs.filter((c) => c.asam === true).length)}</b> centros sin asamblea quedan fuera del reparto (lista de motivos más abajo).</li>
    </ul>`;
    const lista = Object.values(motivos).sort((a, b) => b.n - a.n);
    const descartados = `<ul class="info-cifras">${lista.map((x) => x.m.startsWith("Tipo de centro excluido")
      ? `<li><b>${num(x.n)}</b> · ${esc(frase(x.te) || x.t)} <span class="ayuda">(${esc(x.t)})</span></li>`
      : `<li><b>${num(x.n)}</b> · ${esc(x.m)}</li>`).join("")}</ul>`;
    const filasTipos = Object.values(tipos).sort((a, b) => b.total - a.total);
    const tablaTipos = `<div class="tabla-scroll"><table class="info-tabla"><thead><tr><th>Tipo</th><th>Centros</th><th>Con asamblea</th><th>En el reparto</th><th>Nombre</th></tr></thead><tbody>${
      filasTipos.map((x) => `<tr><td>${esc(x.t)}</td><td>${num(x.total)}</td><td>${num(x.asam)}</td><td>${x.reparto ? num(x.reparto) : "—"}</td><td>${esc(frase(x.te))}</td></tr>`).join("")}</tbody></table></div>`;
    return { resumen, descartados, tipos: tablaTipos };
  }
  // Pinta la pestaña Info: lee info.md (una vez), lo pasa a HTML y rellena los marcadores
  async function pintarInfo() {
    const caja = $("#info-contenido");
    if (!E.centros.length) return;
    try {
      caja.innerHTML = mdConMarcadores(await leerMd(RUTAS.info), marcadoresInfo());
      document.dispatchEvent(new CustomEvent("info-pintada"));
    } catch (e) { caja.textContent = "No se pudo cargar la información: " + e.message; }
  }

  // ---------- Material para imprimir ----------

  // Pinta la pestaña "Material para imprimir" a partir de material.md (enlaces a los ficheros de carteles/)
  async function pintarMaterial() {
    const caja = $("#material-contenido");
    try {
      caja.innerHTML = marked.parse(await leerMd(RUTAS.material));
      // Los enlaces del .md son relativos a él (así también funcionan en la copia local) y se abren en otra pestaña
      const base = new URL(RUTAS.material, location.href);
      caja.querySelectorAll("a[href]:not([href^='#'])").forEach((a) => {
        a.href = new URL(a.getAttribute("href"), base).href; a.target = "_blank"; a.rel = "noopener";
      });
    }
    catch (e) { caja.textContent = "No se pudo cargar el material: " + e.message; }
  }

  // ---------- Inicio (primera pestaña) ----------

  // Cifras del momento para los marcadores de intro.md
  function datosIntro() {
    const cs = E.centros, visitar = centrosAVisitar();
    const conAsam = cs.filter((c) => c.asam === true).length;
    const zonas = E.zonas ? E.zonas.zonas : [];
    const res = E.simulacion ? {} : reservasPorZona();
    const reservadas = zonas.filter((z) => res[z.id]).length;
    return {
      cs, visitar, conAsam, nZonas: zonas.length, reservadas,
      docentes: visitar.reduce((s, c) => s + (c.prof || 0), 0),
    };
  }
  // Una tarjeta de cifra grande (el número se anima desde 0 la primera vez)
  const cifra = (clase, n, titulo, detalle, prefijo) =>
    `<div class="cifra ${clase}"><b>${prefijo || ""}<span class="contar" data-n="${n}">${num(n)}</span></b><span class="c-titulo">${titulo}</span><span class="c-detalle">${detalle}</span></div>`;
  // Barra de zonas reservadas
  function htmlProgreso(d) {
    const pct = d.nZonas ? Math.round((d.reservadas / d.nZonas) * 100) : 0;
    return `<div class="intro-progreso"><div class="pr-texto"><span><b>${num(d.reservadas)}</b> de ${num(d.nZonas)} zonas ya tienen equipo</span>
      <span>faltan <b>${num(d.nZonas - d.reservadas)}</b></span></div>
      <div class="pr-barra" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(pct, 1)}%"></i></div></div>`;
  }
  // Mapa en SVG con un punto por centro: verde con asamblea, rojo por visitar, tenue fuera del reparto
  function htmlMapaPuntos(d) {
    const cs = d.cs.filter((c) => c.lat != null);
    const lat0 = 40.4, k = Math.cos((lat0 * Math.PI) / 180);
    const minLon = Math.min(...cs.map((c) => c.lon)), maxLon = Math.max(...cs.map((c) => c.lon));
    const minLat = Math.min(...cs.map((c) => c.lat)), maxLat = Math.max(...cs.map((c) => c.lat));
    const ancho = 1000, esc = ancho / ((maxLon - minLon) * k), alto = Math.round((maxLat - minLat) * esc);
    const tipo = (c) => (c.asam === true ? "p-con" : Zonas.entraEnReparto(c, CONFIG) ? "p-sin" : "p-fuera");
    // Primero los tenues y al final los rojos, para que queden encima
    const orden = { "p-fuera": 0, "p-con": 1, "p-sin": 2 };
    const puntos = cs.map((c) => ({ c, t: tipo(c) })).sort((a, b) => orden[a.t] - orden[b.t]).map(({ c, t }) =>
      `<circle class="${t}" cx="${((c.lon - minLon) * k * esc).toFixed(1)}" cy="${((maxLat - c.lat) * esc).toFixed(1)}" r="${t === "p-fuera" ? 3 : 4.5}" style="--d:${Math.round(Math.random() * 1600)}ms"/>`).join("");
    return `<figure class="hero-mapa"><svg viewBox="-10 -10 ${ancho + 20} ${alto + 20}" role="img" aria-label="Mapa de los centros públicos de la Comunidad de Madrid">${puntos}</svg>
      <figcaption>Cada punto es un centro público · <span class="lg p-con">●</span> con asamblea · <span class="lg p-sin">●</span> por visitar</figcaption></figure>`;
  }
  // Todos los marcadores de intro.md
  function marcadoresIntro() {
    const d = datosIntro();
    const pct = d.cs.length ? Math.round((d.conAsam / d.cs.length) * 100) : 0;
    return {
      n_centros: num(d.cs.length), n_con_asamblea: num(d.conAsam), n_por_visitar: num(d.visitar.length), pct_movilizado: pct,
      n_zonas: num(d.nZonas), zonas_libres: num(d.nZonas - d.reservadas), zonas_reservadas: num(d.reservadas),
      personas_un_dia: num(d.nZonas * 2), personas_por_dia: num(Math.round((d.nZonas * 2) / 4)), docentes_por_visitar: num(d.docentes),
      mapa_puntos: htmlMapaPuntos(d),
      cifras: `<div class="cifras">${cifra("verde", d.conAsam, "centros con asamblea", "ya organizados")}${
        cifra("roja", d.visitar.length, "centros por visitar", "sin asamblea, en las zonas")}${
        cifra("", d.nZonas, "zonas", "de unos 5 centros: una mañana")}${
        cifra("", d.docentes, "docentes", "en los centros por visitar (plazas estables)", "≈ ")}</div>`,
      progreso: htmlProgreso(d),
      botones: `<div class="botones-intro"><a class="cta principal" href="#reservas">📅 Reservar una zona</a><a class="cta" href="#mapa">🗺️ Ver el mapa</a>${
        CONFIG.TELEGRAM_URL ? '<a class="cta" href="#telegram">💬 Canal de Telegram</a>' : ""}</div>`,
    };
  }
  // Pinta la pestaña de inicio a partir de intro.md: cabecera (hasta el primer "##") y una tarjeta por cada "##".
  // En la cabecera, lo anterior al mapa de puntos va a la izquierda y lo posterior, debajo a todo el ancho.
  // Después solo se actualiza la barra de progreso (para no cortar las animaciones).
  let introPintada = false, introAnimada = false;
  async function pintarIntro() {
    const caja = $("#intro-contenido");
    if (!E.centros.length) return;
    if (introPintada) { const p = caja.querySelector(".intro-progreso"); if (p) p.outerHTML = htmlProgreso(datosIntro()); return; }
    try {
      const tmp = document.createElement("div");
      tmp.innerHTML = mdConMarcadores(await leerMd(RUTAS.intro), marcadoresIntro());
      const cabecera = document.createElement("header"), texto = document.createElement("div"), pie = document.createElement("div"), bloques = [];
      cabecera.className = "intro-hero"; texto.className = "hero-texto"; pie.className = "hero-pie"; cabecera.appendChild(texto);
      let bloque = null, trasMapa = false;
      [...tmp.childNodes].forEach((n) => {
        if (n.nodeName === "H2") { bloque = document.createElement("section"); bloque.className = "intro-bloque"; bloques.push(bloque); }
        if (bloque) bloque.appendChild(n);
        else if (n.classList && n.classList.contains("hero-mapa")) { cabecera.appendChild(n); trasMapa = true; }
        else (trasMapa ? pie : texto).appendChild(n);
      });
      if (pie.textContent.trim() || pie.querySelector("*")) cabecera.appendChild(pie);
      caja.replaceChildren(cabecera, ...bloques);
      introPintada = true;
      if (!introAnimada && $("#tab-inicio").classList.contains("activo")) { introAnimada = true; animarIntro(caja); }
    } catch (e) { caja.textContent = "No se pudo cargar la introducción: " + e.message; }
  }
  // Animaciones de entrada: los puntos del mapa aparecen y las cifras cuentan desde 0 (salvo "movimiento reducido")
  function animarIntro(caja) {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    caja.classList.add("animar");
    const inicio = performance.now(), DURACION = 1600;
    const nums = [...caja.querySelectorAll(".contar")];
    // Avanza un fotograma de la cuenta (con frenado al final)
    const paso = (ahora) => {
      const x = Math.min(1, (ahora - inicio) / DURACION), f = 1 - Math.pow(1 - x, 3);
      nums.forEach((e) => (e.textContent = num(Math.round(Number(e.dataset.n) * f))));
      if (x < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  // ---------- Arranque ----------

  // Repinta mapa, tablas y formulario (y lo que añada la copia local)
  function refrescarTodo() {
    pintarZonas(); sincronizarCapas(); pintarTablaZonas(); estadoZonas(); pintarResumen(); rellenarFormulario(); pintarReservas();
    if ($("#tab-info").classList.contains("activo")) pintarInfo();
    if ($("#tab-inicio").classList.contains("activo")) pintarIntro();
    GANCHOS.alRefrescar.forEach((f) => f());
  }

  // Descarga los centros: JSON legible (copia local) o data/centros.bin codificado (XOR con CLAVE_DATOS + descompresión;
  // ver scripts/preparar_datos.py)
  async function leerCentros() {
    if (RUTAS.centros.endsWith(".json")) return (await fetch(RUTAS.centros)).json();
    const b = new Uint8Array(await (await fetch(RUTAS.centros)).arrayBuffer());
    const k = new TextEncoder().encode(CONFIG.CLAVE_DATOS);
    for (let i = 0; i < b.length; i++) b[i] ^= k[i % k.length];
    const flujo = new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Response(flujo).json();
  }

  // Carga los datos e inicia la aplicación
  async function iniciar() {
    $("#titulo").textContent = CONFIG.TITULO;
    prepararTelegram();
    // Si la dirección trae una pestaña (#mapa, #reservas…), se abre esa
    const inicial = location.hash.slice(1);
    if (inicial && $("#tab-" + inicial)) irA(inicial);
    E.fechas = calcularFechas();
    const d = await leerCentros();
    // Los registros marcados en_web=false (edificios administrativos, códigos genéricos) solo van al Excel
    E.centros = d.centros.filter((c) => c.en_web !== false);
    E.centros.forEach((c) => (E.porId[c.id] = c));
    try {
      const r = await fetch(RUTAS.zonas);
      if (r.ok) E.zonasPublicadas = await r.json();
    } catch (e) { /* aún no publicadas */ }
    const avisos = [];
    if (!d.meta.asambleas_cargadas) avisos.push("Aún no se han cargado los datos de asambleas: todos los centros aparecen como <b>sin dato</b>.");
    if (E.zonasPublicadas) { E.zonas = E.zonasPublicadas; }
    else {
      E.zonas = Zonas.calcularZonas(centrosAVisitar(), { porZona: CONFIG.CENTROS_POR_ZONA, semilla: CONFIG.SEMILLA, kmCoche: CONFIG.KM_PARA_COCHE });
      E.simulacion = true;
      avisos.push("Zonas <b>provisionales</b>: todavía no se pueden reservar.");
    }
    if (!Reservas.activo()) avisos.push("Reservas desactivadas: falta <code>URL_RESERVAS</code> en <code>js/config.js</code>.");
    aviso(avisos.join("<br>"));
    pintarCentros();
    GANCHOS.alIniciar.forEach((f) => f());
    refrescarTodo();
    await cargarReservas();
  }

  // Lo que necesita la copia local completa (local/web_completa/completa.js) para añadir sus pestañas
  window.App = {
    E, $, esc, aviso, irA, mapa, capas, marcadores, refrescarTodo, centrosAVisitar, zonaDeCentro, reservasPorZona,
    gmaps, osm, txtAsam, txtProf, fmtDia, diaSemana, norm, filtroTexto, filtroNumero, colTexto, colNumero, colFecha, colDiaSemana,
    tablaZonas: () => tablaZonas, tablaReservas: () => tablaReservas,
    alIniciar: (f) => GANCHOS.alIniciar.push(f), alRefrescar: (f) => GANCHOS.alRefrescar.push(f),
  };
  iniciar().catch((e) => aviso("Error cargando datos: " + esc(e.message)));
})();
