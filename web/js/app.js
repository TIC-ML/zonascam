// Lógica principal de la web pública: carga datos, pinta mapa, zonas (con PDF por zona) y reservas.
// La versión completa (listado de centros y exportaciones) solo existe en la copia local: local/web_completa/
(function () {
  "use strict";

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
  const txtAsam = (a) => (a === true ? "Sí" : a === false ? "No" : "Sin dato");
  // Escapa texto para meterlo en HTML
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  // Formatea una fecha YYYY-MM-DD como "lunes 23/11"
  const fmtDia = (f) => { const d = new Date(f + "T12:00:00"); return `${NOMBRE_DIA[d.getDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`; };
  // Muestra u oculta el aviso superior
  const aviso = (html) => { const a = $("#aviso"); a.innerHTML = html || ""; a.classList.toggle("oculto", !html); };

  // Fechas de la campaña: las de config o lunes-jueves de la semana que viene
  function calcularFechas() {
    if (CONFIG.FECHAS && CONFIG.FECHAS.length) return CONFIG.FECHAS;
    const hoy = new Date();
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() + (((8 - hoy.getDay()) % 7) || 7));
    return [0, 1, 2, 3].map((i) => {
      const d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
  }

  // Centros que entran en el reparto (sin asamblea; opcionalmente solo con profesores)
  function centrosAVisitar(soloConProfes) {
    const excl = CONFIG.TIPOS_EXCLUIDOS_DEL_REPARTO || [];
    return E.centros.filter((c) => c.lat != null && c.asam !== true && !excl.includes(c.t) &&
      (CONFIG.SIN_DATO_CUENTA_COMO_SIN_ASAMBLEA || c.asam === false) && (!soloConProfes || c.prof > 0));
  }

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

  // Activa la pestaña indicada
  function irA(tab) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("activa", b.dataset.tab === tab));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("activo", p.id === "tab-" + tab));
    if (tab === "mapa") setTimeout(() => mapa.invalidateSize(), 50);
    if (tab === "zonas" && tablaZonas) tablaZonas.redraw();
    if (tab === "reservas" && tablaReservas) tablaReservas.redraw();
  }
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => irA(b.dataset.tab)));

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
      <p><b>${c.prof}</b> profesores (plantilla orgánica) · Asamblea: <span class="etq ${etq}">${txtAsam(c.asam)}</span></p>
      ${z ? `<p>Zona: <b>${z.id}</b></p>` : ""}
      <p><a href="${gmaps(c)}" target="_blank" rel="noopener">Google Maps</a> · <a href="${osm(c)}" target="_blank" rel="noopener">OpenStreetMap</a>
      ${c.web ? ` · <a href="${esc(c.web)}" target="_blank" rel="noopener">Web</a>` : ""}</p>
