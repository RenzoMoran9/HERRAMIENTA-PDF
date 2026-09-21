/* ===========================================================
   Grapa · Editor de texto
   Todo ocurre dentro del navegador: el documento no sale del
   equipo, no hay servidor y no hace falta internet.
   =========================================================== */

/*IMPORTA*/ import { PDFDocument, Font, Buffer, Matrix, ColorSpace, Pixmap, Image } from '../lib/mupdf.js';
/*IMPORTA-RECONOCER*/ import { reconocer } from './ocr.js';

const $ = (s) => document.querySelector(s);
const $$ = (s, d) => [...(d || document).querySelectorAll(s)];

/* ---------- estado ---------- */
let doc = null;             // documento abierto
let bytesActuales = null;   // sus bytes, siempre al día
let nombre = 'documento.pdf';
let paginaActual = 0;
let totalPaginas = 0;
let escala = 1.2;
let renglones = [];         // los del folio que se está viendo
let pila = [];              // para deshacer: { bytes, nombre, resumen }
let cambios = [];           // lo que se le muestra al usuario
let contadorFuente = 0;
let grapa = null;           // la ventana de Grapa, si vino de allí
const reconocidos = new Map();  // lo que dijo el OCR, por hoja

/* ---------- utilidades de pantalla ---------- */
function avisar(texto, tipo) {
  const d = document.createElement('div');
  d.className = 'aviso' + (tipo ? ' ' + tipo : '');
  d.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${
    tipo === 'mal' ? 'aviso' : 'check'}"/></svg><span></span>`;
  d.querySelector('span').textContent = texto;
  $('#avisos').appendChild(d);
  setTimeout(() => d.remove(), tipo === 'mal' ? 7000 : 3800);
}

function cargando(si, texto) {
  $('#capaCarga').hidden = !si;
  if (texto) $('#cargaTexto').textContent = texto;
}

/* ---------- geometría de la hoja ----------
   El texto estructurado mide desde ARRIBA y en el sistema ya
   enderezado de la página; el flujo del PDF mide desde ABAJO y
   en el sistema crudo, que puede estar desplazado por MediaBox. */
function marcoDe(pagina) {
  const lim = pagina.getBounds();
  let mx0 = 0, my0 = 0, mx1 = lim[2] - lim[0], my1 = lim[3] - lim[1], giro = 0;
  try {
    const obj = pagina.getObject();
    const mb = obj.get('MediaBox');
    if (mb && mb.isArray() && mb.length === 4) {
      const v = [0, 1, 2, 3].map((i) => mb.get(i).asNumber());
      mx0 = Math.min(v[0], v[2]); mx1 = Math.max(v[0], v[2]);
      my0 = Math.min(v[1], v[3]); my1 = Math.max(v[1], v[3]);
    }
    const rot = obj.get('Rotate');
    if (rot && rot.isNumber()) giro = ((rot.asNumber() % 360) + 360) % 360;
  } catch (e) { /* nos quedamos con los límites de la página */ }
  return { x0: mx0, y1: my1, mx0, my0, mx1, my1, giro,
           ancho: lim[2] - lim[0], alto: lim[3] - lim[1] };
}

/* ---------- hojas giradas ----------

   Una hoja puede llevar dentro la orden de mostrarse girada (`/Rotate`), y
   los escaneos la llevan continuamente. Por dentro el papel sigue como
   estaba: lo que cambia es cómo se enseña.

   Todo lo que el editor mide —los renglones, los recuadros, la foto— viene
   ya en el sistema de lo que se VE: desde la esquina de arriba a la
   izquierda y hacia abajo. Para escribir en el archivo hay que llevarlo al
   sistema del papel, que va desde abajo y sin girar. Eso es lo único que
   hacen estas dos cosas.

   `puntoEnHoja` lleva un punto de lo que se ve al papel; `GIRO_TM` da la
   matriz que hay que ponerle al texto para que, una vez girada la hoja
   para enseñarla, se lea derecho. */
function puntoEnHoja(marco, dx, dy) {
  const { mx0, my0, mx1, my1, giro } = marco;
  if (giro === 90) return [mx0 + dy, my0 + dx];
  if (giro === 180) return [mx1 - dx, my0 + dy];
  if (giro === 270) return [mx1 - dy, my1 - dx];
  return [mx0 + dx, my1 - dy];
}

const GIRO_TM = { 0: [1, 0, 0, 1], 90: [0, 1, -1, 0], 180: [-1, 0, 0, -1], 270: [0, -1, 1, 0] };

/** El principio de un «Tm»: la matriz del giro y el punto, ya en el papel. */
function matrizTexto(marco, dx, dy) {
  const m = GIRO_TM[marco.giro] || GIRO_TM[0];
  const p = puntoEnHoja(marco, dx, dy);
  return m.join(' ') + ' ' + p[0].toFixed(3) + ' ' + p[1].toFixed(3) + ' Tm';
}

/** Un rectángulo de lo que se ve, puesto en el papel. Como los giros son de
 *  noventa en noventa, sigue siendo un rectángulo recto: basta con las dos
 *  esquinas opuestas. */
function rectanguloEnHoja(marco, dx, dy, an, al) {
  const a = puntoEnHoja(marco, dx, dy);
  const b = puntoEnHoja(marco, dx + an, dy + al);
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  return x.toFixed(2) + ' ' + y.toFixed(2) + ' '
    + Math.abs(b[0] - a[0]).toFixed(2) + ' ' + Math.abs(b[1] - a[1]).toFixed(2) + ' re';
}

/** El «cm» que pone una imagen justo en ese trozo de lo que se ve. La
 *  imagen se dibuja en el cuadrado unidad con su fila de arriba en y=1, así
 *  que las tres esquinas se sacan de ahí. */
function matrizImagen(marco, dx, dy, an, al) {
  const o = puntoEnHoja(marco, dx, dy + al);          // abajo a la izquierda
  const d = puntoEnHoja(marco, dx + an, dy + al);     // abajo a la derecha
  const a = puntoEnHoja(marco, dx, dy);               // arriba a la izquierda
  return [d[0] - o[0], d[1] - o[1], a[0] - o[0], a[1] - o[1], o[0], o[1]]
    .map((v) => v.toFixed(3)).join(' ') + ' cm';
}

/** Los giros que sabemos escribir son los de noventa en noventa. */
function giroRaro(marco) {
  return marco.giro % 90 !== 0
    ? 'Esta hoja está girada ' + marco.giro + '°, que no es un giro de los normales; el editor no sabe escribir ahí.'
    : '';
}

/* ---------- ¿esta hoja lleva texto reconocido? ----------
   Al reconocer una hoja se le deja una marca dentro, para saberlo también
   la próxima vez que se abra el archivo. El texto reconocido se puede
   buscar y copiar, pero no corregir: la foto seguiría diciendo lo de
   antes, y el documento mostraría una cosa y copiaría otra. */
function llevaOCR(pagina) {
  return !!modeloDe(pagina);
}

/* ---------- leer los renglones de una hoja ---------- */
function leerRenglones(pagina) {
  const st = pagina.toStructuredText('preserve-whitespace');
  const salida = [];
  let act = null;
  st.walk({
    beginLine(bbox) { act = { bbox, letras: [] }; },
    onChar(c, origin, font, size, quad, color) {
      if (!act) return;
      act.letras.push({
        c, x: origin[0], y: origin[1], size, color,
        fuente: font.getName(),
        // por si el nombre no sirve para nada: con esto se elige bien la equivalente
        rasgos: { negrita: font.isBold(), cursiva: font.isItalic(),
                  serif: font.isSerif(), mono: font.isMono() },
      });
    },
    endLine() {
      if (act && act.letras.length) {
        const l = act.letras;
        const texto = l.map((k) => k.c).join('');
        if (texto.trim()) {
          salida.push({
            texto,
            bbox: act.bbox,
            x: l[0].x,
            y: l[0].y,
            fuente: l[0].fuente,
            rasgos: l[0].rasgos,
            size: l[0].size,
            color: l[0].color,
            // una sola fuente y un solo tamaño en todo el renglón: se puede
            // reescribir de una vez sin perder nada
            uniforme: l.every((k) => k.fuente === l[0].fuente && Math.abs(k.size - l[0].size) < 0.01),
          });
        }
      }
      act = null;
    },
  });
  return salida;
}

/* ---------- elegir con qué tipografía se escribe ----------
   Un PDF incrusta la tipografía en subconjunto y le pone delante seis
   letras y un «+»: «BAAAAA+ArialMT». Y lo que queda suele ser el nombre
   comercial —ArialMT, LiberationSans, Calibri—, no una de las catorce que
   todo lector de PDF trae de serie, que son las únicas que se pueden pedir
   por nombre. Hay que traducirlo, o no se puede escribir nada. */
const PREFIJO_SUBCONJUNTO = /^[A-Z]{6}\+/;

function familiaDe(nombre, rasgos) {
  const n = String(nombre || '').replace(PREFIJO_SUBCONJUNTO, '').toLowerCase();
  const r = rasgos || {};
  if (r.mono || /courier|mono|consolas/.test(n)) return 'Courier';
  if (!/sans/.test(n) && /times|serif|georgia|cambria|garamond|book|roman/.test(n)) return 'Times';
  if (/arial|helvetica|sans|calibri|verdana|tahoma|segoe|roboto|liberation/.test(n)) return 'Helvetica';
  if (r.serif) return 'Times';
  return 'Helvetica';
}

function nombreDeSerie(familia, negrita, cursiva) {
  if (familia === 'Times') {
    if (negrita && cursiva) return 'Times-BoldItalic';
    if (negrita) return 'Times-Bold';
    if (cursiva) return 'Times-Italic';
    return 'Times-Roman';
  }
  const cola = negrita && cursiva ? '-BoldOblique' : negrita ? '-Bold' : cursiva ? '-Oblique' : '';
  return familia + cola;
}

/** Devuelve { fuente, nombre, sustituida } y nunca falla. */
function resolverFuente(nombre, rasgos) {
  // 1. tal cual: hay PDF que usan directamente una de las de serie
  try { return { fuente: new Font(nombre), nombre, sustituida: false }; } catch (e) {}
  // 2. sin el prefijo de subconjunto
  const pelado = String(nombre || '').replace(PREFIJO_SUBCONJUNTO, '');
  if (pelado && pelado !== nombre) {
    try { return { fuente: new Font(pelado), nombre: pelado, sustituida: false }; } catch (e) {}
  }
  // 3. la equivalente de serie, con su mismo peso y su misma inclinación
  const r = rasgos || {};
  const negrita = r.negrita || /bold|black|heavy|semibold/i.test(pelado);
  const cursiva = r.cursiva || /italic|oblique/i.test(pelado);
  const equivale = nombreDeSerie(familiaDe(nombre, r), negrita, cursiva);
  try { return { fuente: new Font(equivale), nombre: equivale, sustituida: true }; } catch (e) {}
  // 4. lo más neutro que existe
  return { fuente: new Font('Helvetica'), nombre: 'Helvetica', sustituida: true };
}

/* ---------- medir el ancho que ocupará un texto ---------- */
function medirAncho(fuente, texto, tam) {
  let suma = 0;
  for (const c of texto) {
    try { suma += fuente.advanceGlyph(fuente.encodeCharacter(c)); }
    catch (e) { suma += 0.5; }
  }
  return suma * tam;
}

/* ---------- sacar los bytes del documento ----------
   `asUint8Array()` no devuelve una copia: devuelve una VENTANA a la memoria
   del motor. En cuanto algo reserva memoria después —volver a abrir el
   documento, por ejemplo— esos bytes se pisan, y el PDF sale con la cabecera
   destrozada. Hay que copiarlos en el acto. */
function bytesDe(documento) {
  const buf = documento.saveToBuffer('');
  const copia = new Uint8Array(buf.asUint8Array());   // el constructor copia
  try { buf.destroy(); } catch (e) {}
  return copia;
}

/* ---------- escapar una cadena para el flujo del PDF ---------- */
function escapar(texto) {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, (c) => {
      // WinAnsi cubre los acentos del castellano
      const n = c.charCodeAt(0);
      return n < 256 ? '\\' + n.toString(8).padStart(3, '0') : '?';
    });
}

/* ---------- abrir un documento ---------- */
function abrirBytes(bytes, comoSeLlama) {
  try {
    const d = PDFDocument.openDocument(bytes, 'application/pdf');
    if (d.needsPassword && d.needsPassword()) {
      avisar('Ese PDF pide contraseña; el editor no puede abrirlo.', 'mal');
      return false;
    }
    doc = d;
    bytesActuales = bytes;
    nombre = comoSeLlama || nombre;
    totalPaginas = doc.countPages();
    paginaActual = Math.min(paginaActual, totalPaginas - 1);
    if (paginaActual < 0) paginaActual = 0;
    return true;
  } catch (e) {
    avisar('No se pudo abrir el documento: ' + e.message, 'mal');
    return false;
  }
}

