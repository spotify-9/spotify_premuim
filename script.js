/* ═══════════════════════════════════════════
   SPOTIFY ROJO — Reproductor de música
   Datos: canciones.js (CANCIONES, desde Cloudinary)
   ═══════════════════════════════════════════ */

"use strict";

const $ = (sel) => document.querySelector(sel);

// ── Constantes ──

const PAGE_CANCIONES = 60;   // tarjetas por bloque
const PAGE_ARTISTAS = 24;    // artistas por bloque
const PAGE_FILAS = 50;       // filas de canciones por bloque en listas

// ── Estado global ──

const estado = {
  cancionActual: null,     // índice en CANCIONES
  contexto: [],            // lista de índices que se está reproduciendo
  posicionContexto: -1,
  contextoNombre: "Canciones para ti",
  descargas: new Set(),    // índices guardados para escuchar sin internet
  reproduciendo: false,
  aleatorio: false,
  repetir: false,
  volumen: 0.7,
  silenciado: false,
  duraciones: {},          // idx → segundos conocidos
  favoritos: new Set(JSON.parse(localStorage.getItem("rojoFavoritos") || "[]")),
  paginaCanciones: 1,
  paginaArtistas: 1,
  paginaDetalle: 1,
  detalleActual: null,     // {tipo, titulo, canciones, grad}
};

// ── Audio ──

const audio = new Audio();
audio.volume = estado.volumen;

// ── Índice de artistas ──

const artistasMap = new Map(); // nombre → {portada, canciones: [idx...]}
CANCIONES.forEach((c, i) => {
  const clave = (c.artista || "Artista desconocido").trim();
  if (!artistasMap.has(clave)) {
    artistasMap.set(clave, { portada: c.portada, canciones: [] });
  }
  artistasMap.get(clave).canciones.push(i);
});
const listaArtistas = [...artistasMap.entries()]; // [nombre, datos]

// ── Utilidades ──

function formatoTiempo(seg) {
  if (!isFinite(seg) || seg < 0) return "0:00";
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60);
  return m + ":" + String(s).padStart(2, "0");
}