</div>`;
  }

  // Pinta los puntos de todos los centros
  function pintarCentros() {
    Object.values(capas).forEach((g) => g !== capas.zonas && g.clearLayers());
    E.centros.forEach((c) => {
      if (c.lat == null) return;
      // Los tipos excluidos del reparto (aulas de hospital y prisión) sin asamblea se pintan aparte: no se visitan
      const excluido = c.asam !== true && (CONFIG.TIPOS_EXCLUIDOS_DEL_REPARTO || []).includes(c.t);
      const tipo = excluido ? "novis" : c.asam === true ? "con" : c.asam === false ? "sin" : "nodato";
      const col = { con: "#1a9641", sin: "#d7191c", nodato: "#9e9e9e", novis: "#ffffff" }[tipo];
      const m = L.circleMarker([c.lat, c.lon], { radius: 5, color: "#333", weight: 1, fillColor: col, fillOpacity: 0.9 })
        .bindPopup(() => popupCentro(c));
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
    return `<div class="popup"><h3>Zona ${z.id} · ${z.profesores} profesores</h3>
      <p>${z.n_centros} centros · ${esc(z.municipios)}${z.distritos ? " (" + esc(z.distritos) + ")" : ""}</p>
      <p>Recorrido aprox. ${z.km_ruta} km en línea recta${z.coche ? " · 🚗 mejor con coche" : ""}</p>
      <ol>${cs.map((c) => `<li>${esc(c.t)} ${esc(c.n)} (${c.prof}) – <a href="${gmaps(c)}" target="_blank" rel="noopener">mapa</a></li>`).join("")}</ol>
      <p><a href="${Zonas.enlaceRuta(cs)}" target="_blank" rel="noopener">🧭 Ruta en Google Maps</a> · <button onclick="window.__pdf('${z.id}')">📄 PDF de la zona</button></p>
      ${r ? `<p><span class="etq res">Reservada: ${esc(r.equipo)} · ${fmtDia(r.dia)}</span></p>`
          : E.simulacion ? `<p class="ayuda">Simulación: no se puede reservar.</p>`
          : `<p><button onclick="window.__reservar('${z.id}')">📅 Reservar esta zona</button></p>`}</div>`;
  }

  // Pinta los polígonos de las zonas coloreados por nº de profesores
  function pintarZonas() {
    capas.zonas.clearLayers();
    if (!E.zonas) return;
    const res = reservasPorZona(), cs = cortes(E.zonas.zonas), ocultar = $("#ocultar-reservadas").checked;
    E.zonas.zonas.forEach((z) => {
      const r = !E.simulacion && res[z.id];
      if (ocultar && r) return;
      const estilo = { color: r ? "#1f4e78" : "#555", weight: r ? 3 : 1, dashArray: r ? "6 4" : null, fillColor: color(z.profesores, cs), fillOpacity: r ? 0.15 : 0.45 };
      const capa = z.poligono ? L.polygon(z.poligono, estilo) : L.circle(z.centro, Object.assign({ radius: 300 }, estilo));
      capa.bindPopup(() => popupZona(z, res)).bindTooltip(z.id, { sticky: true });
      capa.addTo(capas.zonas);
    });
    $("#leyenda").innerHTML = "Profes/zona: " + CONFIG.COLORES.map((c, i) =>
      `<i style="background:${c}"></i>${i === 0 ? "≤" + cs[0] : i === 4 ? ">" + cs[3] : ""}`).join("");
  }

  // Muestra u oculta capas según las casillas
  function sincronizarCapas() {
    [["#ver-sin", capas.sin], ["#ver-con", capas.con], ["#ver-nodato", capas.nodato], ["#ver-novis", capas.novis], ["#ver-zonas", capas.zonas]]
      .forEach(([sel, g]) => ($(sel).checked ? g.addTo(mapa) : g.remove()));
    capas.sin.eachLayer((l) => l.bringToFront && l.bringToFront());
  }
  ["#ver-sin", "#ver-con", "#ver-nodato", "#ver-novis", "#ver-zonas"].forEach((s) => $(s).addEventListener("change", sincronizarCapas));
  $("#ocultar-reservadas").addEventListener("change", pintarZonas);

  // ---------- Zonas ----------

  let tablaZonas = null;
  // Filas de la tabla de zonas (con estado de reserva)
  function filasZonas() {
    const res = E.simulacion ? {} : reservasPorZona();
    return E.zonas.zonas.map((z) => {
      const r = res[z.id];
      return {
        id: z.id, profesores: z.profesores, n_centros: z.n_centros, municipios: z.municipios, distritos: z.distritos,
        km_ruta: z.km_ruta, coche: z.coche ? "Sí" : "No",
        estado: r ? "Reservada" : "Libre", equipo: r ? r.equipo : "", dia: r ? fmtDia(r.dia) : "",
        centros: z.centros.map((id) => E.porId[id].n).join(" · "),
        ruta: Zonas.enlaceRuta(z.centros.map((id) => E.porId[id])),
      };
    });
  }
  // Crea o refresca la tabla de zonas
  function pintarTablaZonas() {
    if (!E.zonas) return;
    const filas = filasZonas();
    if (tablaZonas) { tablaZonas.replaceData(filas); return; }
    tablaZonas = new Tabulator("#tabla-zonas", {
      data: filas, layout: "fitDataStretch", height: "calc(100vh - 230px)",
      initialSort: [{ column: "profesores", dir: "desc" }],
      columns: [
        { title: "Zona", field: "id", headerFilter: "input" },
        { title: "Profes", field: "profesores", sorter: "number", hozAlign: "right", headerFilter: "number", headerFilterPlaceholder: "≥", headerFilterFunc: ">=" },
        { title: "Centros", field: "n_centros", hozAlign: "right" },
        { title: "Municipios", field: "municipios", headerFilter: "input" },
        { title: "Distritos", field: "distritos", headerFilter: "input" },
        { title: "Km", field: "km_ruta", sorter: "number", hozAlign: "right", headerFilter: "number", headerFilterPlaceholder: "≤", headerFilterFunc: "<=" },
        { title: "Coche", field: "coche", headerFilter: "list", headerFilterParams: { values: ["Sí", "No"], clearable: true } },
        { title: "Estado", field: "estado", headerFilter: "list", headerFilterParams: { values: ["Libre", "Reservada"], clearable: true } },
        { title: "Equipo", field: "equipo", headerFilter: "input", formatter: (c) => esc(c.getValue()) },
        { title: "Día", field: "dia", headerFilter: "input" },
        { title: "Ruta", field: "ruta", formatter: "link", formatterParams: { label: "Google Maps", target: "_blank" }, headerSort: false },
        { title: "PDF", formatter: () => "📄", hozAlign: "center", headerSort: false, tooltip: "Descargar el PDF de esta zona", cellClick: (e, cell) => pdfZona(cell.getRow().getData().id) },
        { title: "Centros", field: "centros", headerFilter: "input", width: 400 },
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
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(31, 78, 120);
      let x = IZQ;
      lista.filter((e) => e[1]).forEach(([etq, url], i) => {
        if (i) { doc.setTextColor(0); doc.text(" · ", x, y); x += doc.getTextWidth(" · "); doc.setTextColor(31, 78, 120); }
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
  // Rellena los desplegables de zona y día del formulario
  function rellenarFormulario() {
    const res = reservasPorZona();
    const libres = E.zonasPublicadas ? E.zonasPublicadas.zonas.filter((z) => !res[z.id]) : [];
    $("#r-zona").innerHTML = '<option value="">— elige zona (ordenadas por nº de profes) —</option>' +
      libres.map((z) => `<option value="${z.id}">${z.id} · ${z.profesores} profes · ${esc(z.municipios)}${z.distritos ? " (" + esc(z.distritos) + ")" : ""}${z.coche ? " · 🚗" : ""}</option>`).join("");
    $("#r-dia").innerHTML = E.fechas.map((f) => `<option value="${f}">${fmtDia(f)}</option>`).join("");
    try { $("#r-codigo").value = localStorage.getItem("codigoCampana") || ""; } catch (e) { /* sin almacenamiento */ }
  }
  // Muestra el detalle de la zona elegida en el formulario
  $("#r-zona").addEventListener("change", () => {
    const z = E.zonasPublicadas && E.zonasPublicadas.zonas.find((x) => x.id === $("#r-zona").value);
    $("#r-zona-info").innerHTML = z ? z.centros.map((id) => esc(E.porId[id].n)).join(" · ") + ` — ${z.km_ruta} km` : "";
  });
  // Pinta la tabla de reservas
  function pintarReservas() {
    const v = E.zonasPublicadas && E.zonasPublicadas.version;
    const filas = E.reservas.filter((r) => r.version === v).map((r) => {
      const z = E.zonasPublicadas.zonas.find((x) => x.id === r.zona) || {};
      return Object.assign({}, r, { diaTxt: fmtDia(r.dia), profesores: z.profesores, municipios: z.municipios, distritos: z.distritos });
    });
    const cols = [
      { title: "Fecha", field: "dia", visible: false },
      { title: "Día", field: "diaTxt", headerFilter: "list", headerFilterParams: { valuesLookup: true, clearable: true } },
      { title: "Zona", field: "zona", headerFilter: "input" },
      { title: "Profes", field: "profesores", hozAlign: "right" },
      { title: "Municipios", field: "municipios", headerFilter: "input" },
      { title: "Equipo", field: "equipo", headerFilter: "input", formatter: (c) => esc(c.getValue()) },
      { title: "Responsable", field: "responsable", headerFilter: "input", formatter: (c) => esc(c.getValue()) },
      { title: "Personas", field: "personas", hozAlign: "right" },
      { title: "Coche", field: "coche" },
      { title: "", formatter: () => "✖", hozAlign: "center", headerSort: false, cellClick: (e, cell) => cancelar(cell.getRow().getData()) },
    ];
    if (tablaReservas) tablaReservas.replaceData(filas);
    else tablaReservas = new Tabulator("#tabla-reservas", { data: filas, layout: "fitDataStretch", columns: cols, initialSort: [{ column: "dia", dir: "asc" }], placeholder: "Sin reservas todavía" });
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

  // ---------- Arranque ----------

  // Repinta mapa, tablas y formulario
  function refrescarTodo() {
    pintarZonas(); sincronizarCapas(); pintarTablaZonas(); estadoZonas(); rellenarFormulario(); pintarReservas();
  }

  // Descarga data/centros.bin y lo descodifica (XOR con CLAVE_DATOS + descompresión); ver scripts/preparar_datos.py
  async function leerCentros() {
    const b = new Uint8Array(await (await fetch("data/centros.bin")).arrayBuffer());
    const k = new TextEncoder().encode(CONFIG.CLAVE_DATOS);
    for (let i = 0; i < b.length; i++) b[i] ^= k[i % k.length];
    const flujo = new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Response(flujo).json();
  }

  // Carga los datos e inicia la aplicación
  async function iniciar() {
    $("#titulo").textContent = CONFIG.TITULO;
    prepararTelegram();
    E.fechas = calcularFechas();
    const d = await leerCentros();
    E.centros = d.centros;
    E.centros.forEach((c) => (E.porId[c.id] = c));
    try {
      const r = await fetch("data/zonas.json");
      if (r.ok) E.zonasPublicadas = await r.json();
    } catch (e) { /* aún no publicadas */ }
    const avisos = [];
    if (!d.meta.asambleas_cargadas) avisos.push("Aún no se han cargado los datos de asambleas: todos los centros aparecen como <b>sin dato</b>.");
    if (E.zonasPublicadas) { E.zonas = E.zonasPublicadas; }
    else {
      E.zonas = Zonas.calcularZonas(centrosAVisitar(CONFIG.SOLO_CON_PROFESORES !== false), { porZona: CONFIG.CENTROS_POR_ZONA, semilla: CONFIG.SEMILLA, kmCoche: CONFIG.KM_PARA_COCHE });
      E.simulacion = true;
      avisos.push("Zonas <b>provisionales</b>: todavía no se pueden reservar.");
    }
    if (!Reservas.activo()) avisos.push("Reservas desactivadas: falta <code>URL_RESERVAS</code> en <code>js/config.js</code>.");
    aviso(avisos.join("<br>"));
    pintarCentros();
    refrescarTodo();
    await cargarReservas();
  }
  iniciar().catch((e) => aviso("Error cargando datos: " + esc(e.message)));
})();