/* ---------- ¿lleva firma digital? ----------

   Editar un PDF firmado invalida la firma: el documento deja de estar
   firmado y nadie se entera hasta que rebota. No lo impedimos —a veces se
   corrige a sabiendas, para volver a firmarlo— pero se dice antes de tocar
   nada, no después.

   Se miran los campos del formulario: los de tipo /Sig que además tienen
   valor son firmas puestas; uno sin valor es solo un hueco para firmar. */
function firmasDe(documento) {
  let n = 0;
  try {
    const acro = documento.getTrailer().get('Root').get('AcroForm');
    if (!acro || !acro.isDictionary || !acro.isDictionary()) return 0;
    const campos = acro.get('Fields');
    if (!campos || !campos.isArray()) return 0;
    const mirar = (campo, hondo) => {
      if (!campo || !campo.isDictionary || !campo.isDictionary() || hondo > 8) return;
      const ft = campo.get('FT'), v = campo.get('V');
      if (ft && ft.isName && ft.isName() && ft.asName() === 'Sig' && v && !v.isNull()) n++;
      const hijos = campo.get('Kids');
      if (hijos && hijos.isArray()) for (let i = 0; i < hijos.length; i++) mirar(hijos.get(i), hondo + 1);
    };
    for (let i = 0; i < campos.length; i++) mirar(campos.get(i), 0);
  } catch (e) { /* si no se puede mirar, no se inventa nada */ }
  return n;
}

let firmasPuestas = 0;

function estrenarDocumento(bytes, comoSeLlama) {
  paginaActual = 0;
  pila = []; cambios = []; contadorFuente = 0; reconocidos.clear();
  hallazgos = []; hallazgoActual = -1; ultimaAguja = null; motivosFallo.clear();
  if (!abrirBytes(bytes, comoSeLlama)) return;
  firmasPuestas = firmasDe(doc);
  $('#avisoFirmaTitulo').textContent = firmasPuestas > 1
    ? 'Este PDF lleva ' + firmasPuestas + ' firmas digitales'
    : 'Este PDF lleva firma digital';
  $('#avisoFirma').hidden = !firmasPuestas;
  $('#vacio').hidden = true;
  $('#paginador').hidden = false;
  $('#btnDescargar').disabled = false;
  $('#btnInsertar').disabled = false;
  $('#recuperar').hidden = true;
  descargado = true;
  pintarCambios();
  pintarHallazgos();
  dibujar();
  apuntarTrabajo();
}

/* ---------- pasar el pixmap de MuPDF al lienzo ----------
   MuPDF entrega RGB opaco (tres canales) y a veces con las filas
   rellenadas; el lienzo quiere RGBA fila a fila. */
function aImageData(pix, an, al) {
  const px = pix.getPixels();
  const n = pix.getNumberOfComponents();
  const salto = pix.getStride();
  if (n === 4 && salto === an * 4) return new ImageData(new Uint8ClampedArray(px), an, al);
  const out = new Uint8ClampedArray(an * al * 4);
  for (let f = 0; f < al; f++) {
    let o = f * salto, d = f * an * 4;
    for (let c = 0; c < an; c++, o += n, d += 4) {
      if (n >= 3) { out[d] = px[o]; out[d + 1] = px[o + 1]; out[d + 2] = px[o + 2]; }
      else { out[d] = out[d + 1] = out[d + 2] = px[o]; }
      out[d + 3] = n === 4 || n === 2 ? px[o + n - 1] : 255;
    }
  }
  return new ImageData(out, an, al);
}

/* ---------- los renglones de una hoja, venga de donde venga ----------
   En una hoja con texto de verdad salen del propio PDF; en una escaneada y
   ya reconocida, del modelo que dejó el reconocimiento. De aquí para fuera
   se manejan igual, y por eso buscar y reemplazar valen para las dos. */
function renglonesDeHoja(pagina, modelo) {
  const m = modelo === undefined ? modeloDe(pagina) : modelo;
  // Solo el modelo del RECONOCIMIENTO manda sobre los renglones de su hoja.
  // Los archivos de antes no llevaban la marca y todos eran de reconocimiento,
  // así que la ausencia cuenta como «sí».
  if (!m || m.ocr === false) return leerRenglones(pagina);
  return m.renglones.map((r, i) => ({
    texto: r.t, bbox: [r.x0, r.y0, r.x1, r.y1],
    x: r.x0, y: r.y1, size: r.y1 - r.y0,
    color: r.tinta || [0, 0, 0], uniforme: true,
    deEscaneo: true, enModelo: i,
  })).filter((r) => r.texto);
}

/* ---------- dibujar la hoja ---------- */
function dibujar() {
  if (!doc) return;
  const pagina = doc.loadPage(paginaActual);
  const dpr = window.devicePixelRatio || 1;
  const factor = escala * dpr;
  const pix = pagina.toPixmap(Matrix.scale(factor, factor), ColorSpace.DeviceRGB, false, true);
  const lienzo = $('#lienzo');
  const an = pix.getWidth(), al = pix.getHeight();
  lienzo.width = an; lienzo.height = al;
  lienzo.style.width = (an / dpr) + 'px';
  lienzo.style.height = (al / dpr) + 'px';
  const ctx = lienzo.getContext('2d');
  ctx.putImageData(aImageData(pix, an, al), 0, 0);
  pix.destroy();

  const modelo = modeloDe(pagina);
  renglones = renglonesDeHoja(pagina, modelo);

  // Una hoja puede estar de tres maneras: con texto de verdad (se corrige),
  // escaneada y muda (se puede reconocer), o escaneada y ya reconocida (se
  // busca y se copia, pero no se corrige: la foto seguiría diciendo lo de
  // antes y el documento mostraría una cosa y copiaría otra).
  // en una hoja reconocida los renglones SÍ se pueden corregir: al hacerlo se
  // tapa la zona y se reescribe encima, de modo que la foto y el texto van
  // siempre a la vez y no pueden acabar diciendo cosas distintas
  const conOCR = !!modelo && modelo.ocr !== false;
  const esEscaneo = renglones.length === 0 && !conOCR;
  pintarRenglones();
  $('#cartelEscaneo').hidden = !esEscaneo;
  $('#hojaEnvoltura').hidden = esEscaneo;
  pintarReconocido(conOCR);
  pintarCambios();

  $('#btnInsertar').disabled = esEscaneo;
  if (esEscaneo && insertando) modoInsertar(false);
  else $('#renglones').classList.toggle('insertando', insertando);

  $('#pagEtiqueta').textContent = (paginaActual + 1) + ' / ' + totalPaginas;
  $('#pagAnterior').disabled = paginaActual === 0;
  $('#pagSiguiente').disabled = paginaActual >= totalPaginas - 1;
  $('#docNombre').textContent = nombre;
  const marco = marcoDe(pagina);
  const comoEsta = conOCR ? 'esta es un escaneo ya reconocido'
    : esEscaneo ? 'esta es un escaneo'
    : renglones.length + ' renglones en esta';
  $('#docDetalle').textContent =
    totalPaginas + (totalPaginas === 1 ? ' hoja' : ' hojas') + ' · ' + comoEsta +
    (marco.giro ? ' · hoja girada ' + marco.giro + '°' : '') +
    (firmasPuestas ? ' · firmado digitalmente' : '');
}

function capaRenglones() { $('#renglones').textContent = ''; }

function pintarRenglones() {
  const capa = $('#renglones');
  capa.textContent = '';
  renglones.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'renglon';
    d.style.left = (r.bbox[0] * escala) + 'px';
    d.style.top = (r.bbox[1] * escala) + 'px';
    d.style.width = ((r.bbox[2] - r.bbox[0]) * escala) + 'px';
    d.style.height = ((r.bbox[3] - r.bbox[1]) * escala) + 'px';
    d.title = r.texto;
    if (cambios.some((c) => c.hoja === paginaActual && c.despues === r.texto)) {
      d.classList.add('cambiado');
    }
    d.addEventListener('click', () => editar(i));
    capa.appendChild(d);
  });
}

/* ---------- el campo para escribir ---------- */
let campoAbierto = null;
function cerrarCampo() {
  if (campoAbierto) { campoAbierto.remove(); campoAbierto = null; }
  const a = document.querySelector('.campo-ayuda');
  if (a) a.remove();
}

function editar(indice, valorInicial) {
  cerrarCampo();
  const r = renglones[indice];
  const capa = $('#renglones');

  const campo = document.createElement('input');
  campo.className = 'campo';
  campo.type = 'text';
  campo.value = valorInicial === undefined ? r.texto : valorInicial;
  campo.style.left = (r.bbox[0] * escala - 3) + 'px';
  campo.style.top = (r.bbox[1] * escala - 3) + 'px';
  campo.style.minWidth = ((r.bbox[2] - r.bbox[0]) * escala + 24) + 'px';
  campo.style.height = ((r.bbox[3] - r.bbox[1]) * escala + 6) + 'px';
  campo.style.fontSize = Math.max(9, r.size * escala * 0.92) + 'px';

  const ayuda = document.createElement('div');
  ayuda.className = 'campo-ayuda';
  ayuda.textContent = (r.deEscaneo
    ? 'Se tapará la zona y se escribirá encima'
    : r.uniforme
      ? 'Enter para aplicar · Esc para dejarlo'
      : 'Cuidado: este renglón mezcla tipografías o tamaños')
    + ' · vacío + Enter lo borra';
  ayuda.style.left = (r.bbox[0] * escala - 3) + 'px';
  ayuda.style.top = (r.bbox[3] * escala + 6) + 'px';

  campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); const v = campo.value; cerrarCampo(); aplicar(indice, v); }
    if (ev.key === 'Escape') { ev.preventDefault(); cerrarCampo(); }
  });
  campo.addEventListener('blur', () => setTimeout(cerrarCampo, 120));

  capa.appendChild(campo);
  capa.appendChild(ayuda);
  campoAbierto = campo;
  campo.focus();
  campo.select();
}

/* ---------- medir un renglón de la foto ----------

   Para que el renglón corregido no se note hay que copiarle tres cosas al
   original, y las tres se miden aquí, sobre la propia imagen:

     · el color del papel, para taparlo con el suyo y no con blanco;
     · el color de la TINTA, que no es la media de lo oscuro —eso incluye
       los bordes suavizados de cada letra y sale medio gris— sino el
       corazón del trazo: solo lo más oscuro de entre lo que ya es tinta;
     · lo que ocupa de verdad la letra, que es menos que el recuadro que da
       el reconocimiento, y el grosor del trazo, que es lo que dice si el
       renglón era negrita mucho mejor que la cantidad de tinta.

   Se mira a 3 aumentos: a tamaño natural el trazo mide un píxel y medio y
   no se puede medir nada. */
const AUMENTO_MEDIDA = 3;