function normalizar(texto) {
  return (texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function aviso(texto) {
  const previo = document.getElementById("avisoTemporal");
  if (previo) previo.remove();
  const a = document.createElement("div");
  a.id = "avisoTemporal";
  a.textContent = texto;
  a.style.cssText = `
    position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
    background: #e8112d; color: #fff; padding: 12px 24px; border-radius: 24px;
    font-size: 14px; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,.5);
    z-index: 300; white-space: nowrap;
  `;
  document.body.appendChild(a);
  setTimeout(() => a.remove(), 2600);
}

function mezclar(arr) {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// ── FAVORITOS ──

function guardarFavoritos() {
  localStorage.setItem("rojoFavoritos", JSON.stringify([...estado.favoritos]));
}

function esFavorito(idx) { return estado.favoritos.has(idx); }

function alternarFavorito(idx) {
  if (esFavorito(idx)) {
    estado.favoritos.delete(idx);
    aviso("Eliminado de Tus me gusta.");
  } else {
    estado.favoritos.add(idx);
    aviso("Agregado a Tus me gusta.");
  }
  guardarFavoritos();
  actualizarCorazonReproductor();
  actualizarBannerMeGusta();
}

function actualizarCorazonReproductor() {
  const btn = $("#btnCorazon");
  const activo = estado.cancionActual !== null && esFavorito(estado.cancionActual);
  btn.classList.toggle("activo", activo);
  const i = btn.querySelector("i");
  i.className = activo ? "fa-solid fa-heart" : "fa-regular fa-heart";
}

function actualizarBannerMeGusta() {
  const n = estado.favoritos.size;
  $("#bannerMeGustaSub").textContent =
    n === 0 ? "Guarda tus canciones favoritas aquí." : `${n} canción${n === 1 ? "" : "es"} guardada${n === 1 ? "" : "s"}.`;
}

// ── RENDER: tarjetas de canciones ──

function crearTarjetaCancion(idx) {
  const c = CANCIONES[idx];
  const t = document.createElement("div");
  t.className = "tarjeta";
  t.innerHTML = `
    <div class="portada-tarjeta">
      <img src="${c.portada}" alt="${c.nombre}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-music'}))">
    </div>
    <h3 title="${c.nombre}">${c.nombre}</h3>
    <p>${c.artista}</p>
    <button class="btn-play-tarjeta" title="Reproducir"><i class="fa-solid fa-play"></i></button>
  `;
  const reproducirTarjeta = () => {
    const suArtista = (c.artista || "").trim();
    const datos = artistasMap.get(suArtista);
    if (datos) {
      const posicion = datos.canciones.indexOf(idx);
      reproducirDesdeVista(datos.canciones, posicion, suArtista);
    } else {
      reproducirDesdeVista([idx], 0, c.nombre);
    }
  };
  t.addEventListener("click", (e) => {
    if (!e.target.closest(".btn-play-tarjeta")) reproducirTarjeta();
  });
  t.querySelector(".btn-play-tarjeta").addEventListener("click", (e) => {
    e.stopPropagation();
    reproducirTarjeta();
  });
  return t;
}

function crearTarjetaArtista(nombre, datos) {
  const t = document.createElement("div");
  t.className = "tarjeta";
  t.innerHTML = `
    <div class="portada-tarjeta circulo">
      <img src="${datos.portada}" alt="${nombre}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-user'}))">
    </div>
    <h3 title="${nombre}">${nombre}</h3>
    <p>${datos.canciones.length} canción${datos.canciones.length === 1 ? "" : "es"}</p>
  `;
  t.addEventListener("click", () => abrirArtista(nombre));
  return t;
}

// ── RENDER: filas de canciones ──

function crearFilaCancion(idx, numero, lista) {
  const c = CANCIONES[idx];
  const sonando = estado.cancionActual === idx;
  const duracion = estado.duraciones[idx];
  const listaRep = lista || [idx];

  const fila = document.createElement("div");
  fila.className = "fila cancion-fila" + (sonando ? " sonando" : "");
  fila.innerHTML = `
    <span class="col-num">${sonando ? '<i class="fa-solid fa-volume-high"></i>' : numero}</span>
    <span class="col-titulo">
      <span class="cancion">
        <span class="cancion-mini">
          <img src="${c.portada}" alt="" loading="lazy" onerror="this.style.display='none'">
        </span>
        <span class="cancion-textos">
          <span class="t" title="${c.nombre}">${c.nombre}</span>
          <span class="a">${c.artista}</span>
        </span>
      </span>
    </span>
    <span class="col-album">${c.artista}</span>
    <span class="col-duracion">
      <span>${duracion ? formatoTiempo(duracion) : ""}</span>
      <button class="btn-agregar-fila" title="Agregar a playlist o guardar"><i class="fa-solid fa-plus"></i></button>
    </span>
  `;
  fila.querySelector(".btn-agregar-fila").addEventListener("click", (e) => {
    e.stopPropagation();
    abrirMenuCancion(idx, e.clientX - 220, e.clientY + 8);
  });
  fila.addEventListener("click", () => {
    const posicion = listaRep.indexOf(idx);
    // Si la canción no está en la lista, se reproduce sola con su artista como contexto
    if (posicion === -1) {
      const suArtista = (c.artista || "").trim();
      const datos = artistasMap.get(suArtista);
      if (datos) {
        reproducirDesdeVista(datos.canciones, datos.canciones.indexOf(idx), suArtista);
      } else {
        reproducirDesdeVista([idx], 0, c.nombre);
      }
      return;
    }
    reproducirDesdeVista(listaRep, posicion);
  });
  return fila;
}

// ── REPRODUCCIÓN ──

let contextoActual = [];

function reproducirDesdeVista(lista, posicion, nombre) {
  contextoActual = lista;
  if (nombre) estado.contextoNombre = nombre;
  reproducir(posicion);
}

function reproducir(posicion) {
  if (posicion < 0 || posicion >= contextoActual.length) return;
  estado.posicionContexto = posicion;
  cargarCancion(contextoActual[posicion], true);
}

function cargarCancion(idx, reproducirAhora) {
  const c = CANCIONES[idx];
  if (!c) return;

  estado.cancionActual = idx;
  audio.volume = estado.silenciado ? 0 : estado.volumen;

  // UI reproductor
  $("#portadaActual").innerHTML = `<img src="${c.portada}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-music'}))">`;
  $("#tituloActual").textContent = c.nombre;
  $("#artistaActual").textContent = c.artista;
  document.title = c.nombre + " - " + c.artista + " | Spotify Rojo";

  $("#rellenoProgreso").style.width = "0%";
  $("#tiempoActual").textContent = "0:00";
  $("#tiempoTotal").textContent = "0:00";

  actualizarCorazonReproductor();
  actualizarCola();
  actualizarNowPlaying();
  refrescarFilasSonando();

  // Usa la copia descargada si existe; si no, la URL en línea
  resolverFuente(idx).then((src) => {
    if (estado.cancionActual !== idx) return;
    audio.src = src;
    if (reproducirAhora !== false) reproducirAudio();
  });
}

function reproducirAudio() {
  audio.play()
    .then(() => marcarReproduciendo(true))
    .catch(() => {
      marcarReproduciendo(false);
      aviso("No se pudo reproducir esta canción. Probemos con la siguiente.");
    });
}

function marcarReproduciendo(valor) {
  estado.reproduciendo = valor;
  const icono = $("#btnPlay").querySelector("i");
  icono.className = valor ? "fa-solid fa-pause" : "fa-solid fa-play";
  $("#npPlay").querySelector("i").className = valor ? "fa-solid fa-pause" : "fa-solid fa-play";
  $("#portadaActual").classList.toggle("girando", valor);
}

function siguienteCancion(auto = false) {
  if (contextoActual.length === 0) return;

  if (estado.repetir && auto) {
    audio.currentTime = 0;
    reproducirAudio();
    return;
  }

  if (estado.aleatorio) {
    let siguiente;
    do {
      siguiente = Math.floor(Math.random() * contextoActual.length);
    } while (contextoActual.length > 1 && siguiente === estado.posicionContexto);
    reproducir(siguiente);
    return;
  }

  const siguiente = estado.posicionContexto + 1;
  if (siguiente >= contextoActual.length) {
    if (auto) { marcarReproduciendo(false); return; }
    reproducir(0);
    return;
  }
  reproducir(siguiente);
}

function anteriorCancion() {
  if (contextoActual.length === 0) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const previa = estado.posicionContexto - 1;
  reproducir(previa < 0 ? contextoActual.length - 1 : previa);
}

// Eventos del audio

audio.addEventListener("timeupdate", () => {
  if (isFinite(audio.duration) && audio.duration > 0) {
    const pct = (audio.currentTime / audio.duration) * 100;
    $("#rellenoProgreso").style.width = pct + "%";
    $("#tiempoActual").textContent = formatoTiempo(audio.currentTime);
    $("#npRelleno").style.width = pct + "%";
    $("#npTiempoActual").textContent = formatoTiempo(audio.currentTime);
  }
  actualizarLetraTiempo();
});

audio.addEventListener("loadedmetadata", () => {
  $("#tiempoTotal").textContent = formatoTiempo(audio.duration);
  $("#npTiempoTotal").textContent = formatoTiempo(audio.duration);
  if (estado.cancionActual !== null) {
    estado.duraciones[estado.cancionActual] = audio.duration;
  }
  actualizarLetraTiempo(true);
});

audio.addEventListener("ended", () => siguienteCancion(true));

audio.addEventListener("error", () => {
  if (estado.cancionActual !== null && audio.src) {
    aviso(
      navigator.onLine
        ? "Esta canción no está disponible ahora mismo."
        : "Sin internet y esta canción no está guardada. Guárdala con conexión para oírla offline."
    );
  }
});

// ── COLA ──

function actualizarCola() {
  const cuerpo = $("#cuerpoCola");
  if (estado.cancionActual === null || contextoActual.length === 0) {
    cuerpo.innerHTML = `
      <p class="cola-vacia"><i class="fa-solid fa-list-ul"></i><br />
      Tu cola está vacía.<br />Reproduce una playlist para verla aquí.</p>`;
    return;
  }

  const siguientes = contextoActual
    .slice(estado.posicionContexto + 1, estado.posicionContexto + 31);

  let html = `<h4 class="cola-subtitulo">Sonando ahora</h4>`;
  const c = CANCIONES[estado.cancionActual];
  html += `
    <div class="cola-item activo">
      <img src="${c.portada}" alt="" onerror="this.style.display='none'">
      <div class="cola-textos"><span class="t">${c.nombre}</span><span class="a">${c.artista}</span></div>
    </div>`;

  if (siguientes.length > 0) {
    html += `<h4 class="cola-subtitulo">A continuación</h4>`;
    siguientes.forEach((idx, i) => {
      const s = CANCIONES[idx];
      html += `
        <div class="cola-item" data-idx="${estado.posicionContexto + 1 + i}">
          <img src="${s.portada}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="cola-textos"><span class="t">${s.nombre}</span><span class="a">${s.artista}</span></div>
        </div>`;
    });
  }
  cuerpo.innerHTML = html;

  cuerpo.querySelectorAll(".cola-item[data-idx]").forEach((item) => {
    item.addEventListener("click", () => reproducir(parseInt(item.dataset.idx, 10)));
  });
}

function refrescarFilasSonando() {
  document.querySelectorAll(".cancion-fila").forEach((fila) => {
    const num = fila.querySelector(".col-num");
    if (!num.dataset.numero) num.dataset.numero = num.textContent.trim();
    const sonando = parseInt(fila.dataset.idx, 10) === estado.cancionActual;
    fila.classList.toggle("sonando", sonando);
    num.innerHTML = sonando ? '<i class="fa-solid fa-volume-high"></i>' : num.dataset.numero;
  });
}

// ── CONTROLES DEL REPRODUCTOR ──

$("#btnPlay").addEventListener("click", () => {
  if (estado.cancionActual === null) {
    // Primera vez: reproducir canciones para ti
    const inicio = [...Array(Math.min(PAGE_CANCIONES, CANCIONES.length)).keys()];
    reproducirDesdeVista(inicio, 0);
    return;
  }
  if (estado.reproduciendo) {
    audio.pause();
    marcarReproduciendo(false);
  } else {
    reproducirAudio();
  }
});

$("#btnSiguiente").addEventListener("click", () => siguienteCancion(false));
$("#btnAnterior").addEventListener("click", anteriorCancion);

$("#btnAleatorio").addEventListener("click", () => {
  estado.aleatorio = !estado.aleatorio;
  $("#btnAleatorio").classList.toggle("togglado", estado.aleatorio);
  $("#btnAleatorio").style.color = estado.aleatorio ? "var(--rojo-hover)" : "";
  aviso(estado.aleatorio ? "Modo aleatorio activado." : "Modo aleatorio desactivado.");
});

$("#btnRepetir").addEventListener("click", () => {
  estado.repetir = !estado.repetir;
  $("#btnRepetir").classList.toggle("togglado", estado.repetir);
  $("#btnRepetir").style.color = estado.repetir ? "var(--rojo-hover)" : "";
  aviso(estado.repetir ? "Repetir activado." : "Repetir desactivado.");
});

$("#btnCorazon").addEventListener("click", () => {
  if (estado.cancionActual === null) { aviso("Reproduce una canción primero."); return; }
  alternarFavorito(estado.cancionActual);
});

// Buscar tiempo
$("#pistaProgreso").addEventListener("click", (e) => {
  if (!isFinite(audio.duration) || audio.duration <= 0) return;
  const rect = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

// Volumen
function ajustarVolumen(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  estado.volumen = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  estado.silenciado = false;
  audio.volume = estado.volumen;
  $("#rellenoVolumen").style.width = estado.volumen * 100 + "%";
  actualizarIconoVolumen();
}

$("#pistaVolumen").addEventListener("click", ajustarVolumen);

function actualizarIconoVolumen() {
  const i = $("#btnSilenciar").querySelector("i");
  if (estado.silenciado || estado.volumen === 0) i.className = "fa-solid fa-volume-xmark";
  else if (estado.volumen < 0.5) i.className = "fa-solid fa-volume-low";
  else i.className = "fa-solid fa-volume-high";
}

$("#btnSilenciar").addEventListener("click", () => {
  estado.silenciado = !estado.silenciado;
  audio.volume = estado.silenciado ? 0 : estado.volumen;
  actualizarIconoVolumen();
});

// Cola
$("#btnCola").addEventListener("click", () => $("#panelCola").classList.toggle("oculto"));
$("#btnCerrarCola").addEventListener("click", () => $("#panelCola").classList.add("oculto"));

// ── VISTAS ──

const vistaInicio = $("#vistaInicio");
const vistaBuscar = $("#vistaBuscar");
const vistaDetalle = $("#vistaDetalle");

function mostrarVista(vista) {
  [vistaInicio, vistaBuscar, vistaDetalle].forEach((v) => v.classList.add("oculto"));
  vista.classList.remove("oculto");
  vista.scrollTop = 0;
}

document.querySelectorAll(".item-nav").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector(".item-nav.activo").classList.remove("activo");
    link.classList.add("activo");
    if (link.dataset.vista === "inicio") mostrarVista(vistaInicio);
    if (link.dataset.vista === "buscar") {
      mostrarVista(vistaBuscar);
      actualizarBusqueda($("#inputBuscar").value);
    }
  });
});

// ── INICIO: render paginado ──

function renderCanciones(reset = false) {
  if (reset) { estado.paginaCanciones = 1; $("#cuadriculaCanciones").innerHTML = ""; }
  const desde = (estado.paginaCanciones - 1) * PAGE_CANCIONES;
  const hasta = Math.min(desde + PAGE_CANCIONES, CANCIONES.length);
  const frag = document.createDocumentFragment();
  for (let i = desde; i < hasta; i++) frag.appendChild(crearTarjetaCancion(i));
  $("#cuadriculaCanciones").appendChild(frag);

  const visibles = Math.min(hasta, CANCIONES.length);
  $("#contadorCanciones").textContent = `${visibles} de ${CANCIONES.length.toLocaleString("es")}`;
  $("#btnMasCanciones").classList.toggle("oculto", hasta >= CANCIONES.length);
  estado.paginaCanciones++;
}

function renderArtistas(reset = false) {
  if (reset) { estado.paginaArtistas = 1; $("#cuadriculaArtistas").innerHTML = ""; }
  const desde = (estado.paginaArtistas - 1) * PAGE_ARTISTAS;
  const hasta = Math.min(desde + PAGE_ARTISTAS, listaArtistas.length);
  const frag = document.createDocumentFragment();
  for (let i = desde; i < hasta; i++) {
    frag.appendChild(crearTarjetaArtista(listaArtistas[i][0], listaArtistas[i][1]));
  }
  $("#cuadriculaArtistas").appendChild(frag);

  $("#contadorArtistas").textContent = `${hasta} de ${listaArtistas.length.toLocaleString("es")}`;
  $("#btnMasArtistas").classList.toggle("oculto", hasta >= listaArtistas.length);
  estado.paginaArtistas++;
}

// Acceso rápido: primeras canciones
(function () {
  const cont = $("#cuadriculaRapida");
  [...Array(6).keys()].forEach((i) => {
    const c = CANCIONES[i];
    const t = document.createElement("div");
    t.className = "tarjeta-rapida";
    t.innerHTML = `
      <div class="portada-rapida"><img src="${c.portada}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-music'}))"></div>
      <span title="${c.nombre}">${c.nombre}</span>
      <button class="btn-play-mini"><i class="fa-solid fa-play"></i></button>
    `;
    t.addEventListener("click", (e) => {
      if (!e.target.closest(".btn-play-mini")) reproducirDesdeVista([i], 0);
    });
    t.querySelector(".btn-play-mini").addEventListener("click", (e) => {
      e.stopPropagation();
      const contexto = [...Array(Math.min(PAGE_CANCIONES, CANCIONES.length)).keys()];
      reproducirDesdeVista(contexto, i);
    });
    cont.appendChild(t);
  });
})();

$("#btnMasCanciones").addEventListener("click", () => renderCanciones());
$("#btnMasArtistas").addEventListener("click", () => renderArtistas());

// Banner me gusta
$("#bannerMeGusta").addEventListener("click", () => abrirPlaylistFavoritos());

// ── BÚSQUEDA ──

function actualizarBusqueda(consulta) {
  const texto = normalizar(consulta).trim();
  const resultadosArtistas = $("#cuadriculaArtistasResultados");
  const filasCanciones = $("#listaCancionesResultados");
  const bloqueArt = $("#bloqueArtistasResultados");
  const bloqueCan = $("#bloqueCancionesResultados");
  const mensajeVacio = $("#mensajeVacio");
  const titulo = $("#tituloResultados");

  if (texto === "") {
    titulo.textContent = "Explora todo";
    mensajeVacio.classList.add("oculto");
    bloqueArt.classList.add("oculto");
    bloqueCan.classList.add("oculto");
    estado.resultadosLista = [];
    return;
  }

  // Artistas cuyo nombre coincide (los exactos primero)
  const artistas = listaArtistas
    .filter(([nombre]) => normalizar(nombre).includes(texto))
    .sort((a, b) => (normalizar(a[0]) === texto ? 0 : 1) - (normalizar(b[0]) === texto ? 0 : 1));

  // TODAS las canciones de los artistas encontrados + canciones cuyo título coincide
  const conjunto = new Set();
  artistas.forEach(([, datos]) => datos.canciones.forEach((idx) => conjunto.add(idx)));
  CANCIONES.forEach((c, i) => {
    if (normalizar(c.nombre).includes(texto)) conjunto.add(i);
  });
  const canciones = [...conjunto];

  titulo.textContent = `Resultados para "${consulta}"`;

  // Artistas
  bloqueArt.classList.toggle("oculto", artistas.length === 0);
  resultadosArtistas.innerHTML = "";
  artistas.slice(0, 12).forEach(([nombre, datos]) =>
    resultadosArtistas.appendChild(crearTarjetaArtista(nombre, datos))
  );

  // Canciones: todas, cargadas por bloques
  bloqueCan.classList.toggle("oculto", canciones.length === 0);
  filasCanciones.innerHTML = "";
  estado.resultadosLista = canciones;
  estado.paginaResultados = 1;
  renderMasResultados();

  mensajeVacio.classList.toggle("oculto", canciones.length > 0 || artistas.length > 0);

  // Guardar contexto de búsqueda para reproducir
  contextoActual = canciones;
}

// Muestra el siguiente bloque de resultados (50 filas por vez)
function renderMasResultados() {
  const cont = $("#listaCancionesResultados");
  const lista = estado.resultadosLista;
  const desde = (estado.paginaResultados - 1) * PAGE_FILAS;
  const hasta = Math.min(desde + PAGE_FILAS, lista.length);

  const frag = document.createDocumentFragment();
  for (let i = desde; i < hasta; i++) {
    frag.appendChild(crearFilaCancion(lista[i], i + 1, lista));
  }
  cont.appendChild(frag);
  estado.paginaResultados++;

  const btn = $("#btnMasResultados");
  btn.classList.toggle("oculto", hasta >= lista.length);
  if (lista.length > hasta) {
    btn.textContent = `Cargar más (${lista.length - hasta} restantes)`;
  }
}

$("#btnMasResultados").addEventListener("click", renderMasResultados);

$("#inputBuscar").addEventListener("input", (e) => {
  actualizarBusqueda(e.target.value);
  if (e.target.value.trim() !== "") mostrarVista(vistaBuscar);
});

// ── DETALLE: playlist o artista ──

function abrirDetalle(config) {
  estado.detalleActual = config; // {tipo, titulo, sub, canciones, portada, grad, icono}
  estado.paginaDetalle = 1;
  estado.contextoNombre = config.titulo;

  $("#detalleTipo").textContent = config.tipo;
  $("#detalleTitulo").textContent = config.titulo;
  $("#detalleSub").textContent =
    `${config.canciones.length} canción${config.canciones.length === 1 ? "" : "es"}` +
    (config.tipo === "Artista" ? "" : " - Playlist");

  const portada = $("#detallePortada");
  portada.className = "portada-grande " + (config.grad || "");
  if (config.portada) {
    portada.innerHTML = `<img src="${config.portada}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-${config.icono || "music"}'}))">`;
  } else {
    portada.innerHTML = `<i class="fa-solid fa-${config.icono || "music"}"></i>`;
  }

  const corazon = $("#btnCorazonDetalle");
  corazon.style.display = config.tipo === "Artista" ? "none" : "";
  corazon.classList.remove("togglado");

  $("#btnEliminarLista").classList.toggle("oculto", !config.esPropia);

  renderFilasDetalle(true);
  mostrarVista(vistaDetalle);
}

function renderFilasDetalle(reset = false) {
  const cont = $("#listaCancionesDetalle");
  const canciones = estado.detalleActual.canciones;
  if (reset) { estado.paginaDetalle = 1; cont.innerHTML = ""; }
  const desde = (estado.paginaDetalle - 1) * PAGE_FILAS;
  const hasta = Math.min(desde + PAGE_FILAS, canciones.length);

  const frag = document.createDocumentFragment();
  for (let i = desde; i < hasta; i++) {
    const fila = crearFilaCancion(canciones[i], i + 1, canciones);
    fila.dataset.idx = canciones[i];
    frag.appendChild(fila);
  }
  cont.appendChild(frag);

  // Estado vacío para playlists propias sin canciones
  if (canciones.length === 0) {
    cont.innerHTML = `
      <div class="fila-vacia">
        <i class="fa-solid fa-plus"></i>
        <p>Playlist vacía</p>
        <span>Agrega canciones con el botón + de cualquier canción.</span>
      </div>`;
  }

  $("#btnMasDetalle").classList.toggle("oculto", hasta >= canciones.length);
  estado.paginaDetalle++;
  refrescarFilasSonando();
}

$("#btnMasDetalle").addEventListener("click", () => renderFilasDetalle());

$("#btnPlayDetalle").addEventListener("click", () => {
  const d = estado.detalleActual;
  if (!d || d.canciones.length === 0) return;
  if (estado.cancionActual !== null && d.canciones.includes(estado.cancionActual) && estado.reproduciendo) {
    audio.pause();
    marcarReproduciendo(false);
  } else if (estado.cancionActual !== null && d.canciones.includes(estado.cancionActual)) {
    reproducirAudio();
  } else {
    reproducirDesdeVista(d.canciones, 0);
  }
});

$("#btnCorazonDetalle").addEventListener("click", () => {
  $("#btnCorazonDetalle").classList.toggle("togglado");
  aviso("Lista guardada en tu biblioteca.");
});

function abrirArtista(nombre) {
  const datos = artistasMap.get(nombre);
  abrirDetalle({
    tipo: "Artista",
    titulo: nombre,
    canciones: datos.canciones,
    portada: datos.portada,
    icono: "user",
    grad: "grad-rojo-1",
  });
}

function abrirPlaylistFavoritos() {
  const favs = [...estado.favoritos].filter((i) => i < CANCIONES.length);
  abrirDetalle({
    tipo: "Playlist",
    titulo: "Tus me gusta",
    canciones: favs,
    portada: null,
    icono: favs.length > 0 ? "music" : "heart",
    grad: favs.length > 0 ? "" : "grad-rojo-1",
  });
}

// ── BIBLIOTECA LATERAL ──

function renderBiblioteca() {
  const cont = $("#listaBiblioteca");
  const items = [];

  items.push({ nombre: "Tus me gusta", detalle: `Playlist - ${estado.favoritos.size} canciones`, icono: "fa-heart", grad: "mini-rojo", abrir: abrirPlaylistFavoritos });

  // Playlists creadas por el usuario
  listasPropias.forEach((lista) => {
    items.push({
      nombre: lista.nombre,
      detalle: `Playlist - ${lista.canciones.length} canciones`,
      icono: "fa-list-ul",
      grad: "mini-rojo",
      abrir: () => abrirPlaylistPropia(lista),
    });
  });

  // Mixtore Rojo: mezcla aleatoria fija de 30 canciones
  const mixtore = mezclar([...Array(CANCIONES.length).keys()]).slice(0, 30);
  items.push({
    nombre: "Mixtore Rojo",
    detalle: `Playlist - ${mixtore.length} canciones`,
    icono: "fa-shuffle",
    grad: "mini-oscuro",
    abrir: () => abrirDetalle({ tipo: "Playlist", titulo: "Mixtore Rojo", canciones: mixtore, portada: CANCIONES[mixtore[0]].portada, icono: "shuffle", grad: "" }),
  });

  // Top artistas (los que más canciones tienen)
  const top = listaArtistas.slice().sort((a, b) => b[1].canciones.length - a[1].canciones.length).slice(0, 12);
  top.forEach(([nombre, datos]) => {
    items.push({
      nombre,
      detalle: `Artista - ${datos.canciones.length} canciones`,
      icono: "fa-user",
      grad: "mini-gris",
      circulo: true,
      abrir: () => abrirArtista(nombre),
    });
  });

  cont.innerHTML = "";
  items.forEach((it) => {
    const el = document.createElement("div");
    el.className = "playlist-item";
    el.innerHTML = `
      <div class="miniatura ${it.grad}${it.circulo ? " mini-circulo" : ""}"><i class="fa-solid ${it.icono}"></i></div>
      <div class="info-playlist">
        <span class="nombre" title="${it.nombre}">${it.nombre}</span>
        <span class="detalle">${it.detalle}</span>
      </div>`;
    el.addEventListener("click", it.abrir);
    cont.appendChild(el);
  });
}

// ── SIDEBAR ──

$("#btnColapsarBiblio").addEventListener("click", (e) => {
  e.preventDefault();
  $("#barraLateral").classList.add("colapsada");
});
$("#btnMostrarSidebar").addEventListener("click", () => $("#barraLateral").classList.remove("colapsada"));

// ── COLOR DE FONDO SEGÚN LA PORTADA ──

const cacheColores = new Map(); // url portada → "r,g,b"

function extraerColorPortada(url) {
  if (!url) return;
  if (cacheColores.has(url)) {
    aplicarFondoNP(cacheColores.get(url));
    return;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const lado = 32;
      const canvas = document.createElement("canvas");
      canvas.width = lado;
      canvas.height = lado;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, lado, lado);
      const datos = ctx.getImageData(0, 0, lado, lado).data;

      let r = 0, g = 0, b = 0, cuenta = 0, minSat = 0.30;
      // Primera pasada con saturación alta; si no hay suficientes, relajamos
      while (cuenta < 24 && minSat >= 0) {
        r = g = b = 0; cuenta = 0;
        for (let i = 0; i < datos.length; i += 4) {
          const pr = datos[i], pg = datos[i + 1], pb = datos[i + 2];
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          const sat = max === 0 ? 0 : (max - min) / max;
          const brillo = max / 255;
          if (sat >= minSat && brillo >= 0.15 && brillo <= 0.85) {
            r += pr; g += pg; b += pb; cuenta++;
          }
        }
        minSat -= 0.1;
      }

      if (cuenta === 0) return; // portada en grises: conservar rojo por defecto

      const color = [Math.round(r / cuenta), Math.round(g / cuenta), Math.round(b / cuenta)];
      cacheColores.set(url, color);
      aplicarFondoNP(color);
    } catch (e) {
      // Sin permiso CORS: conservar el fondo por defecto
    }
  };
  img.src = url;
}