function medirRenglon(pagina, caja) {
  const A = AUMENTO_MEDIDA;
  const pix = pagina.toPixmap(Matrix.scale(A, A), ColorSpace.DeviceRGB, false, true);
  const anP = pix.getWidth(), alP = pix.getHeight();
  const n = pix.getNumberOfComponents(), salto = pix.getStride();
  const px = new Uint8Array(pix.getPixels());
  pix.destroy();

  // se recorta con margen vertical suficiente para tener papel limpio arriba
  // y abajo: de ahí sale el parche con el que se tapa el renglón
  const altoCaja = Math.max(4, (caja[3] - caja[1]) * A);
  const x0 = Math.max(0, Math.floor(caja[0] * A) - 2), x1 = Math.min(anP - 1, Math.ceil(caja[2] * A) + 2);
  const y0 = Math.max(0, Math.floor(caja[1] * A - altoCaja)), y1 = Math.min(alP - 1, Math.ceil(caja[3] * A + altoCaja));
  const dentroY0 = Math.floor(caja[1] * A) - y0, dentroY1 = Math.ceil(caja[3] * A) - y0;
  const an = x1 - x0 + 1, al = y1 - y0 + 1;
  if (an < 3 || al < 3) return null;

  const lum = new Float32Array(an * al);
  const rgb = new Uint8Array(an * al * 3);
  for (let y = 0; y < al; y++) {
    for (let x = 0; x < an; x++) {
      const o = (y + y0) * salto + (x + x0) * n;
      const i = y * an + x;
      rgb[i * 3] = px[o]; rgb[i * 3 + 1] = px[o + 1]; rgb[i * 3 + 2] = px[o + 2];
      lum[i] = (px[o] + px[o + 1] + px[o + 2]) / 3;
    }
  }
  const dentro = (i) => { const y = (i / an) | 0; return y >= dentroY0 && y <= dentroY1; };
  const lumDentro = [];
  for (let i = 0; i < lum.length; i++) if (dentro(i)) lumDentro.push(lum[i]);
  const orden = lumDentro.sort((a, b) => a - b);
  const pct = (f) => orden[Math.min(orden.length - 1, Math.max(0, Math.round(orden.length * f)))];
  const papelLum = pct(0.9);
  const masOscuro = pct(0.01);
  if (papelLum - masOscuro < 25) return null;          // ahí no hay texto que medir
  const umbral = (papelLum + masOscuro) / 2;

  // el papel, tomado de lo claro
  const claros = [];
  for (let i = 0; i < lum.length; i++) if (lum[i] >= papelLum - 6) claros.push(i);
  const mediaDe = (idx) => {
    const s3 = [0, 0, 0];
    for (const i of idx) { s3[0] += rgb[i * 3]; s3[1] += rgb[i * 3 + 1]; s3[2] += rgb[i * 3 + 2]; }
    return s3.map((v) => v / idx.length / 255);
  };

  // la tinta, tomada del CORAZÓN del trazo
  const tintaIdx = [];
  for (let i = 0; i < lum.length; i++) if (dentro(i) && lum[i] < umbral) tintaIdx.push(i);
  if (tintaIdx.length < 12) return null;
  tintaIdx.sort((a, b) => lum[a] - lum[b]);
  const nucleo = tintaIdx.slice(0, Math.max(4, Math.round(tintaIdx.length * 0.25)));

  // lo que ocupa de verdad, y el grosor del trazo
  let arriba = al, abajo = -1, izq = an, der = -1;
  const rachas = [];
  for (let y = dentroY0; y <= dentroY1 && y < al; y++) {
    let racha = 0;
    for (let x = 0; x < an; x++) {
      if (lum[y * an + x] < umbral) {
        racha++;
        if (y < arriba) arriba = y;
        if (y > abajo) abajo = y;
        if (x < izq) izq = x;
        if (x > der) der = x;
      } else if (racha) { rachas.push(racha); racha = 0; }
    }
    if (racha) rachas.push(racha);
  }
  if (abajo < arriba) return null;
  rachas.sort((a, b) => a - b);
  const grosor = rachas[Math.floor(rachas.length / 2)] || 1;

  // Cuánto tarda el papel en volverse tinta: en un escaneo el borde de cada
  // letra es blando y ocupa varios píxeles. Es lo que hace que el texto
  // vectorial, de bordes limpios, cante al lado del escaneado.
  let medios = 0, bordes = 0;
  const bajo = masOscuro + (papelLum - masOscuro) * 0.25;
  const alto2 = masOscuro + (papelLum - masOscuro) * 0.75;
  for (let y = dentroY0; y <= dentroY1 && y < al; y++) {
    let previo = null;
    for (let x = 0; x < an; x++) {
      const v = lum[y * an + x];
      if (v > bajo && v < alto2) medios++;
      const esTinta = v < umbral;
      if (previo !== null && esTinta !== previo) bordes++;
      previo = esTinta;
    }
  }
  const suavidad = bordes ? Math.min(4, medios / bordes) : 1;
  const altoTinta = (abajo - arriba + 1) / A;

  // El parche: se buscan las filas SIN tinta —las de los márgenes— y se
  // repiten para cubrir el renglón. Así el trozo tapado lleva el mismo grano
  // y el mismo tono que el papel de al lado, en vez de un rectángulo liso
  // que se adivina a la primera.
  const limpias = [];
  for (let y = 0; y < al; y++) {
    if (y >= dentroY0 && y <= dentroY1) continue;
    let sucia = false;
    for (let x = 0; x < an; x++) if (lum[y * an + x] < umbral) { sucia = true; break; }
    if (!sucia) limpias.push(y);
  }
  // El parche se estira hasta la primera fila de papel limpio por arriba y
  // por abajo: si se queda en el recuadro del reconocimiento, los rabillos
  // que sobresalen —tildes, palos altos— se quedan fuera y aparecen motas
  // encima del renglón corregido. Parar en la fila limpia evita además
  // comerse el renglón de al lado.
  const filaSucia = (y) => {
    for (let x = 0; x < an; x++) if (lum[y * an + x] < umbral) return true;
    return false;
  };
  let pArriba = Math.max(0, Math.min(dentroY0, arriba));
  while (pArriba > 0 && filaSucia(pArriba - 1)) pArriba--;
  let pAbajo = Math.min(al - 1, Math.max(dentroY1, abajo));
  while (pAbajo < al - 1 && filaSucia(pAbajo + 1)) pAbajo++;

  let parche = null;
  if (limpias.length >= 2) {
    const alturaParche = pAbajo - pArriba + 1;
    const datos = new Uint8Array(an * alturaParche * 3);
    // Cada fila del parche se mezcla entre la fila limpia más cercana por
    // arriba y la más cercana por abajo, según lo lejos que esté de cada una.
    // Copiar siempre la misma fila deja una costura horizontal muy visible.
    const arribaLimpia = limpias.filter((y) => y < pArriba);
    const abajoLimpia = limpias.filter((y) => y > pAbajo);
    const fA = arribaLimpia.length ? arribaLimpia[arribaLimpia.length - 1] : (abajoLimpia[0] || 0);
    const fB = abajoLimpia.length ? abajoLimpia[0] : fA;
    for (let y = 0; y < alturaParche; y++) {
      const t = fB === fA ? 0 : (y + pArriba - fA) / (fB - fA);
      const w = Math.max(0, Math.min(1, t));
      for (let x = 0; x < an; x++) {
        const d = (y * an + x) * 3, a3 = (fA * an + x) * 3, b3 = (fB * an + x) * 3;
        datos[d] = rgb[a3] * (1 - w) + rgb[b3] * w;
        datos[d + 1] = rgb[a3 + 1] * (1 - w) + rgb[b3 + 1] * w;
        datos[d + 2] = rgb[a3 + 2] * (1 - w) + rgb[b3 + 2] * w;
      }
    }
    parche = {
      an, al: alturaParche, datos,
      x: x0 / A, y: (y0 + pArriba) / A,
      ancho: an / A, alto: alturaParche / A,
    };
  }

  return {
    parche,
    suavidad,
    papel: claros.length ? mediaDe(claros) : [1, 1, 1],
    tinta: mediaDe(nucleo),
    // un trazo de más del 11,5 % de la altura de la letra es negrita: en
    // Helvetica el palo normal ronda el 9 % y el de la negrita el 14 %
    negrita: grosor / A / Math.max(0.5, altoTinta) > 0.115,
    altoTinta,
    arriba: (y0 + arriba) / A,        // en puntos, desde arriba de la hoja
    abajo: (y0 + abajo) / A,
    izquierda: (x0 + izq) / A,
    ancho: (der - izq + 1) / A,
  };
}

/* ---------- reconocer el texto de una hoja escaneada ----------
   Se lee la foto y se le pone encima una capa de texto INVISIBLE, palabra
   por palabra y cada una en su sitio. La foto no se toca: lo que se ve
   sigue siendo exactamente el papel que se escaneó. Lo que se gana es que
   el PDF pasa a poder buscarse y copiarse, también fuera de aquí. */
const PPP_OCR = 200;

/**
 * Limpia la hoja antes de leerla. Dos cosas estorban mucho al reconocimiento
 * y las dos salen en cualquier formato con cuadros:
 *
 *   · Las RAYAS del cuadro. Se pegan a las letras de cada celda y el
 *     reconocedor las toma por trazos, así que las celdas salen fundidas y
 *     en un revoltijo. Se borran las tiradas largas de píxeles oscuros,
 *     que es lo que es una raya y no lo es ninguna letra.
 *   · La letra CLARA sobre fondo oscuro, como las cabeceras de color. El
 *     reconocedor busca tinta oscura sobre papel claro; al revés no ve
 *     nada. Se detecta por zonas y se invierte.
 */
function limpiarParaLeer(lienzo) {
  const an = lienzo.width, al = lienzo.height;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, an, al);
  const d = img.data;
  const lum = new Uint8Array(an * al);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
    lum[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
  }

  // 1. el fondo de cada zona, por bloques: lo claro de ese trozo
  const B = 48;
  const bx = Math.ceil(an / B), by = Math.ceil(al / B);
  const fondo = new Uint8Array(bx * by);
  for (let cy = 0; cy < by; cy++) {
    for (let cx = 0; cx < bx; cx++) {
      const muestra = [];
      for (let y = cy * B; y < Math.min(al, (cy + 1) * B); y += 2) {
        for (let x = cx * B; x < Math.min(an, (cx + 1) * B); x += 2) muestra.push(lum[y * an + x]);
      }
      muestra.sort((a, b) => a - b);
      fondo[cy * bx + cx] = muestra.length ? muestra[Math.floor(muestra.length * 0.8)] : 255;
    }
  }

  // 2. Donde el fondo es más oscuro que el papel de la hoja, se le da la
  //    vuelta a la zona: las cabeceras de color llevan letra clara sobre
  //    fondo oscuro y el reconocedor no ve nada. El umbral es relativo al
  //    papel de ESTA hoja, no un número fijo: esas cabeceras suelen ser
  //    grises o de color suave, no negras.
  //
  //    Y al invertir una zona hay que invertir TAMBIÉN su fondo de
  //    referencia. Si no, todo lo de esa zona pasa a contarse como oscuro,
  //    el paso siguiente lo toma por una raya larguísima y lo borra entero.
  const papeles = Array.from(fondo).sort((a, b) => a - b);
  const papelHoja = papeles[Math.floor(papeles.length * 0.9)] || 255;
  const vuelta = new Uint8Array(bx * by);
  for (let i = 0; i < fondo.length; i++) {
    if (fondo[i] < papelHoja * 0.82) { vuelta[i] = 1; fondo[i] = 255 - fondo[i]; }
  }
  for (let y = 0; y < al; y++) {
    const cy = (y / B) | 0;
    for (let x = 0; x < an; x++) {
      if (!vuelta[cy * bx + ((x / B) | 0)]) continue;
      const i = y * an + x;
      lum[i] = 255 - lum[i];
      const j = i * 4;
      d[j] = d[j + 1] = d[j + 2] = lum[i];
    }
  }

  // 3. fuera las rayas: tiradas de oscuro más largas que cualquier letra
  const oscuro = (x, y) => {
    const cy = (y / B) | 0;
    return lum[y * an + x] < Math.max(60, fondo[cy * bx + ((x / B) | 0)]) * 0.72;
  };
  // Una raya escaneada no es una tirada continua: el grano la parte cada
  // pocos píxeles. Si no se toleran huecos cortos no se detecta ninguna.
  const HUECO = 4;
  const borrar = new Uint8Array(an * al);
  const largoH = Math.max(40, Math.round(an * 0.10));
  const largoV = Math.max(30, Math.round(al * 0.020));
  const barrer = (cuantos, cada, esOscuro, marcar, largo) => {
    for (let i = 0; i < cuantos; i++) {
      let ini = -1, vacio = 0;
      for (let j = 0; j <= cada; j++) {
        const es = j < cada && esOscuro(i, j);
        if (es) { if (ini < 0) ini = j; vacio = 0; continue; }
        if (ini < 0) continue;
        vacio++;
        if (vacio > HUECO || j === cada) {
          const fin = j - vacio + 1;
          if (fin - ini >= largo) for (let k = ini; k < fin; k++) marcar(i, k);
          ini = -1; vacio = 0;
        }
      }
    }
  };
  const porFila = new Int32Array(al);
  barrer(al, an, (y, x) => oscuro(x, y), (y, x) => { borrar[y * an + x] = 1; porFila[y]++; }, largoH);
  const porColumna = new Int32Array(an);
  barrer(an, al, (x, y) => oscuro(x, y), (x, y) => { borrar[y * an + x] = 1; porColumna[x]++; }, largoV);

  // Dónde están las rayas VERTICALES: son los bordes de las celdas, y saber
  // dónde caen permite después partir cada fila del cuadro en celdas.
  //
  // No basta con «hay una tirada larga de oscuro»: un logo o una firma
  // también la dan. Lo que distingue a una raya es que además es FINA. Así
  // que se exige que a los lados no haya casi nada marcado.
  const juntar = (cuenta, total, minimo, vecinos) => {
    const salida = [];
    const v = (i) => (i >= 0 && i < total ? cuenta[i] : 0);
    for (let i = 0; i < total; i++) {
      if (cuenta[i] < minimo) continue;
      // una raya es FINA: un logo o una firma también dan tiradas largas
      if (v(i - vecinos) > minimo * 0.4 || v(i + vecinos) > minimo * 0.4) continue;
      if (salida.length && i - salida[salida.length - 1] <= vecinos) continue;
      salida.push(i);
    }
    return salida;
  };
  const columnas = juntar(porColumna, an, largoV, 6);
  const filas = juntar(porFila, al, largoH, 6);
  for (let y = 0; y < al; y++) {
    const cy = (y / B) | 0;
    for (let x = 0; x < an; x++) {
      const i = y * an + x;
      if (!borrar[i]) continue;
      const claro = fondo[cy * bx + ((x / B) | 0)];
      const j = i * 4;
      d[j] = d[j + 1] = d[j + 2] = claro;
    }
  }

  const salida = document.createElement('canvas');
  salida.width = an; salida.height = al;
  salida.getContext('2d').putImageData(img, 0, 0);
  return { lienzo: salida, columnas, filas };
}