function aplicarFondoNP([r, g, b]) {
  const oscuro = (f) => `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
  $("#npFondo").style.background =
    `linear-gradient(165deg, ${oscuro(0.9)} 0%, ${oscuro(0.55)} 45%, ${oscuro(0.22)} 100%)`;
}

// ── VISTA NOW PLAYING (pantalla de portada en grande) ──

function actualizarNowPlaying() {
  if (estado.cancionActual === null) return;
  const c = CANCIONES[estado.cancionActual];

  // Si la canción tiene video (canvas), se muestra en loop; si no, la portada
  if (c.video) {
    $("#npPortada").innerHTML =
      `<video src="${c.video}" autoplay loop muted playsinline ` +
      `onerror="this.replaceWith(Object.assign(document.createElement('img'),{src:'${c.portada}'}))"></video>`;
  } else {
    $("#npPortada").innerHTML =
      `<img src="${c.portada}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-music'}))">`;
  }
  extraerColorPortada(c.portada);
  $("#npTitulo").textContent = c.nombre;
  $("#npArtista").textContent = c.artista;
  $("#npContexto").textContent = "Reproduciendo de " + (estado.contextoNombre || "tu música");
  $("#npRelleno").style.width = "0%";
  $("#npTiempoActual").textContent = "0:00";
  $("#npTiempoTotal").textContent = "0:00";

  const activo = esFavorito(estado.cancionActual);
  const corazon = $("#npCorazon");
  corazon.classList.toggle("activo", activo);
  corazon.querySelector("i").className = activo ? "fa-solid fa-heart" : "fa-regular fa-heart";

  // Si el panel de letras está abierto, cargar la letra de la nueva canción
  if (!$("#npPanelLetras").classList.contains("oculto")) {
    cargarLetras(estado.cancionActual);
  }
}

function alternarNowPlaying() {
  const vista = $("#vistaNowPlaying");
  const abierta = vista.classList.toggle("oculto") === false;
  document.body.classList.toggle("np-abierto", abierta);
}

// Clic en la portada del reproductor → abre la vista grande
$("#portadaActual").addEventListener("click", () => {
  if (estado.cancionActual === null) {
    aviso("Reproduce una canción primero.");
    return;
  }
  alternarNowPlaying();
});

$("#btnCerrarNP").addEventListener("click", alternarNowPlaying);

// Corazón y controles sincronizados con la barra inferior
$("#npCorazon").addEventListener("click", () => {
  if (estado.cancionActual === null) return;
  alternarFavorito(estado.cancionActual);
  const activo = esFavorito(estado.cancionActual);
  $("#npCorazon").classList.toggle("activo", activo);
  $("#npCorazon").querySelector("i").className = activo ? "fa-solid fa-heart" : "fa-regular fa-heart";
});

$("#npPlay").addEventListener("click", () => $("#btnPlay").click());
$("#npAnterior").addEventListener("click", anteriorCancion);
$("#npSiguiente").addEventListener("click", () => siguienteCancion(false));

function sincronizarTogglado(btnA, btnB) {
  btnB.classList.toggle("togglado", btnA.classList.contains("togglado"));
  btnB.style.color = btnA.classList.contains("togglado") ? "var(--rojo-hover)" : "";
}

$("#npAleatorio").addEventListener("click", () => {
  $("#btnAleatorio").click();
  sincronizarTogglado($("#btnAleatorio"), $("#npAleatorio"));
});

$("#npRepetir").addEventListener("click", () => {
  $("#btnRepetir").click();
  sincronizarTogglado($("#btnRepetir"), $("#npRepetir"));
});

// Buscar tiempo en la vista grande
$("#npPista").addEventListener("click", (e) => {
  if (!isFinite(audio.duration) || audio.duration <= 0) return;
  const rect = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

// Tecla Escape cierra la vista
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const np = $("#vistaNowPlaying");
    if (!np.classList.contains("oculto")) alternarNowPlaying();
  }
});

// ── LETRAS DE CANCIONES (sincronizadas, estilo Spotify) ──

const cacheLetras = new Map(); // idx → {tipo, lineas} | null
let letraActual = null;        // {idx, datos, lineaActiva}

function candidatosLetras(c) {
  // Los artistas vienen como "BLESSD JAY WHEELER ..." — probamos combinaciones
  const palabras = (c.artista || "").trim().split(/\s+/).filter(Boolean);
  const artistas = [];
  if (palabras.length > 0) {
    artistas.push(palabras.join(" "));
    if (palabras.length > 2) artistas.push(palabras.slice(0, 2).join(" "));
    artistas.push(palabras[0]);
  }

  // El título puede traer "FEAT ..." — probamos también el título recortado
  const tituloRecortado = (c.nombre || "").split(/\s+(?:FEAT|FT|X|CON|W\/|WITH)\s+/i)[0].trim();
  const titulos = [...new Set([(c.nombre || "").trim(), tituloRecortado].filter(Boolean))];

  const combos = [];
  externo: for (const a of artistas) {
    for (const t of titulos) {
      combos.push([a, t]);
      if (combos.length >= 6) break externo;
    }
  }
  return combos;
}

function parseLRC(texto) {
  return texto
    .split(/\r?\n/)
    .map((linea) => {
      const m = linea.match(/^\s*\[(\d+):(\d+)(?:[.:](\d+))?\]\s*(.*)$/);
      if (!m) return null;
      const fraccion = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
      const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + fraccion;
      return { t, texto: m[4].trim() };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

// LRCLIB: letras con marcas de tiempo (como Spotify)
async function pedirLrclib(artista, titulo) {
  const url =
    `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artista)}` +
    `&track_name=${encodeURIComponent(titulo)}`;
  const respuesta = await fetch(url);
  if (!respuesta.ok) return null;
  const resultados = await respuesta.json();
  if (!Array.isArray(resultados) || resultados.length === 0) return null;

  const conSync = resultados.find((r) => r.syncedLyrics);
  if (conSync) {
    const lineas = parseLRC(conSync.syncedLyrics);
    if (lineas.length > 0) return { tipo: "sincronizada", lineas };
  }
  const plano = resultados.find((r) => r.plainLyrics);
  if (plano && plano.plainLyrics) {
    return {
      tipo: "plana",
      lineas: plano.plainLyrics.trim().split(/\n+/).map((t) => ({ texto: t.trim() })),
    };
  }
  return null;
}

// lyrics.ovh: respaldo con letras planas
async function pedirLyricsOvh(artista, titulo) {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artista)}/${encodeURIComponent(titulo)}`;
  const respuesta = await fetch(url);
  if (!respuesta.ok) return null;
  const json = await respuesta.json();
  const letra = (json.lyrics || "").trim();
  if (!letra) return null;
  return {
    tipo: "plana",
    lineas: letra.split(/\n+/).map((t) => ({ texto: t.trim() })),
  };
}