async function reconocerHoja() {
  if (!doc) return;
  const pagina = doc.loadPage(paginaActual);
  const marco = marcoDe(pagina);
  const escala = PPP_OCR / 72;

  cargando(true, 'Preparando el reconocimiento…');
  try {
    const pix = pagina.toPixmap(Matrix.scale(escala, escala), ColorSpace.DeviceRGB, false, true);
    const crudo = document.createElement('canvas');
    crudo.width = pix.getWidth(); crudo.height = pix.getHeight();
    crudo.getContext('2d').putImageData(aImageData(pix, crudo.width, crudo.height), 0, 0);
    pix.destroy();
    cargando(true, 'Limpiando la hoja para leerla…');
    const limpia = limpiarParaLeer(crudo);
    const foto = await new Promise((r) => limpia.lienzo.toBlob(r, 'image/png'));

    const t0 = performance.now();
    const salida = await reconocer(foto, { columnas: limpia.columnas, filas: limpia.filas }, (estado, avance) => {
      const nombres = {
        'loading tesseract core': 'Cargando el motor…',
        'initializing tesseract': 'Arrancando el motor…',
        'loading language traineddata': 'Cargando el español…',
        'initializing api': 'Casi listo…',
        'recognizing text': 'Leyendo la hoja…',
      };
      const t = nombres[estado] || estado;
      cargando(true, t + (avance ? ' ' + Math.round(avance * 100) + '%' : ''));
    });
    const ms = Math.round(performance.now() - t0);

    if (!salida.renglones.length) {
      cargando(false);
      avisar('No se reconoció ninguna palabra en esta hoja.', 'mal');
      return;
    }

    const respaldo = bytesActuales;
    cargando(true, 'Poniendo el texto encima de la foto…');
    const modelo = {
      v: 1, ocr: true,
      renglones: salida.renglones.map((w) => ({
        t: w.texto,
        x0: w.x0 / escala, y0: w.y0 / escala, x1: w.x1 / escala, y1: w.y1 / escala,
      })),
    };
    const bytes = aplicarCapa(pagina, modelo, marco);
    if (!bytes) { abrirBytes(respaldo, nombre); cargando(false); avisar('No se pudo escribir el texto.', 'mal'); return; }

    pila.push({ bytes: respaldo, cambios: cambios.slice() });
    $('#btnDeshacer').disabled = false;
    bytesActuales = bytes;
    abrirBytes(bytes, nombre);
    reconocidos.set(paginaActual, {
      texto: salida.texto, confianza: Math.round(salida.confianza),
      palabras: salida.palabras, renglones: salida.renglones.length, ms,
    });
    cargando(false);
    dibujar();
    descargado = false;
    apuntarTrabajo();
    avisar(`Reconocidos ${salida.renglones.length} renglones, ${salida.palabras} palabras `
      + `(${Math.round(salida.confianza)} % de confianza) en ${(ms / 1000).toFixed(1)} s.`, 'bien');
  } catch (e) {
    console.error(e);
    cargando(false);
    avisar('No se pudo reconocer: ' + e.message, 'mal');
  }
}

/* ---------- la capa de Grapa sobre una hoja escaneada ----------

   Todo lo que Grapa pone encima de la foto vive en UN solo flujo, que se
   reescribe entero en cada cambio, y en un modelo guardado dentro de la
   propia hoja. Así:

     · nunca hace falta redactar. Redactar obliga a MuPDF a reescribir el
       contenido de la hoja, y en un PDF impreso por Chrome —que lo dibuja
       todo bajo una matriz de 0,24— eso metía nuestro texto dentro de esa
       matriz: acababa a un cuarto de tamaño y en otro sitio;
     · el modelo viaja dentro del archivo, así que la hoja se puede seguir
       corrigiendo después de guardarla, cerrarla o pasarla por Grapa;
     · los renglones sin tocar siguen invisibles —solo para buscar— y los
       corregidos se ven, porque se tapa su zona y se escribe encima.     */

const CLAVE_MODELO = 'GrapaOCR';
const CLAVE_CAPA = 'GrapaCapa';

/**
 * De qué tamaño hay que escribir para que ocupe lo mismo que ocupaba.
 *
 * El recuadro que da el reconocimiento ciñe lo que hay dibujado, y eso
 * depende del texto: «DISTRIBUIDORA SRL», todo mayúsculas y sin colas, solo
 * llega a la altura de las mayúsculas; «Página» baja hasta la cola de la g.
 * Tomar la altura del recuadro como altura de la letra deja el renglón
 * corregido visiblemente más pequeño que el que sustituye.
 */
function metricaDe(texto) {
  const t = String(texto || '');
  const conCola = /[gjpqyGJPQY¡¿(),;_]/.test(t);
  const conAlta = /[A-ZÁÉÍÓÚÜÑbdfhklt0-9ÀÂÄÈÊËÎÏÔÖÛ]/.test(t);
  const arriba = conAlta ? 0.72 : 0.52;    // altura de mayúscula o de la x
  const abajo = conCola ? 0.21 : 0;        // lo que baja de la línea base
  return { arriba, abajo, alto: arriba + abajo };
}

function modeloDe(pagina) {
  try {
    const m = pagina.getObject().get(CLAVE_MODELO);
    if (!m || !m.isString || !m.isString()) return null;
    const d = JSON.parse(m.asString());
    return d && Array.isArray(d.renglones) ? d : null;
  } catch (e) { return null; }
}

/**
 * El contenido de una hoja son varios flujos que se concatenan como si
 * fueran uno solo. Si lo que ya había deja la matriz cambiada —Chrome, al
 * imprimir a PDF, abre con «.24 0 0 -.24 0 842.88 cm» y no la cierra—, todo
 * lo que añadamos detrás hereda esa matriz y acaba a un cuarto de tamaño y
 * en otro sitio. Se envuelve lo anterior en q…Q, que es la manera que
 * manda el propio formato, y nuestra capa empieza por Q.
 */
function envolverContenido(objPag) {
  if (objPag.get('GrapaEnvuelto').isBoolean && objPag.get('GrapaEnvuelto').isBoolean()) return;
  const abre = new Buffer();
  abre.writeLine('q');
  const refAbre = doc.addStream(abre, {});
  const cont = objPag.get('Contents');
  const arr = doc.newArray();
  arr.push(refAbre);
  if (cont.isArray()) { for (let i = 0; i < cont.length; i++) arr.push(cont.get(i)); }
  else arr.push(cont);
  objPag.put('Contents', arr);
  objPag.put('GrapaEnvuelto', doc.newBoolean(true));
}

/** ¿Este flujo sigue colgando del contenido de la hoja? */
function enElContenido(objPag, obj) {
  if (!obj || !obj.isIndirect || !obj.isIndirect()) return false;
  const n = obj.asIndirect();
  const mismo = (e) => e && e.isIndirect && e.isIndirect() && e.asIndirect() === n;
  const cont = objPag.get('Contents');
  if (cont.isArray()) {
    for (let i = 0; i < cont.length; i++) if (mismo(cont.get(i))) return true;
    return false;
  }
  return mismo(cont);
}

/**
 * Como envolverContenido, pero CERRANDO: lo que ya había queda dentro de un
 * q…Q completo, y así cualquier flujo que se añada detrás arranca con la
 * matriz limpia y se basta a sí mismo. Es lo que necesita el texto
 * insertado, que se escribe en su propio flujo y no en la capa.
 *
 * Lleva marca propia para no tocar las hojas envueltas por la manera
 * anterior —la capa del reconocimiento, que abre con su propio «Q»—: esas
 * siguen como estaban.
 */
function envolverCerrado(objPag) {
  const m = objPag.get('GrapaEnvueltoBal');
  if (m && m.isBoolean && m.isBoolean()) return;
  const abre = new Buffer(); abre.writeLine('q');
  const cierra = new Buffer(); cierra.writeLine('Q');
  const arr = doc.newArray();
  arr.push(doc.addStream(abre, {}));
  const cont = objPag.get('Contents');
  if (cont.isArray()) { for (let i = 0; i < cont.length; i++) arr.push(cont.get(i)); }
  else arr.push(cont);
  arr.push(doc.addStream(cierra, {}));
  objPag.put('Contents', arr);
  objPag.put('GrapaEnvueltoBal', doc.newBoolean(true));
}

/* Los parches de papel LIMPIO de esta sesión, por si se vuelve a corregir
   el mismo renglón: si no, la segunda medición leería nuestro propio texto. */
const parchesPapel = new Map();

/**
 * Compone el renglón corregido como imagen: el papel de verdad de fondo y el
 * texto encima, con la misma blandura de borde que tiene el escaneo.
 *
 * Es lo que hace que no cante. El texto vectorial tiene el borde limpio y el
 * escaneado lo tiene blando; puestos uno al lado del otro, la diferencia se
 * nota aunque el tamaño, el color y la tipografía sean los mismos.
 */
function componerParche(parche, fila, suavidad) {
  const A = AUMENTO_MEDIDA;
  const lienzo = document.createElement('canvas');
  lienzo.width = parche.an; lienzo.height = parche.al;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });

  const fondo = ctx.createImageData(parche.an, parche.al);
  for (let i = 0, j = 0; i < parche.datos.length; i += 3, j += 4) {
    fondo.data[j] = parche.datos[i];
    fondo.data[j + 1] = parche.datos[i + 1];
    fondo.data[j + 2] = parche.datos[i + 2];
    fondo.data[j + 3] = 255;
  }
  ctx.putImageData(fondo, 0, 0);

  const tam = (fila.tam || 10) * A;
  ctx.font = (fila.negrita ? 'bold ' : '') + tam.toFixed(2) + 'px Helvetica, Arial, sans-serif';
  const [r, g, b] = fila.tinta || [0, 0, 0];
  ctx.fillStyle = 'rgb(' + Math.round(r * 255) + ',' + Math.round(g * 255) + ',' + Math.round(b * 255) + ')';
  ctx.textBaseline = 'alphabetic';
  ctx.filter = 'blur(' + Math.min(3, Math.max(0.2, suavidad * 0.5)).toFixed(2) + 'px)';

  const x = (fila.x - parche.x) * A;
  const y = (fila.base - parche.y) * A;
  const natural = ctx.measureText(fila.t).width;
  const hueco = (fila.hueco || parche.ancho) * A;
  ctx.save();
  if (natural > hueco && natural > 0) {
    ctx.translate(x, 0);
    ctx.scale(Math.max(0.55, hueco / natural), 1);
    ctx.fillText(fila.t, 0, y);
  } else {
    ctx.fillText(fila.t, x, y);
  }
  ctx.restore();
  ctx.filter = 'none';

  const fuera = ctx.getImageData(0, 0, parche.an, parche.al).data;
  const datos = new Uint8Array(parche.an * parche.al * 3);
  for (let i = 0, j = 0; j < fuera.length; i += 3, j += 4) {
    datos[i] = fuera[j]; datos[i + 1] = fuera[j + 1]; datos[i + 2] = fuera[j + 2];
  }
  return Object.assign({}, parche, { datos });
}

/** Lo oscuro que ha quedado el corazón del trazo, de 0 a 255. */
function nucleoDe(datos) {
  const l = [];
  for (let i = 0; i < datos.length; i += 3) l.push((datos[i] + datos[i + 1] + datos[i + 2]) / 3);
  l.sort((a, b) => a - b);
  const n = Math.max(1, Math.round(l.length * 0.02));
  let s = 0;
  for (let i = 0; i < n; i++) s += l[i];
  return s / n;
}

/**
 * Desenfocar el texto para que iguale al escaneo lo aclara: la tinta se
 * reparte y el corazón del trazo pierde fuerza. Así que se compone, se mide
 * lo que ha salido y se vuelve a componer con la tinta corregida, hasta que
 * el negro del trazo es el mismo que el del renglón que sustituye.
 */
function componerAjustado(parche, fila, suavidad) {
  const objetivo = ((fila.tinta || [0, 0, 0]).reduce((a, b) => a + b, 0) / 3) * 255;
  const papel = ((fila.papel || [1, 1, 1]).reduce((a, b) => a + b, 0) / 3) * 255;
  let tinta = (fila.tinta || [0, 0, 0]).slice();
  let mejor = null;
  for (let intento = 0; intento < 4; intento++) {
    const salida = componerParche(parche, Object.assign({}, fila, { tinta }), suavidad);
    const logrado = nucleoDe(salida.datos);
    if (!mejor || Math.abs(logrado - objetivo) < mejor.error) {
      mejor = { salida, error: Math.abs(logrado - objetivo) };
    }
    if (Math.abs(logrado - objetivo) <= 3) break;
    const quiero = Math.max(1, papel - objetivo), tengo = Math.max(1, papel - logrado);
    const factor = Math.min(3, Math.max(0.3, quiero / tengo));
    tinta = tinta.map((c) => Math.max(0, Math.min(1, (papel / 255) - ((papel / 255) - c) * factor)));
  }
  return mejor.salida;
}

/** Mete el parche de papel en la hoja como una imagen, con nombre propio. */
function incrustarParche(pagina, nombre, p) {
  const px = new Pixmap(ColorSpace.DeviceRGB, [0, 0, p.an, p.al], false);
  const destino = px.getPixels();
  const salto = px.getStride();
  for (let y = 0; y < p.al; y++) {
    for (let x = 0; x < p.an; x++) {
      const d = y * salto + x * 3, o = (y * p.an + x) * 3;
      destino[d] = p.datos[o]; destino[d + 1] = p.datos[o + 1]; destino[d + 2] = p.datos[o + 2];
    }
  }
  const ref = doc.addImage(new Image(px));
  px.destroy();
  const objPag = pagina.getObject();
  let rec = objPag.get('Resources');
  if (!rec.isDictionary()) { rec = doc.addObject(doc.newDictionary()); objPag.put('Resources', rec); }
  let xo = rec.get('XObject');
  if (!xo.isDictionary()) { xo = doc.addObject(doc.newDictionary()); rec.put('XObject', xo); }
  xo.put(nombre, ref);
}

function aplicarCapa(pagina, modelo, marco) {
  const objPag = pagina.getObject();
  const clave = 'GrapaTxt', claveN = 'GrapaTxtN';
  let rec = objPag.get('Resources');
  if (!rec.isDictionary()) { rec = doc.addObject(doc.newDictionary()); objPag.put('Resources', rec); }
  let fuentes = rec.get('Font');
  if (!fuentes.isDictionary()) { fuentes = doc.addObject(doc.newDictionary()); rec.put('Font', fuentes); }
  fuentes.put(clave, doc.addSimpleFont(new Font('Helvetica'), 'Latin'));
  fuentes.put(claveN, doc.addSimpleFont(new Font('Helvetica-Bold'), 'Latin'));

  envolverContenido(objPag);

  const buf = new Buffer();
  buf.writeLine('Q');          // cierra el q que envuelve lo anterior
  const normal = new Font('Helvetica'), negrita = new Font('Helvetica-Bold');
  // Cada renglón del modelo está de una de cuatro maneras:
  //
  //   · tal cual   · texto invisible encima de la foto, solo para buscarlo
  //                  y copiarlo; lo que se ve sigue siendo el escaneo;
  //   · editado    · se tapa su sitio con papel y se escribe lo nuevo;
  //   · borrado    · se tapa su sitio y no se escribe nada;
  //   · insertado  · texto nuevo a la vista, sin tapar nada porque debajo
  //                  no había nada que quitar.
  for (const r of modelo.renglones) {
    const ancho = r.x1 - r.x0, alto = r.y1 - r.y0;
    if (ancho <= 0.5 || alto <= 0.5) continue;
    if (!r.t && !r.borrado) continue;
    const propio = r.editado || r.insertado;      // renglón escrito por nosotros
    const met = metricaDe(r.t || 'X');
    const tam = propio && r.tam ? r.tam : alto / Math.max(0.3, met.alto);
    const cual = propio && r.negrita ? negrita : normal;
    const natural = medirAncho(cual, r.t || '', tam);
    const hueco = (propio && r.hueco) || ancho;
    // el renglón corregido se encoge si no cabe, pero NO se estira: estirarlo
    // para rellenar el hueco del texto viejo deja las letras separadas y canta
    const tz = natural <= 0.01 ? 100
      : r.insertado ? 100                  // lo insertado no le quita sitio a nadie
      : r.editado ? Math.max(55, Math.min(100, (hueco / natural) * 100))
      : Math.max(5, Math.min(900, (ancho / natural) * 100));
    const xv = propio && r.x != null ? r.x : r.x0;   // en lo que se VE
    const [tr, tg, tb] = r.tinta || [0, 0, 0];

    // Tapar: con un trozo de papel de verdad, sacado de las filas limpias
    // de al lado, si se pudo sacar; con su color liso si no.
    if ((r.editado || r.borrado) && !r.insertado) {
      if (r.parche && r.parcheCaja) {
        const [px0, py0, pan, pal] = r.parcheCaja;
        buf.writeLine('q ' + matrizImagen(marco, px0, py0, pan, pal) + ' /' + r.parche + ' Do Q');
      } else {
        const m = Math.max(0.8, alto * 0.16);
        const [pr, pg, pb] = r.papel || [1, 1, 1];
        buf.writeLine('q ' + pr.toFixed(4) + ' ' + pg.toFixed(4) + ' ' + pb.toFixed(4) + ' rg '
          + rectanguloEnHoja(marco, xv - m, r.y0 - m, ancho + m * 2, alto + m * 2) + ' f Q');
      }
    }
    if (!r.t) continue;                    // borrado: tapado y nada más

    if (propio) {
      // Si el renglón corregido va dentro de la imagen, aquí solo se escribe
      // el texto INVISIBLE, para poder buscarlo y copiarlo. Si no hubo parche
      // —o si es texto insertado, que no tapa nada— se escribe a la vista.
      const modo = r.editado && r.parche && r.parcheCaja ? '3 Tr ' : '';
      buf.writeLine('q BT ' + modo + '/' + (r.negrita ? claveN : clave) + ' ' + tam.toFixed(2)
        + ' Tf ' + tz.toFixed(2) + ' Tz '
        + tr.toFixed(4) + ' ' + tg.toFixed(4) + ' ' + tb.toFixed(4) + ' rg '
        + matrizTexto(marco, xv, r.base != null ? r.base : r.y1 - met.abajo * tam) + ' ('
        + escapar(r.t) + ') Tj ET Q');
    } else {
      buf.writeLine('q BT 3 Tr /' + clave + ' ' + tam.toFixed(2) + ' Tf ' + tz.toFixed(2)
        + ' Tz ' + matrizTexto(marco, xv, r.y1 - met.abajo * tam)
        + ' (' + escapar(r.t) + ') Tj ET Q');
    }
  }

  // Un solo flujo, reescrito entero: si ya existe, se sustituye. Pero hay que
  // mirar que siga colgando de la hoja: una redacción reescribe TODO el
  // contenido y puede dejar nuestro flujo descolgado, y entonces escribir en
  // él no pintaría nada.
  let capa = objPag.get(CLAVE_CAPA);
  if (capa && capa.isStream && capa.isStream() && enElContenido(objPag, capa)) {
    capa.writeStream(buf);
  } else {
    capa = doc.addStream(buf, {});
    objPag.put(CLAVE_CAPA, capa);
    let cont = objPag.get('Contents');
    if (cont.isArray()) { cont.push(capa); }
    else { const arr = doc.newArray(); arr.push(cont); arr.push(capa); objPag.put('Contents', arr); }
  }
  objPag.put(CLAVE_MODELO, doc.newString(JSON.stringify(modelo)));
  return bytesDe(doc);
}


/* ---------- el cambio de verdad ---------- */

/**
 * El cambio en sí, sin nada de interfaz: devuelve { ok, motivo, … } y no
 * toca ni la pila de deshacer ni la lista de cambios, que las lleva quien
 * llama. Así «reemplazar todas» puede encadenar veinte cambios y dejar un
 * solo paso que deshacer, en vez de veinte.
 */
function cambiarRenglon(indice, textoNuevo) {
  return renglones[indice].deEscaneo
    ? reescribirEnEscaneo(indice, textoNuevo)
    : reescribir(indice, textoNuevo);
}

/* ---------- el cambio de verdad ---------- */
function aplicar(indice, textoNuevo) {
  const r = renglones[indice];
  if (textoNuevo === r.texto) return;
  // sin texto, el cambio es borrar el renglón: se quita del archivo de verdad
  hacerCambio(() => cambiarRenglon(indice, textoNuevo), r.texto, textoNuevo);
}

function insertar(x, y, texto) {
  hacerCambio(() => insertarRenglon(x, y, texto), '', texto);
}

/**
 * Corregir, borrar e insertar acaban todos aquí: lo de alrededor —el cartel
 * de espera, volver atrás si no cuadra, la pila de deshacer, la lista de
 * cambios y el aviso— es lo mismo en los tres. Solo cambia lo que se hace.
 */
function hacerCambio(accion, antes, despues) {
  const respaldo = bytesActuales;
  cargando(true, !despues ? 'Borrando el renglón\u2026'
    : !antes ? 'Escribiendo\u2026' : 'Aplicando el cambio\u2026');

  setTimeout(() => {
    try {
      const resultado = accion();
      if (!resultado.ok) {
        abrirBytes(respaldo, nombre);          // volver atrás
        cargando(false);
        avisar(resultado.motivo, 'mal');
        dibujar();
        return;
      }
      pila.push({ bytes: respaldo, cambios: cambios.slice() });
      cambios.push({
        hoja: paginaActual, antes, despues,
        encogido: resultado.encogido, tipografia: resultado.tipografia,
        sobreFoto: resultado.sobreFoto, borrado: resultado.borrado,
        insertado: resultado.insertado,
      });
      $('#btnDeshacer').disabled = false;
      cargando(false);
      pintarCambios();
      dibujar();
      refrescarHallazgosDe(paginaActual);
      descargado = false;
      apuntarTrabajo();
      avisar(resultado.borrado ? 'Renglón borrado.'
        : resultado.insertado
          ? 'Escrito' + (resultado.tipografia ? ' en ' + resultado.tipografia : '') + '.'
          : (resultado.sobreFoto ? 'Cambiado sobre la foto' : 'Cambiado')
            + (resultado.encogido ? `, ajustado al ancho original (${resultado.encogido} %)` : '') + '.',
        'bien');
    } catch (e) {
      abrirBytes(respaldo, nombre);
      cargando(false);
      dibujar();
      avisar('No se pudo aplicar: ' + e.message, 'mal');
    }
  }, 20);
}

/* ---------- corregir un renglón de una hoja escaneada ----------
   Se cambia el modelo y se vuelve a escribir la capa entera. No se redacta
   nada y no se toca la foto original: lo que tapa es un recuadro nuestro,
   del color del papel de ese renglón. */
function reescribirEnEscaneo(indice, textoNuevo) {
  const r = renglones[indice];
  const pagina = doc.loadPage(paginaActual);
  const marco = marcoDe(pagina);
  const raro = giroRaro(marco);
  if (raro) return { ok: false, motivo: raro };
  const modelo = modeloDe(pagina);
  const fila = modelo && modelo.renglones[r.enModelo];
  if (!fila) return { ok: false, motivo: 'No encuentro el reconocimiento de esta hoja; vuelve a reconocerla.' };

  const antes = fila.t, eraEditado = !!fila.editado;

  // Se mide el renglón ORIGINAL y se copian sus rasgos. El tamaño y la línea
  // base se deducen de lo que ocupa la tinta de verdad, no del recuadro que
  // da el reconocimiento, que es algo más alto y dejaba la letra crecida.
  // sobre un renglón que escribimos nosotros no hay nada que medir: lo que
  // se leería es nuestra propia letra, no la del escaneo
  const med = (eraEditado || fila.insertado) ? null : medirRenglon(pagina, [fila.x0, fila.y0, fila.x1, fila.y1]);
  if (med) {
    const metOrig = metricaDe(antes);
    fila.papel = med.papel;
    fila.tinta = med.tinta;
    fila.negrita = med.negrita;
    fila.tam = med.altoTinta / Math.max(0.3, metOrig.alto);
    fila.base = med.abajo - metOrig.abajo * fila.tam;
    fila.x = med.izquierda;
    fila.hueco = Math.max(med.ancho, fila.x1 - fila.x0);
    fila.suavidad = med.suavidad;
    if (med.parche) parchesPapel.set(paginaActual + ':' + r.enModelo, { p: med.parche, s: med.suavidad });
  }
  const guardado = parchesPapel.get(paginaActual + ':' + r.enModelo);
  const eraBorrado = !!fila.borrado;
  fila.t = textoNuevo;
  fila.editado = !!textoNuevo;
  fila.borrado = !textoNuevo;

  if (guardado) {
    const nombre = 'GrapaParche' + r.enModelo;
    // borrar es tapar con el papel y no escribir nada encima: el parche se
    // toma tal cual, sin la vuelta de ajustar el negro de una tinta que no va
    incrustarParche(pagina, nombre,
      textoNuevo ? componerAjustado(guardado.p, fila, guardado.s) : guardado.p);
    fila.parche = nombre;
    fila.parcheCaja = [guardado.p.x, guardado.p.y, guardado.p.ancho, guardado.p.alto];
  }

  const salida = aplicarCapa(pagina, modelo, marco);
  const volver = (motivo) => {
    fila.t = antes; fila.editado = eraEditado; fila.borrado = eraBorrado;
    return { ok: false, motivo };
  };

  const comprobar = PDFDocument.openDocument(salida, 'application/pdf');
  const texto = comprobar.loadPage(paginaActual).toStructuredText('preserve-whitespace').asText();
  if (textoNuevo && !texto.includes(textoNuevo.trim())) return volver('El texto nuevo no quedó donde debía; no se cambió nada.');
  if (antes.trim() && texto.includes(antes.trim())) return volver('El texto viejo seguía ahí; no se cambió nada.');

  bytesActuales = salida;
  abrirBytes(salida, nombre);
  return { ok: true, sobreFoto: true, borrado: !textoNuevo };
}