async function cargarLetras(idx) {
  const cont = $("#letrasContenido");
  if (idx === null || idx === undefined) return;

  if (cacheLetras.has(idx)) {
    renderLetra(idx);
    return;
  }

  cont.innerHTML = `
    <div class="letras-estado">
      <div class="spinner"></div>
      Buscando letra...
      <span class="sub">Puede tomar unos segundos</span>
    </div>`;

  const c = CANCIONES[idx];
  for (const [artista, titulo] of candidatosLetras(c)) {
    try {
      const datos = await pedirLrclib(artista, titulo);
      if (datos) {
        cacheLetras.set(idx, datos);
        if (estado.cancionActual === idx) renderLetra(idx);
        return;
      }
    } catch (e) { /* siguiente candidato */ }
  }
  for (const [artista, titulo] of candidatosLetras(c)) {
    try {
      const datos = await pedirLyricsOvh(artista, titulo);
      if (datos) {
        cacheLetras.set(idx, datos);
        if (estado.cancionActual === idx) renderLetra(idx);
        return;
      }
    } catch (e) { /* siguiente candidato */ }
  }

  cacheLetras.set(idx, null);
  if (estado.cancionActual === idx) renderLetra(idx);
}

function renderLetra(idx) {
  const cont = $("#letrasContenido");
  const datos = cacheLetras.get(idx);
  const c = CANCIONES[idx];
  letraActual = null;

  if (!datos || datos.lineas.length === 0) {
    cont.innerHTML = `
      <div class="letras-estado">
        <i class="fa-solid fa-microphone-slash" style="font-size:32px; color: var(--texto-gris-oscuro);"></i>
        <span>No encontramos la letra de esta canción</span>
        <span class="sub">"${c.nombre}" - ${c.artista}</span>
      </div>`;
    return;
  }

  cont.innerHTML = "";
  cont.scrollTop = 0;
  const sincronizada = datos.tipo === "sincronizada";

  datos.lineas.forEach((l, i) => {
    const div = document.createElement("div");
    div.className = "letra-linea";
    div.textContent = l.texto === "" ? "\u266A" : l.texto;

    div.addEventListener("click", () => {
      if (sincronizada) {
        audio.currentTime = l.t;
      } else if (isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (i / datos.lineas.length) * audio.duration;
      }
      if (!estado.reproduciendo) reproducirAudio();
    });

    cont.appendChild(div);
  });

  letraActual = { idx, datos, lineaActiva: -1 };
  actualizarLetraTiempo(true);
}