function reescribir(indice, textoNuevo) {
  const r = renglones[indice];
  const pagina = doc.loadPage(paginaActual);
  const marco = marcoDe(pagina);

  const raro = giroRaro(marco);
  if (raro) return { ok: false, motivo: raro };

  // 1. quitar el texto viejo de dentro del archivo, no taparlo
  const an = pagina.createAnnotation('Redact');
  an.setRect([r.bbox[0], r.bbox[1], r.bbox[2], r.bbox[3]]);
  an.update();
  pagina.applyRedactions(false);

  // 1.b. si no hay texto nuevo, la redacción ES el cambio: el renglón se ha
  //      quitado del archivo y no hay nada que escribir en su sitio
  if (!textoNuevo) {
    const salidaB = bytesDe(doc);
    const compB = PDFDocument.openDocument(salidaB, 'application/pdf');
    const quedan = leerRenglones(compB.loadPage(paginaActual));
    if (quedan.some((x) => x.texto === r.texto)) {
      return { ok: false, motivo: 'El renglón seguía ahí; no se borró nada.' };
    }
    const caidos = renglones.filter(
      (v2, i) => i !== indice && !quedan.some((n) => n.texto === v2.texto)
    );
    if (caidos.length) {
      return { ok: false, motivo: 'Borrarlo se habría llevado por delante ' + caidos.length
        + ' renglón(es) de al lado; no se borró nada.' };
    }
    bytesActuales = salidaB;
    abrirBytes(salidaB, nombre);
    return { ok: true, borrado: true };
  }

  // 2. volver a escribir el renglón completo, en su misma línea base
  const elegida = resolverFuente(r.fuente, r.rasgos);
  const fuente = elegida.fuente;
  const clave = 'GrapaEd' + (contadorFuente++);
  const refFuente = doc.addSimpleFont(fuente, 'Latin');
  const objPag = pagina.getObject();
  let rec = objPag.get('Resources');
  if (!rec.isDictionary()) { rec = doc.addObject(doc.newDictionary()); objPag.put('Resources', rec); }
  let fuentes = rec.get('Font');
  if (!fuentes.isDictionary()) { fuentes = doc.addObject(doc.newDictionary()); rec.put('Font', fuentes); }
  fuentes.put(clave, refFuente);

  // si el texto nuevo es más largo, se aprieta un poco para no invadir
  // lo que tiene al lado; nunca por debajo del 75 %
  const anchoViejo = r.bbox[2] - r.bbox[0];
  const anchoNuevo = medirAncho(fuente, textoNuevo, r.size);
  let tz = 100, encogido = 0;
  if (anchoViejo > 1 && anchoNuevo > anchoViejo * 1.01) {
    tz = Math.max(75, (anchoViejo / anchoNuevo) * 100);
    encogido = Math.round(tz);
  }

  const [cr, cg, cb] = r.color || [0, 0, 0];
  const buf = new Buffer();
  buf.writeLine(
    'q BT /' + clave + ' ' + r.size + ' Tf ' + tz.toFixed(2) + ' Tz ' +
    cr.toFixed(4) + ' ' + cg.toFixed(4) + ' ' + cb.toFixed(4) + ' rg ' +
    matrizTexto(marco, r.x, r.y) + ' (' + escapar(textoNuevo) + ') Tj ET Q'
  );
  const refFlujo = doc.addStream(buf, {});
  let cont = objPag.get('Contents');
  if (cont.isArray()) { cont.push(refFlujo); }
  else { const arr = doc.newArray(); arr.push(cont); arr.push(refFlujo); objPag.put('Contents', arr); }

  // 3. comprobar el resultado antes de darlo por bueno
  const salida = bytesDe(doc);
  const comprobar = PDFDocument.openDocument(salida, 'application/pdf');
  const nuevos = leerRenglones(comprobar.loadPage(paginaActual));
  const puesto = nuevos.find((x) => x.texto.trim() === textoNuevo.trim());
  if (!puesto) {
    return { ok: false, motivo: 'El texto nuevo no quedó donde debía; no se cambió nada.' };
  }
  const desvio = Math.max(Math.abs(puesto.x - r.x), Math.abs(puesto.y - r.y));
  if (desvio > 1.5) {
    return { ok: false, motivo: 'El texto nuevo quedaba corrido ' + desvio.toFixed(2) + ' puntos; no se cambió nada.' };
  }
  const perdidos = renglones.filter(
    (v, i) => i !== indice && !nuevos.some((n) => n.texto === v.texto)
  );
  if (perdidos.length) {
    return { ok: false, motivo: 'El cambio se habría llevado por delante ' + perdidos.length +
      ' renglón(es) de al lado; no se cambió nada.' };
  }

  bytesActuales = salida;
  abrirBytes(salida, nombre);
  return { ok: true, encogido, desvio,
           tipografia: elegida.sustituida ? elegida.nombre : '' };
}

/* ---------- escribir donde no había nada ----------

   Insertar no es corregir: debajo no hay nada que quitar, así que aquí no
   se tapa ni se redacta nada. Lo único que hace falta es que lo escrito no
   cante al lado de lo que ya estaba, y para eso se le copia la letra al
   renglón más cercano de la hoja: tipografía, tamaño y color.

   En una hoja de texto se escribe en un flujo propio, detrás de lo que ya
   había y con la matriz limpia. En una hoja escaneada y reconocida se
   añade un renglón al modelo y lo pinta la capa, como todo lo demás. */

function renglonMasCercano(x, y) {
  let mejor = null, dist = Infinity;
  for (const r of renglones) {
    const cx = Math.max(r.bbox[0], Math.min(x, r.bbox[2]));
    const cy = Math.max(r.bbox[1], Math.min(y, r.bbox[3]));
    const d = Math.hypot(x - cx, y - cy);
    if (d < dist) { dist = d; mejor = r; }
  }
  return mejor;
}

/** Con qué letra se escribiría ahí. Lo usa también la ayuda del campo,
 *  para poder decirlo ANTES de escribir. */
function letraParaInsertar(x, y) {
  const cerca = renglonMasCercano(x, y);
  const tam = cerca && cerca.size > 1 ? cerca.size : 11;
  const color = (cerca && cerca.color) || [0, 0, 0];
  const elegida = resolverFuente(cerca ? cerca.fuente : 'Helvetica', cerca ? cerca.rasgos : null);
  return { cerca, tam, color, elegida, negrita: !!(cerca && cerca.rasgos && cerca.rasgos.negrita) };
}

function insertarRenglon(x, y, texto) {
  const pagina = doc.loadPage(paginaActual);
  const marco = marcoDe(pagina);
  const raro = giroRaro(marco);
  if (raro) return { ok: false, motivo: raro };
  const modelo = modeloDe(pagina);
  return modelo && modelo.ocr !== false
    ? insertarEnEscaneo(pagina, modelo, marco, x, y, texto)
    : insertarEnTexto(pagina, marco, x, y, texto);
}

function insertarEnTexto(pagina, marco, x, y, texto) {
  const { tam, color, elegida } = letraParaInsertar(x, y);
  const objPag = pagina.getObject();
  envolverCerrado(objPag);

  const clave = 'GrapaEd' + (contadorFuente++);
  let rec = objPag.get('Resources');
  if (!rec.isDictionary()) { rec = doc.addObject(doc.newDictionary()); objPag.put('Resources', rec); }
  let fuentes = rec.get('Font');
  if (!fuentes.isDictionary()) { fuentes = doc.addObject(doc.newDictionary()); rec.put('Font', fuentes); }
  fuentes.put(clave, doc.addSimpleFont(elegida.fuente, 'Latin'));

  const [cr, cg, cb] = color;
  const buf = new Buffer();
  buf.writeLine('q BT /' + clave + ' ' + tam.toFixed(2) + ' Tf '
    + cr.toFixed(4) + ' ' + cg.toFixed(4) + ' ' + cb.toFixed(4) + ' rg '
    + matrizTexto(marco, x, y) + ' (' + escapar(texto) + ') Tj ET Q');
  const flujo = doc.addStream(buf, {});
  const cont = objPag.get('Contents');
  if (cont.isArray()) { cont.push(flujo); }
  else { const arr = doc.newArray(); arr.push(cont); arr.push(flujo); objPag.put('Contents', arr); }

  // comprobar antes de darlo por bueno, igual que al corregir
  const salida = bytesDe(doc);
  const comprobar = PDFDocument.openDocument(salida, 'application/pdf');
  const nuevos = leerRenglones(comprobar.loadPage(paginaActual));
  const puesto = nuevos.find((n) => n.texto.trim() === texto.trim());
  if (!puesto) return { ok: false, motivo: 'El texto no llegó a escribirse; no se cambió nada.' };
  const desvio = Math.max(Math.abs(puesto.x - x), Math.abs(puesto.y - y));
  if (desvio > 1.5) {
    return { ok: false, motivo: 'El texto quedaba corrido ' + desvio.toFixed(2) + ' puntos; no se escribió nada.' };
  }
  const perdidos = renglones.filter((v) => !nuevos.some((n) => n.texto === v.texto));
  if (perdidos.length) {
    return { ok: false, motivo: 'Escribirlo se habría llevado por delante ' + perdidos.length
      + ' renglón(es) de al lado; no se escribió nada.' };
  }

  bytesActuales = salida;
  abrirBytes(salida, nombre);
  return { ok: true, insertado: true, tipografia: elegida.sustituida ? elegida.nombre : '' };
}

function insertarEnEscaneo(pagina, modelo, marco, x, y, texto) {
  const { tam, color, negrita } = letraParaInsertar(x, y);
  const met = metricaDe(texto);
  const ancho = Math.max(2, medirAncho(new Font(negrita ? 'Helvetica-Bold' : 'Helvetica'), texto, tam));
  modelo.renglones.push({
    t: texto, insertado: true,
    x, base: y, tam, negrita, tinta: color, hueco: ancho,
    x0: x, x1: x + ancho,
    y0: y - met.arriba * tam, y1: y + met.abajo * tam,
  });
  const salida = aplicarCapa(pagina, modelo, marco);
  const comprobar = PDFDocument.openDocument(salida, 'application/pdf');
  const txt = comprobar.loadPage(paginaActual).toStructuredText('preserve-whitespace').asText();
  if (!txt.includes(texto.trim())) {
    modelo.renglones.pop();
    return { ok: false, motivo: 'El texto no llegó a escribirse; no se cambió nada.' };
  }
  bytesActuales = salida;
  abrirBytes(salida, nombre);
  return { ok: true, insertado: true, sobreFoto: true };
}

/* ---------- buscar y reemplazar en todo el documento ----------

   Buscar sirve para las dos clases de hoja: en las de texto se mira el
   propio PDF, y en las escaneadas y ya reconocidas, el modelo que dejó el
   reconocimiento. Desde aquí no se nota la diferencia.

   Reemplazar todas apunta PRIMERO todo lo que hay que cambiar y solo
   después empieza. Cada cambio reescribe la hoja y le reordena los
   renglones, así que una lista tomada sobre la marcha se quedaría coja a
   la segunda vuelta. Y los veinte cambios dejan UN paso que deshacer, no
   veinte.                                                              */

let hallazgos = [];          // { hoja, texto, pos, uniforme }
let hallazgoActual = -1;
let ultimaAguja = null;
const motivosFallo = new Map();   // «hoja·texto» → por qué no se pudo cambiar

/** Dónde aparece la aguja dentro del texto; vacío si no aparece. */
function posicionesDe(texto, aguja) {
  if (!aguja) return [];
  let t = texto, a = aguja;
  if (!$('#buscarMayus').checked) {
    const tb = texto.toLowerCase(), ab = aguja.toLowerCase();
    // hay alfabetos en los que pasar a minúscula cambia la longitud; cuando
    // pasa, antes distinguir mayúsculas que devolver posiciones falsas
    if (tb.length === texto.length && ab.length === aguja.length) { t = tb; a = ab; }
  }
  const pos = [];
  let i = 0, j;
  while ((j = t.indexOf(a, i)) !== -1) { pos.push(j); i = j + a.length; }
  return pos;
}

function sustituirEn(texto, aguja, nuevo) {
  const pos = posicionesDe(texto, aguja);
  if (!pos.length) return texto;
  let salida = '', i = 0;
  for (const j of pos) { salida += texto.slice(i, j) + nuevo; i = j + aguja.length; }
  return salida + texto.slice(i);
}

function apuntarHallazgosDe(hoja, aguja) {
  for (const l of renglonesDeHoja(doc.loadPage(hoja))) {
    const pos = posicionesDe(l.texto, aguja);
    if (pos.length) hallazgos.push({ hoja, texto: l.texto, pos, uniforme: l.uniforme !== false });
  }
}

async function buscarEnTodo(silencioso) {
  const aguja = $('#buscarTexto').value;
  hallazgos = [];
  hallazgoActual = -1;
  ultimaAguja = aguja;
  if (!doc || !aguja) { pintarHallazgos(); return; }
  for (let h = 0; h < totalPaginas; h++) {
    // en un expediente largo, mirar 160 hojas de un tirón congela la pantalla
    if (h && h % 8 === 0) {
      cargando(true, 'Buscando… hoja ' + (h + 1) + ' de ' + totalPaginas);
      await new Promise((r) => setTimeout(r, 0));
    }
    apuntarHallazgosDe(h, aguja);
  }
  cargando(false);
  pintarHallazgos();
  if (silencioso) return;
  if (hallazgos.length) irAlHallazgo(0);
  else avisar('No aparece «' + aguja + '» en ninguna hoja.', 'mal');
}

/** Tras cambiar un renglón solo ha podido cambiar ESA hoja: se vuelven a
 *  apuntar sus coincidencias y las demás se dejan como estaban. */
function refrescarHallazgosDe(hoja) {
  if (!doc || !ultimaAguja || ultimaAguja !== $('#buscarTexto').value) return;
  const despues = hallazgos.filter((x) => x.hoja > hoja);
  hallazgos = hallazgos.filter((x) => x.hoja < hoja);
  apuntarHallazgosDe(hoja, ultimaAguja);
  hallazgos = hallazgos.concat(despues);
  if (hallazgoActual >= hallazgos.length) hallazgoActual = -1;
  pintarHallazgos();
}

function pintarHallazgos() {
  const lista = $('#resultados');
  lista.textContent = '';
  const aguja = $('#buscarTexto').value;
  const resumen = $('#buscarResumen');
  const total = hallazgos.reduce((n, x) => n + x.pos.length, 0);
  const hojas = new Set(hallazgos.map((x) => x.hoja)).size;
  resumen.hidden = !aguja || !ultimaAguja;
  resumen.textContent = total === 0 ? 'Sin coincidencias.'
    : total + (total === 1 ? ' coincidencia' : ' coincidencias') + ' en '
      + hojas + (hojas === 1 ? ' hoja' : ' hojas') + '. Pulsa una para ir.';

  hallazgos.forEach((x, i) => {
    const li = document.createElement('li');
    if (i === hallazgoActual) li.classList.add('actual');
    const donde = document.createElement('div');
    donde.className = 'donde';
    donde.textContent = 'Hoja ' + (x.hoja + 1) + (x.pos.length > 1 ? ' · ' + x.pos.length + ' veces' : '');
    const linea = document.createElement('div');
    let i0 = 0;
    for (const j of x.pos) {
      linea.append(document.createTextNode(x.texto.slice(i0, j)));
      const m = document.createElement('mark');
      m.textContent = x.texto.slice(j, j + ultimaAguja.length);
      linea.append(m);
      i0 = j + ultimaAguja.length;
    }
    linea.append(document.createTextNode(x.texto.slice(i0)));
    li.append(donde, linea);

    const motivo = motivosFallo.get(x.hoja + '·' + x.texto);
    if (!x.uniforme || motivo) {
      const p = document.createElement('div');
      p.className = 'porque';
      p.textContent = motivo || 'Mezcla tipografías: «Todas» no lo toca, cámbialo a mano.';
      li.append(p);
    }
    li.addEventListener('click', () => irAlHallazgo(i));
    lista.appendChild(li);
  });
}

function irAlHallazgo(i) {
  const x = hallazgos[i];
  if (!x) return;
  hallazgoActual = i;
  cerrarCampo();
  if (paginaActual !== x.hoja) { paginaActual = x.hoja; dibujar(); }
  else $$('.renglon.hallado').forEach((n) => n.classList.remove('hallado'));
  pintarHallazgos();

  const idx = renglones.findIndex((l) => l.texto === x.texto);
  if (idx < 0) return;
  const nodo = $('#renglones').children[idx];
  if (nodo) {
    nodo.classList.add('hallado');
    nodo.scrollIntoView({ block: 'center', inline: 'center' });
  }
  // con texto de reemplazo puesto, el campo se abre con el cambio ya escrito:
  // basta mirar que está bien y pulsar Enter
  const nuevo = $('#reemplazarTexto').value;
  if (nuevo && x.uniforme) editar(idx, sustituirEn(x.texto, ultimaAguja, nuevo));
}

async function reemplazarTodas() {
  const aguja = $('#buscarTexto').value;
  const nuevo = $('#reemplazarTexto').value;
  if (!doc || !aguja) { avisar('Escribe primero qué hay que buscar.', 'mal'); return; }
  if (nuevo === aguja) { avisar('El texto nuevo es igual al que buscas.', 'mal'); return; }

  const plan = new Map();              // hoja → Map(texto del renglón → veces)
  let saltados = 0;
  for (let h = 0; h < totalPaginas; h++) {
    for (const l of renglonesDeHoja(doc.loadPage(h))) {
      if (!posicionesDe(l.texto, aguja).length) continue;
      // un renglón que mezcla tipografías se reescribiría entero con la de su
      // primera letra: se deja para que lo cambie a mano, viendo el aviso
      if (l.uniforme === false) { saltados++; continue; }
      if (!plan.has(h)) plan.set(h, new Map());
      const m = plan.get(h);
      m.set(l.texto, (m.get(l.texto) || 0) + 1);
    }
  }
  const cuantos = [...plan.values()]
    .reduce((n, m) => n + [...m.values()].reduce((a, b) => a + b, 0), 0);
  if (!cuantos && !saltados) { avisar('No aparece «' + aguja + '» en ninguna hoja.', 'mal'); return; }

  const respaldo = bytesActuales;
  const cambiosAntes = cambios.slice();
  const hojaAntes = paginaActual;
  let hechos = 0, fallos = 0;
  motivosFallo.clear();

  cargando(true, 'Reemplazando…');
  await new Promise((r) => setTimeout(r, 20));
  try {
    for (const [h, mapa] of plan) {
      for (const [original, veces] of mapa) {
        for (let k = 0; k < veces; k++) {
          cargando(true, 'Reemplazando ' + (hechos + 1) + ' de ' + cuantos + '…');
          await new Promise((r) => setTimeout(r, 0));
          paginaActual = h;
          renglones = renglonesDeHoja(doc.loadPage(h));
          const i = renglones.findIndex((l) => l.texto === original);
          if (i < 0) { fallos++; motivosFallo.set(h + '·' + original, 'Ya no estaba al llegar.'); break; }
          const textoNuevo = sustituirEn(original, aguja, nuevo);
          let res;
          try { res = cambiarRenglon(i, textoNuevo); }
          catch (e) { res = { ok: false, motivo: e.message }; }
          if (!res.ok) {
            abrirBytes(bytesActuales, nombre);     // quitar lo que dejó a medias
            fallos++;
            motivosFallo.set(h + '·' + original, res.motivo);
            break;
          }
          cambios.push({ hoja: h, antes: original, despues: textoNuevo,
                         encogido: res.encogido, tipografia: res.tipografia, sobreFoto: res.sobreFoto });
          hechos++;
        }
      }
    }
  } finally {
    if (hechos) {
      pila.push({ bytes: respaldo, cambios: cambiosAntes });
      $('#btnDeshacer').disabled = false;
    } else {
      abrirBytes(respaldo, nombre);
      bytesActuales = respaldo;
      cambios = cambiosAntes;
    }
    paginaActual = Math.min(hojaAntes, totalPaginas - 1);
    cargando(false);
    dibujar();
    if (hechos) { descargado = false; apuntarTrabajo(); }
  }

  await buscarEnTodo(true);
  const partes = [hechos + (hechos === 1 ? ' renglón cambiado' : ' renglones cambiados')];
  if (saltados) partes.push(saltados + ' sin tocar por mezclar tipografías');
  if (fallos) partes.push(fallos + ' que no se pudieron');
  avisar(partes.join(' · ') + (saltados || fallos ? '. Están marcados en la lista.' : '.'),
         fallos || saltados ? 'mal' : 'bien');
}


/* ---------- el modo de insertar ----------
   Mientras está puesto, los renglones dejan de recoger el clic: sin eso no
   hay manera de pulsar en el hueco que hay entre dos. Se quita solo en
   cuanto se escribe algo, para no dejarlo puesto sin querer. */
let insertando = false;

function modoInsertar(si) {
  insertando = !!si && !!doc && !$('#hojaEnvoltura').hidden;
  $('#renglones').classList.toggle('insertando', insertando);
  $('#btnInsertar').classList.toggle('activo', insertando);
  if (!insertando) cerrarCampo();
}

function campoInsertar(xHoja, yHoja) {
  cerrarCampo();
  const capa = $('#renglones');
  const letra = letraParaInsertar(xHoja, yHoja);
  const tam = letra.tam;

  const campo = document.createElement('input');
  campo.className = 'campo';
  campo.type = 'text';
  campo.placeholder = 'Escribe aquí\u2026';
  // se pulsa sobre la LÍNEA BASE, así que la caja sube por encima de ella
  campo.style.left = (xHoja * escala - 3) + 'px';
  campo.style.top = ((yHoja - tam) * escala - 3) + 'px';
  campo.style.minWidth = Math.max(140, 12 * tam * escala) + 'px';
  campo.style.height = (tam * escala * 1.45 + 6) + 'px';
  campo.style.fontSize = Math.max(9, tam * escala * 0.92) + 'px';

  const ayuda = document.createElement('div');
  ayuda.className = 'campo-ayuda';
  ayuda.textContent = 'Se escribirá en ' + letra.elegida.nombre + ' de ' + tam.toFixed(1) + ' pt'
    + (letra.cerca ? ', la letra del renglón más cercano' : '') + ' · Enter para ponerlo · Esc para dejarlo';
  ayuda.style.left = (xHoja * escala - 3) + 'px';
  ayuda.style.top = (yHoja * escala + 8) + 'px';

  campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const v = campo.value;
      cerrarCampo();
      modoInsertar(false);
      if (v.trim()) insertar(xHoja, yHoja, v);
    }
    if (ev.key === 'Escape') { ev.preventDefault(); cerrarCampo(); modoInsertar(false); }
  });
  campo.addEventListener('blur', () => setTimeout(cerrarCampo, 120));

  capa.appendChild(campo);
  capa.appendChild(ayuda);
  campoAbierto = campo;
  campo.focus();
}

$('#renglones').addEventListener('click', (ev) => {
  if (!insertando || campoAbierto) return;
  const caja = ev.currentTarget.getBoundingClientRect();
  campoInsertar((ev.clientX - caja.left) / escala, (ev.clientY - caja.top) / escala);
});

$('#btnInsertar').addEventListener('click', () => modoInsertar(!insertando));

function pintarCambios() {
  const lista = $('#cambios');
  lista.textContent = '';
  // invitar a pulsar un renglón cuando no hay ninguno que pulsar despista
  $('#pistaCambios').hidden = cambios.length > 0 || renglones.length === 0;
  cambios.forEach((c) => {
    const li = document.createElement('li');
    const donde = document.createElement('div');
    donde.className = 'donde';
    donde.textContent = 'Hoja ' + (c.hoja + 1)
      + (c.encogido ? ' · ajustado al ' + c.encogido + ' %' : '')
      + (c.sobreFoto ? ' · sobre la foto' : '')
      + (c.tipografia ? ' · escrito en ' + c.tipografia : '');
    const a = document.createElement('div'); a.className = 'antes';
    const b = document.createElement('div'); b.className = 'despues';
    if (c.antes) a.textContent = c.antes;
    else { a.className = 'antes vacio-cambio'; a.textContent = '(no había nada)'; }
    if (c.despues) b.textContent = c.despues;
    else { b.className = 'despues vacio-cambio'; b.textContent = '(borrado)'; }
    li.append(donde, a, b);
    lista.appendChild(li);
  });
}

function pintarReconocido(conOCR) {
  const caja = $('#reconocido');
  const r = reconocidos.get(paginaActual);
  caja.hidden = !conOCR;
  if (!conOCR) return;
  $('#reconocidoResumen').textContent = (r
    ? `${r.renglones} renglones · ${r.palabras} palabras · ${r.confianza} % de confianza · ${(r.ms / 1000).toFixed(1)} s. `
    : 'Esta hoja ya lleva texto reconocido. ')
    + 'Ya se puede buscar y copiar. Y se puede corregir: al hacerlo se tapa la zona '
    + 'con el color del papel y se escribe encima, así que la foto cambia también.';
  $('#reconocidoTexto').value = r ? r.texto.trim() : '(reconocido en otro momento)';
  $('#reconocidoTexto').hidden = !r;
  $('#btnCopiarTexto').hidden = !r;
}

function deshacer() {
  const paso = pila.pop();
  if (!paso) return;
  abrirBytes(paso.bytes, nombre);
  bytesActuales = paso.bytes;
  cambios = paso.cambios;
  $('#btnDeshacer').disabled = pila.length === 0;
  pintarCambios();
  dibujar();
  if (ultimaAguja) buscarEnTodo(true);
  descargado = false;
  apuntarTrabajo();
  avisar('Deshecho.');
}

/* ---------- entrada y salida de archivos ---------- */
function leerArchivo(f) {
  if (!f) return;
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
    avisar('Por ahora solo PDF.', 'mal'); return;
  }
  cargando(true, 'Abriendo ' + f.name + '…');
  const lector = new FileReader();
  lector.onload = () => {
    estrenarDocumento(new Uint8Array(lector.result), f.name);
    cargando(false);
  };
  lector.onerror = () => { cargando(false); avisar('No se pudo leer el archivo.', 'mal'); };
  lector.readAsArrayBuffer(f);
}