function actualizarLetraTiempo(forzar = false) {
  if (!letraActual || letraActual.idx !== estado.cancionActual) return;
  const cont = $("#letrasContenido");
  const lineas = cont.querySelectorAll(".letra-linea");
  if (lineas.length === 0) return;

  let nuevo = -1;

  if (letraActual.datos.tipo === "sincronizada") {
    const t = audio.currentTime + 0.2; // pequeño adelanto visual
    for (let i = 0; i < letraActual.datos.lineas.length; i++) {
      if (letraActual.datos.lineas[i].t <= t) nuevo = i;
      else break;
    }
  } else {
    // Letra plana: resaltado estimado repartiendo la duración entre las líneas
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    nuevo = Math.min(
      lineas.length - 1,
      Math.floor((audio.currentTime / audio.duration) * lineas.length)
    );
  }

  if (nuevo === letraActual.lineaActiva && !forzar) return;

  lineas.forEach((el, i) => el.classList.toggle("activa", i === nuevo));
  letraActual.lineaActiva = nuevo;

  const activa = lineas[nuevo];
  if (activa) {
    const objetivo = activa.offsetTop - cont.clientHeight / 2 + activa.clientHeight / 2;
    cont.scrollTo({ top: Math.max(0, objetivo), behavior: "smooth" });
  }
}