function descargar() {
  const b = new Blob([bytesActuales], { type: 'application/pdf' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u;
  a.download = nombre.replace(/\.pdf$/i, '') + ' (editado).pdf';
  a.click();
  descargado = true;
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

function devolver() {
  if (!grapa || grapa.closed) { avisar('La ventana de Grapa ya no está abierta.', 'mal'); return; }
  grapa.postMessage({ grapa: 'documento-editado', nombre, bytes: bytesActuales, cambios: cambios.length }, '*');
  descargado = true;
  avisar('Devuelto a Grapa.', 'bien');
}

/* ---------- el puente con Grapa ---------- */
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || d.grapa !== 'documento') return;
  grapa = ev.source || window.opener;
  $('#btnDevolver').hidden = false;
  estrenarDocumento(new Uint8Array(d.bytes), d.nombre || 'documento.pdf');
  avisar('Documento recibido de Grapa.', 'bien');
});

/* ---------- conexiones de la interfaz ---------- */
$('#btnEntendidoFirma').addEventListener('click', () => { $('#avisoFirma').hidden = true; });
$('#btnAbrir').addEventListener('click', () => $('#archivo').click());
$('#archivo').addEventListener('change', (e) => { leerArchivo(e.target.files[0]); e.target.value = ''; });
$('#btnDescargar').addEventListener('click', descargar);
$('#btnDevolver').addEventListener('click', devolver);
$('#btnDeshacer').addEventListener('click', deshacer);
$('#btnReconocer').addEventListener('click', reconocerHoja);
$('#btnCopiarTexto').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#reconocidoTexto').value);
    avisar('Copiado.', 'bien');
  } catch (e) {
    $('#reconocidoTexto').select();          // sin permiso de portapapeles, al menos queda marcado
    avisar('Selecciónalo y copia con Ctrl+C.', '');
  }
});
$('#btnBuscar').addEventListener('click', () => buscarEnTodo());
$('#btnReemplazarTodo').addEventListener('click', reemplazarTodas);
$('#buscarMayus').addEventListener('change', () => { if ($('#buscarTexto').value) buscarEnTodo(); });
$('#buscarTexto').addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  // la primera vez busca; con la misma palabra, salta al siguiente resultado
  if (ultimaAguja === $('#buscarTexto').value && hallazgos.length) {
    irAlHallazgo((hallazgoActual + 1) % hallazgos.length);
  } else buscarEnTodo();
});
$('#reemplazarTexto').addEventListener('keydown', (ev) => {
  // Enter aquí NO reemplaza: cambiar veinte renglones sin querer no se
  // arregla con un «ay». Busca, y el botón «Todas» hace el resto.
  if (ev.key === 'Enter') { ev.preventDefault(); buscarEnTodo(); }
});

$('#pagAnterior').addEventListener('click', () => { if (paginaActual > 0) { paginaActual--; cerrarCampo(); dibujar(); } });
$('#pagSiguiente').addEventListener('click', () => { if (paginaActual < totalPaginas - 1) { paginaActual++; cerrarCampo(); dibujar(); } });
$('#zoom').addEventListener('input', (e) => { escala = Number(e.target.value) / 100; cerrarCampo(); if (doc) dibujar(); });

/* ---------- deslizadores con botones ----------
   Arrastrar el tirador pide pulso fino y basta un roce para pasarse de
   largo. Un «−» y un «+» a los lados mueven de a un paso, y mantenidos
   siguen solos. El acercamiento sube multiplicando, no sumando, para que
   el salto se note igual de grande abajo que arriba. */
function moverDeslizador(ent, dir, factor) {
  const min = Number(ent.min || 0), max = Number(ent.max || 100);
  const antes = Number(ent.value);
  let v = dir > 0 ? antes * factor : antes / factor;
  // con valores pequeños el redondeo se comía el paso entero
  v = dir > 0 ? Math.max(Math.ceil(v), antes + 1) : Math.min(Math.floor(v), antes - 1);
  v = Math.max(min, Math.min(max, Math.round(v)));
  if (v === antes) return false;
  ent.value = String(v);
  ent.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function ponerBotonesDePaso(sel, nombre, factor) {
  const ent = $(sel);
  if (!ent) return;
  const caja = document.createElement('span');
  caja.className = 'deslizador';
  ent.parentNode.insertBefore(caja, ent);
  const boton = (dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn paso';
    b.textContent = dir > 0 ? '+' : '\u2212';
    b.title = (dir > 0 ? 'Más ' : 'Menos ') + nombre + ' (mantén pulsado para seguir)';
    b.setAttribute('aria-label', (dir > 0 ? 'Más ' : 'Menos ') + nombre);
    let tempo = 0;
    const parar = () => { clearTimeout(tempo); tempo = 0; };
    const seguir = (espera) => {
      tempo = setTimeout(() => {
        if (moverDeslizador(ent, dir, factor)) seguir(110); else parar();
      }, espera);
    };
    b.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      ev.preventDefault();                       // ni arrastra la página ni roba el foco
      try { b.setPointerCapture(ev.pointerId); } catch (e) {}
      moverDeslizador(ent, dir, factor);
      seguir(420);
    });
    ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach((t) => b.addEventListener(t, parar));
    // con el teclado no hay pointerdown y el clic llega con detail 0
    b.addEventListener('click', (ev) => { if (!ev.detail) moverDeslizador(ent, dir, factor); });
    return b;
  };
  caja.appendChild(boton(-1));
  caja.appendChild(ent);
  caja.appendChild(boton(1));
}
ponerBotonesDePaso('#zoom', 'tamaño', 1.12);

$('#btnTema').addEventListener('click', () => {
  const ahora = document.documentElement.getAttribute('data-tema');
  const nuevo = ahora === 'oscuro' ? 'claro' : 'oscuro';
  document.documentElement.setAttribute('data-tema', nuevo);
  try { localStorage.setItem('grapa-editor-tema', nuevo); } catch (e) {}
});
try {
  const t = localStorage.getItem('grapa-editor-tema');
  if (t) document.documentElement.setAttribute('data-tema', t);
} catch (e) {}

document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'f') {
    ev.preventDefault();
    $('#buscarTexto').focus();
    $('#buscarTexto').select();
    return;
  }
  // escribiendo en una caja, las flechas mueven el cursor, no la hoja
  const en = ev.target && ev.target.tagName;
  if (campoAbierto || en === 'INPUT' || en === 'TEXTAREA' || en === 'SELECT') return;
  if (ev.key === 'ArrowRight' || ev.key === 'PageDown') $('#pagSiguiente').click();
  if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') $('#pagAnterior').click();
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); deshacer(); }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'i') { ev.preventDefault(); modoInsertar(!insertando); }
  if (ev.key === 'Escape' && insertando) modoInsertar(false);
});

const escena = $('#escena');
['dragenter', 'dragover'].forEach((n) => escena.addEventListener(n, (e) => {
  e.preventDefault(); escena.classList.add('arrastrando');
}));
['dragleave', 'drop'].forEach((n) => escena.addEventListener(n, (e) => {
  e.preventDefault(); escena.classList.remove('arrastrando');
}));
escena.addEventListener('drop', (e) => leerArchivo(e.dataTransfer.files[0]));

/* avisar a Grapa de que ya estamos listos para recibir */
try {
  if (window.opener) window.opener.postMessage({ grapa: 'editor-listo' }, '*');
} catch (e) { /* sin ventana madre, se usa suelto */ }

/* ---------- no perder el trabajo ----------

   Hasta ahora, recargar la pestaña sin querer se llevaba por delante una
   tarde entera: el documento vivía solo en memoria. Ahora, tras cada
   cambio, el documento y su lista de cambios se guardan en la base de
   datos del propio navegador, y al volver a abrir el editor se ofrece
   recuperarlos.

   Se guarda EN ESTE EQUIPO y en ningún otro sitio: es la base de datos que
   el navegador tiene para esta página, no un servidor. Aun así se dice
   claramente y se puede apagar, porque en un ordenador compartido dejar un
   expediente ahí no es cosa menor. Apagarlo borra lo que hubiera. */

const BD_NOMBRE = 'grapa-editor', BD_ALMACEN = 'trabajo', BD_CLAVE = 'actual';
const CLAVE_PERMISO = 'grapa-editor-guardar';
let bd = null;
let relojGuardado = 0;
let descargado = true;          // ¿lo último está ya fuera, bajado o devuelto?

function seGuarda() { return $('#guardarAqui').checked; }

function abrirBD() {
  if (bd) return Promise.resolve(bd);
  return new Promise((listo, mal) => {
    let p;
    try { p = indexedDB.open(BD_NOMBRE, 1); }
    catch (e) { mal(e); return; }
    p.onupgradeneeded = () => { p.result.createObjectStore(BD_ALMACEN); };
    p.onsuccess = () => { bd = p.result; listo(bd); };
    p.onerror = () => mal(p.error);
    p.onblocked = () => mal(new Error('la base de datos está ocupada'));
  });
}

function enBD(modo, hacer) {
  return abrirBD().then((b) => new Promise((listo, mal) => {
    const t = b.transaction(BD_ALMACEN, modo);
    const pedido = hacer(t.objectStore(BD_ALMACEN));
    t.oncomplete = () => listo(pedido && pedido.result);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error);
  }));
}

function haceCuanto(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 75) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return 'hace ' + m + (m === 1 ? ' minuto' : ' minutos');
  const h = Math.round(m / 60);
  if (h < 24) return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
  const d = Math.round(h / 24);
  return 'hace ' + d + (d === 1 ? ' día' : ' días');
}

let ultimoGuardado = 0, guardarFalla = '';
function pintarEstadoGuardado() {
  const p = $('#guardadoEstado');
  if (!seGuarda()) { p.textContent = 'Apagado: al cerrar la pestaña se pierde lo que lleves.'; return; }
  if (guardarFalla) { p.textContent = 'No se pudo guardar aquí (' + guardarFalla + '). Descarga el PDF para no perderlo.'; return; }
  if (!ultimoGuardado) { p.textContent = 'Se guardará aquí, en este equipo, según vayas cambiando cosas.'; return; }
  p.textContent = 'Guardado ' + haceCuanto(ultimoGuardado) + ', solo en este equipo.';
}

async function guardarTrabajo() {
  if (!doc || !bytesActuales || !seGuarda()) return;
  try {
    await enBD('readwrite', (a) => a.put({
      nombre, bytes: bytesActuales, cambios, hoja: paginaActual, cuando: Date.now(),
    }, BD_CLAVE));
    ultimoGuardado = Date.now();
    guardarFalla = '';
  } catch (e) {
    guardarFalla = e && e.name ? e.name : 'error';
  }
  pintarEstadoGuardado();
}

/** Se apunta el trabajo un momento después del cambio: encadenando
 *  «reemplazar todas» no tiene sentido escribirlo veinte veces. */
function apuntarTrabajo() {
  clearTimeout(relojGuardado);
  relojGuardado = setTimeout(guardarTrabajo, 1200);
}

async function olvidarTrabajo() {
  try { await enBD('readwrite', (a) => a.delete(BD_CLAVE)); } catch (e) {}
  ultimoGuardado = 0;
  pintarEstadoGuardado();
}

async function mirarSiHayTrabajo() {
  if (!seGuarda()) { pintarEstadoGuardado(); return; }
  let g = null;
  try { g = await enBD('readonly', (a) => a.get(BD_CLAVE)); } catch (e) { guardarFalla = e && e.name; }
  pintarEstadoGuardado();
  if (!g || !g.bytes || !g.bytes.length) return;
  if (doc) return;                       // ya llegó algo: no estorbar
  guardadoEnEspera = g;
  const n = (g.cambios || []).length;
  $('#recuperarDetalle').textContent = g.nombre + ' · '
    + (n ? n + (n === 1 ? ' cambio' : ' cambios') : 'sin cambios todavía')
    + ' · ' + haceCuanto(g.cuando);
  $('#recuperar').hidden = false;
}
let guardadoEnEspera = null;

$('#btnRecuperar').addEventListener('click', () => {
  const g = guardadoEnEspera;
  $('#recuperar').hidden = true;
  if (!g) return;
  cargando(true, 'Recuperando ' + g.nombre + '…');
  setTimeout(() => {
    estrenarDocumento(new Uint8Array(g.bytes), g.nombre);
    cambios = (g.cambios || []).slice();
    paginaActual = Math.min(g.hoja || 0, totalPaginas - 1);
    descargado = !cambios.length;
    pintarCambios();
    dibujar();
    cargando(false);
    avisar('Recuperado donde lo dejaste.', 'bien');
  }, 20);
});

$('#btnDescartar').addEventListener('click', () => {
  $('#recuperar').hidden = true;
  guardadoEnEspera = null;
  olvidarTrabajo();
  avisar('Borrado lo que había guardado.');
});

$('#guardarAqui').addEventListener('change', () => {
  try { localStorage.setItem(CLAVE_PERMISO, seGuarda() ? '1' : '0'); } catch (e) {}
  if (seGuarda()) { guardarTrabajo(); }
  else { $('#recuperar').hidden = true; olvidarTrabajo(); }
  pintarEstadoGuardado();
});

try {
  if (localStorage.getItem(CLAVE_PERMISO) === '0') $('#guardarAqui').checked = false;
} catch (e) {}

// avisar antes de cerrar con cambios que no han salido de aquí
window.addEventListener('beforeunload', (ev) => {
  if (!doc || descargado) return;
  ev.preventDefault();
  ev.returnValue = '';
});

mirarSiHayTrabajo();

window.grapaEditorListo = true;