$("#npBtnLetras").addEventListener("click", () => {
  const panel = $("#npPanelLetras");
  panel.classList.toggle("oculto");
  if (!panel.classList.contains("oculto") && estado.cancionActual !== null) {
    cargarLetras(estado.cancionActual);
  }
});

$("#btnCerrarLetras").addEventListener("click", () => {
  $("#npPanelLetras").classList.add("oculto");
});

// ── ALMACENAMIENTO SIN INTERNET (IndexedDB, aguanta MP3 grandes) ──

const DB_NOMBRE = "rojoOffline";

function abrirDB() {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(DB_NOMBRE, 1);
    peticion.onupgradeneeded = () => {
      peticion.result.createObjectStore("canciones");
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

async function idbGuardar(clave, blob) {
  const db = await abrirDB();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction("canciones", "readwrite");
    tx.objectStore("canciones").put(blob, clave);
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
  });
}

async function idbLeer(clave) {
  const db = await abrirDB();
  return new Promise((resolver) => {
    const tx = db.transaction("canciones", "readonly");
    const pedido = tx.objectStore("canciones").get(clave);
    pedido.onsuccess = () => resolver(pedido.result || null);
    pedido.onerror = () => resolver(null);
  });
}

async function idbEliminar(clave) {
  const db = await abrirDB();
  return new Promise((resolver) => {
    const tx = db.transaction("canciones", "readwrite");
    tx.objectStore("canciones").delete(clave);
    tx.oncomplete = () => resolver();
    tx.onerror = () => resolver();
  });
}

async function idbClaves() {
  const db = await abrirDB();
  return new Promise((resolver) => {
    const tx = db.transaction("canciones", "readonly");
    const pedido = tx.objectStore("canciones").getAllKeys();
    pedido.onsuccess = () => resolver(pedido.result || []);
    pedido.onerror = () => resolver([]);
  });
}

// Devuelve la copia local si existe; si no, la URL de Cloudinary
let urlBlobActual = null;

async function resolverFuente(idx) {
  if (estado.descargas.has(idx)) {
    try {
      const blob = await idbLeer(idx);
      if (blob) {
        if (urlBlobActual) URL.revokeObjectURL(urlBlobActual);
        urlBlobActual = URL.createObjectURL(blob);
        return urlBlobActual;
      }
    } catch (e) { /* cae a la red */ }
  }
  return CANCIONES[idx].archivo;
}

async function descargarCancion(idx) {
  if (idx === null || idx === undefined) return;
  if (estado.descargas.has(idx)) {
    aviso("Esta canción ya está guardada para sin internet.");
    return;
  }
  const c = CANCIONES[idx];
  aviso("Descargando... puede tardar unos segundos.");
  try {
    const respuesta = await fetch(c.archivo);
    if (!respuesta.ok) throw new Error("HTTP " + respuesta.status);
    const blob = await respuesta.blob();
    await idbGuardar(idx, blob);
    estado.descargas.add(idx);
    aviso("Guardada: ya puedes escucharla sin internet.");
    actualizarBotonDescarga();
  } catch (e) {
    aviso("No se pudo descargar. Revisa tu conexión.");
  }
}

async function quitarDescarga(idx) {
  await idbEliminar(idx);
  estado.descargas.delete(idx);
  aviso("Descarga eliminada.");
  actualizarBotonDescarga();
}

function actualizarBotonDescarga() {
  const btn = $("#npBtnDescargar");
  if (!btn) return;
  const descargada = estado.cancionActual !== null && estado.descargas.has(estado.cancionActual);
  btn.classList.toggle("descargado", descargada);
  btn.title = descargada ? "Quitar descarga" : "Guardar para escuchar sin internet";
  btn.querySelector("i").className = descargada ? "fa-solid fa-circle-check" : "fa-solid fa-circle-down";
}

// ── PLAYLISTS PROPIAS ──

function cargarPlaylists() {
  try { return JSON.parse(localStorage.getItem("rojoPlaylists") || "[]"); }
  catch (e) { return []; }
}

function guardarPlaylists() {
  localStorage.setItem("rojoPlaylists", JSON.stringify(listasPropias));
}

let listasPropias = cargarPlaylists();

function crearPlaylist(nombre) {
  const lista = {
    id: Date.now() + Math.random().toString(16).slice(2),
    nombre,
    canciones: [],
  };
  listasPropias.push(lista);
  guardarPlaylists();
  renderBiblioteca();
  return lista;
}

function crearPlaylistCon(idx) {
  abrirModal({
    titulo: "Nueva playlist",
    textoBoton: "Crear",
    placeholder: "Nombre de la playlist",
    alAceptar: (nombre) => {
      const lista = crearPlaylist(nombre);
      lista.canciones.push(idx);
      guardarPlaylists();
      renderBiblioteca();
      aviso(`Agregada a "${lista.nombre}".`);
    },
  });
}

function agregarAPlaylist(idx, id) {
  const lista = listasPropias.find((l) => l.id === id);
  if (!lista) return;
  if (lista.canciones.includes(idx)) {
    aviso("Esa canción ya está en la playlist.");
    return;
  }
  lista.canciones.push(idx);
  guardarPlaylists();
  renderBiblioteca();
  aviso(`Agregada a "${lista.nombre}".`);
  if (estado.detalleActual && estado.detalleActual.esPropia && estado.detalleActual.id === id) {
    estado.detalleActual.canciones = [...lista.canciones];
    renderFilasDetalle(true);
  }
}

function eliminarPlaylist(id) {
  abrirModal({
    titulo: "¿Eliminar esta playlist?",
    input: false,
    textoBoton: "Eliminar",
    alAceptar: () => {
      listasPropias = listasPropias.filter((l) => l.id !== id);
      guardarPlaylists();
      renderBiblioteca();
      aviso("Playlist eliminada.");
      mostrarVista(vistaInicio);
    },
  });
}

function abrirPlaylistPropia(lista) {
  abrirDetalle({
    tipo: "Playlist",
    titulo: lista.nombre,
    canciones: [...lista.canciones],
    portada: lista.canciones.length ? CANCIONES[lista.canciones[0]].portada : null,
    icono: "list-ul",
    grad: lista.canciones.length ? "" : "grad-rojo-1",
    esPropia: true,
    id: lista.id,
  });
}

// ── MENÚ FLOTANTE (por canción) ──

function cerrarMenuFlotante() {
  const menu = document.getElementById("menuFlotante");
  if (menu) menu.remove();
}

function abrirMenuCancion(idx, x, y) {
  cerrarMenuFlotante();

  const menu = document.createElement("div");
  menu.id = "menuFlotante";
  menu.className = "menu-flotante";
  menu.innerHTML = `<div class="menu-titulo" title="${CANCIONES[idx].nombre}">${CANCIONES[idx].nombre}</div>`;

  listasPropias.forEach((lista) => {
    const item = document.createElement("button");
    item.className = "menu-item";
    item.innerHTML = `<i class="fa-solid fa-list-ul"></i><span>Agregar a ${lista.nombre}</span>`;
    item.addEventListener("click", () => {
      cerrarMenuFlotante();
      agregarAPlaylist(idx, lista.id);
    });
    menu.appendChild(item);
  });

  const nueva = document.createElement("button");
  nueva.className = "menu-item";
  nueva.innerHTML = `<i class="fa-solid fa-plus"></i><span>Nueva playlist...</span>`;
  nueva.addEventListener("click", () => {
    cerrarMenuFlotante();
    crearPlaylistCon(idx);
  });
  menu.appendChild(nueva);

  const desc = document.createElement("button");
  desc.className = "menu-item" + (estado.descargas.has(idx) ? " deshabilitado" : "");
  desc.innerHTML = estado.descargas.has(idx)
    ? `<i class="fa-solid fa-circle-check"></i><span>Guardada para sin internet</span>`
    : `<i class="fa-solid fa-circle-down"></i><span>Guardar para sin internet</span>`;
  if (!estado.descargas.has(idx)) {
    desc.addEventListener("click", async () => {
      cerrarMenuFlotante();
      await descargarCancion(idx);
    });
  }
  menu.appendChild(desc);

  document.body.appendChild(menu);

  // Posicionar sin que se salga de la pantalla
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(12, Math.min(x, window.innerWidth - rect.width - 12)) + "px";
  menu.style.top = Math.max(12, Math.min(y, window.innerHeight - rect.height - 12)) + "px";
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#menuFlotante")) cerrarMenuFlotante();
});

// ── MODAL ──

function abrirModal({ titulo, input = true, textoBoton = "Aceptar", placeholder = "", alAceptar }) {
  const fondo = $("#modalFondo");
  $("#modalTitulo").textContent = titulo;
  const inp = $("#modalInput");
  inp.style.display = input ? "" : "none";
  inp.value = "";
  inp.placeholder = placeholder;
  $("#modalAceptar").textContent = textoBoton;
  fondo.classList.remove("oculto");
  if (input) { inp.focus(); }

  const cerrar = () => {
    fondo.classList.add("oculto");
    $("#modalAceptar").onclick = null;
    $("#modalCancelar").onclick = null;
    fondo.onclick = null;
    inp.onkeydown = null;
  };
  const aceptar = () => {
    const valor = inp.value.trim();
    if (input && !valor) { inp.focus(); return; }
    cerrar();
    if (alAceptar) alAceptar(valor);
  };

  $("#modalAceptar").onclick = aceptar;
  $("#modalCancelar").onclick = cerrar;
  fondo.onclick = (e) => { if (e.target === fondo) cerrar(); };
  inp.onkeydown = (e) => {
    if (e.key === "Enter") aceptar();
    if (e.key === "Escape") cerrar();
  };
}

// Botones de playlist y descarga en la vista grande
$("#npBtnPlaylist").addEventListener("click", (e) => {
  e.stopPropagation(); // evita que el clic del documento cierre el menú al instante
  if (estado.cancionActual === null) {
    aviso("Reproduce una canción primero.");
    return;
  }
  const rect = e.currentTarget.getBoundingClientRect();
  abrirMenuCancion(estado.cancionActual, rect.left - 240, rect.bottom + 10);
});

$("#npBtnDescargar").addEventListener("click", () => {
  if (estado.cancionActual === null) {
    aviso("Reproduce una canción primero.");
    return;
  }
  if (estado.descargas.has(estado.cancionActual)) {
    quitarDescarga(estado.cancionActual);
  } else {
    descargarCancion(estado.cancionActual);
  }
});

$("#btnEliminarLista").addEventListener("click", () => {
  if (estado.detalleActual && estado.detalleActual.esPropia) {
    eliminarPlaylist(estado.detalleActual.id);
  }
});

// ── ARRANQUE ──

renderCanciones(true);
renderArtistas(true);
renderBiblioteca();
actualizarBannerMeGusta();
actualizarIconoVolumen();

// Cargar el listado de canciones descargadas
idbClaves()
  .then((claves) => { estado.descargas = new Set(claves); })
  .catch(() => { /* sin almacenamiento disponible */ });

// Avisos de conexión
window.addEventListener("offline", () => {
  aviso("Sin internet: se reproducirán las canciones guardadas.");
});
window.addEventListener("online", () => {
  aviso("Conexión restablecida.");
});
