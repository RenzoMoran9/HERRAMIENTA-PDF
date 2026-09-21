/* ===========================================================
   Grapa · Editor de texto
   Todo ocurre dentro del navegador: el documento no sale del
   equipo, no hay servidor y no hace falta internet.
   =========================================================== */

/*IMPORTA*/ import { PDFDocument, Font, Buffer, Matrix, ColorSpace, Pixmap, Image } from '../lib/mupdf.js';
/*IMPORTA-RECONOCER*/ import { reconocer } from './ocr.js';

const $ = (s) => document.querySelector(s);

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
  let x0 = 0, y1 = lim[3] - lim[1], giro = 0;
  try {
    const obj = pagina.getObject();
    const mb = obj.get('MediaBox');
    if (mb && mb.isArray() && mb.length === 4) {
      const v = [0, 1, 2, 3].map((i) => mb.get(i).asNumber());
      x0 = Math.min(v[0], v[2]);
      y1 = Math.max(v[1], v[3]);
    }
    const rot = obj.get('Rotate');
    if (rot && rot.isNumber()) giro = ((rot.asNumber() % 360) + 360) % 360;
  } catch (e) { /* nos quedamos con los límites de la página */ }
  return { x0, y1, giro, ancho: lim[2] - lim[0], alto: lim[3] - lim[1] };
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

function estrenarDocumento(bytes, comoSeLlama) {
  paginaActual = 0;
  pila = []; cambios = []; contadorFuente = 0; reconocidos.clear();
  if (!abrirBytes(bytes, comoSeLlama)) return;
  $('#vacio').hidden = true;
  $('#paginador').hidden = false;
  $('#btnDescargar').disabled = false;
  pintarCambios();
  dibujar();
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
  renglones = modelo
    ? modelo.renglones.map((r, i) => ({
        texto: r.t, bbox: [r.x0, r.y0, r.x1, r.y1],
        x: r.x0, y: r.y1, size: r.y1 - r.y0,
        color: r.tinta || [0, 0, 0], uniforme: true,
        deEscaneo: true, enModelo: i,
      })).filter((r) => r.texto)
    : leerRenglones(pagina);

  // Una hoja puede estar de tres maneras: con texto de verdad (se corrige),
  // escaneada y muda (se puede reconocer), o escaneada y ya reconocida (se
  // busca y se copia, pero no se corrige: la foto seguiría diciendo lo de
  // antes y el documento mostraría una cosa y copiaría otra).
  // en una hoja reconocida los renglones SÍ se pueden corregir: al hacerlo se
  // tapa la zona y se reescribe encima, de modo que la foto y el texto van
  // siempre a la vez y no pueden acabar diciendo cosas distintas
  const conOCR = !!modelo;
  const esEscaneo = renglones.length === 0 && !conOCR;
  pintarRenglones();
  $('#cartelEscaneo').hidden = !esEscaneo;
  $('#hojaEnvoltura').hidden = esEscaneo;
  pintarReconocido(conOCR);
  pintarCambios();

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
    (marco.giro ? ' · hoja girada ' + marco.giro + '°' : '');
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

function editar(indice) {
  cerrarCampo();
  const r = renglones[indice];
  const capa = $('#renglones');

  const campo = document.createElement('input');
  campo.className = 'campo';
  campo.type = 'text';
  campo.value = r.texto;
  campo.style.left = (r.bbox[0] * escala - 3) + 'px';
  campo.style.top = (r.bbox[1] * escala - 3) + 'px';
  campo.style.minWidth = ((r.bbox[2] - r.bbox[0]) * escala + 24) + 'px';
  campo.style.height = ((r.bbox[3] - r.bbox[1]) * escala + 6) + 'px';
  campo.style.fontSize = Math.max(9, r.size * escala * 0.92) + 'px';

  const ayuda = document.createElement('div');
  ayuda.className = 'campo-ayuda';
  ayuda.textContent = r.deEscaneo
    ? 'Se tapará la zona y se escribirá encima · Enter para aplicar · Esc para dejarlo'
    : r.uniforme
      ? 'Enter para aplicar · Esc para dejarlo como está'
      : 'Cuidado: este renglón mezcla tipografías o tamaños';
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
      v: 1,
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
  for (const r of modelo.renglones) {
    const ancho = r.x1 - r.x0, alto = r.y1 - r.y0;
    if (ancho <= 0.5 || alto <= 0.5 || !r.t) continue;
    const met = metricaDe(r.t);
    const tam = r.editado && r.tam ? r.tam : alto / Math.max(0.3, met.alto);
    const cual = r.editado && r.negrita ? negrita : normal;
    const natural = medirAncho(cual, r.t, tam);
    const hueco = (r.editado && r.hueco) || ancho;
    // el renglón corregido se encoge si no cabe, pero NO se estira: estirarlo
    // para rellenar el hueco del texto viejo deja las letras separadas y canta
    const tz = natural <= 0.01 ? 100
      : r.editado ? Math.max(55, Math.min(100, (hueco / natural) * 100))
      : Math.max(5, Math.min(900, (ancho / natural) * 100));
    const x = (r.editado && r.x != null ? r.x : r.x0) + marco.x0;

    if (r.editado) {
      // Tapar: con un trozo de papel de verdad, sacado de las filas limpias
      // de al lado, si se pudo sacar; con su color liso si no.
      const [tr, tg, tb] = r.tinta || [0, 0, 0];
      if (r.parche && r.parcheCaja) {
        const [px0, py0, pan, pal] = r.parcheCaja;
        buf.writeLine('q ' + pan.toFixed(2) + ' 0 0 ' + pal.toFixed(2) + ' '
          + (px0 + marco.x0).toFixed(2) + ' ' + (marco.y1 - py0 - pal).toFixed(2)
          + ' cm /' + r.parche + ' Do Q');
      } else {
        const m = Math.max(0.8, alto * 0.16);
        const [pr, pg, pb] = r.papel || [1, 1, 1];
        buf.writeLine('q ' + pr.toFixed(4) + ' ' + pg.toFixed(4) + ' ' + pb.toFixed(4) + ' rg '
          + (x - m).toFixed(2) + ' ' + (marco.y1 - r.y1 - m).toFixed(2) + ' '
          + (ancho + m * 2).toFixed(2) + ' ' + (alto + m * 2).toFixed(2) + ' re f Q');
      }
      // Si el renglón va dentro de la imagen, aquí solo se escribe el texto
      // INVISIBLE, para poder buscarlo y copiarlo. Si no hubo parche, se
      // escribe a la vista, que es el respaldo.
      const modo = r.parche && r.parcheCaja ? '3 Tr ' : '';
      buf.writeLine('q BT ' + modo + '/' + (r.negrita ? claveN : clave) + ' ' + tam.toFixed(2)
        + ' Tf ' + tz.toFixed(2) + ' Tz '
        + tr.toFixed(4) + ' ' + tg.toFixed(4) + ' ' + tb.toFixed(4) + ' rg 1 0 0 1 '
        + x.toFixed(2) + ' '
        + (marco.y1 - (r.base != null ? r.base : r.y1 - met.abajo * tam)).toFixed(2) + ' Tm ('
        + escapar(r.t) + ') Tj ET Q');
    } else {
      buf.writeLine('q BT 3 Tr /' + clave + ' ' + tam.toFixed(2) + ' Tf ' + tz.toFixed(2)
        + ' Tz 1 0 0 1 ' + x.toFixed(2) + ' ' + (marco.y1 - r.y1 + met.abajo * tam).toFixed(2)
        + ' Tm (' + escapar(r.t) + ') Tj ET Q');
    }
  }

  // un solo flujo, reescrito entero: si ya existe, se sustituye
  let capa = objPag.get(CLAVE_CAPA);
  if (capa && capa.isStream && capa.isStream()) {
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
function aplicar(indice, textoNuevo) {
  const r = renglones[indice];
  if (textoNuevo === r.texto) return;
  if (!textoNuevo.trim()) { avisar('Para borrar un renglón entero aún no; deja al menos un carácter.', 'mal'); return; }

  const respaldo = bytesActuales;
  cargando(true, 'Aplicando el cambio…');

  setTimeout(() => {
    try {
      const resultado = renglones[indice].deEscaneo
        ? reescribirEnEscaneo(indice, textoNuevo)
        : reescribir(indice, textoNuevo);
      if (!resultado.ok) {
        abrirBytes(respaldo, nombre);          // volver atrás
        cargando(false);
        avisar(resultado.motivo, 'mal');
        dibujar();
        return;
      }
      pila.push({ bytes: respaldo, cambios: cambios.slice() });
      cambios.push({
        hoja: paginaActual, antes: r.texto, despues: textoNuevo,
        encogido: resultado.encogido, tipografia: resultado.tipografia,
        sobreFoto: resultado.sobreFoto,
      });
      $('#btnDeshacer').disabled = false;
      cargando(false);
      pintarCambios();
      dibujar();
      avisar((resultado.sobreFoto ? 'Cambiado sobre la foto' : 'Cambiado')
        + (resultado.encogido ? `, ajustado al ancho original (${resultado.encogido} %)` : '') + '.', 'bien');
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
  if (marco.giro !== 0) {
    return { ok: false, motivo: 'Esta hoja está girada ' + marco.giro + '°; el editor todavía no escribe sobre hojas giradas.' };
  }
  const modelo = modeloDe(pagina);
  const fila = modelo && modelo.renglones[r.enModelo];
  if (!fila) return { ok: false, motivo: 'No encuentro el reconocimiento de esta hoja; vuelve a reconocerla.' };

  const antes = fila.t, eraEditado = !!fila.editado;

  // Se mide el renglón ORIGINAL y se copian sus rasgos. El tamaño y la línea
  // base se deducen de lo que ocupa la tinta de verdad, no del recuadro que
  // da el reconocimiento, que es algo más alto y dejaba la letra crecida.
  const med = eraEditado ? null : medirRenglon(pagina, [fila.x0, fila.y0, fila.x1, fila.y1]);
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
  fila.t = textoNuevo;
  fila.editado = true;

  if (guardado) {
    const nombre = 'GrapaParche' + r.enModelo;
    incrustarParche(pagina, nombre, componerAjustado(guardado.p, fila, guardado.s));
    fila.parche = nombre;
    fila.parcheCaja = [guardado.p.x, guardado.p.y, guardado.p.ancho, guardado.p.alto];
  }

  const salida = aplicarCapa(pagina, modelo, marco);
  const volver = (motivo) => {
    fila.t = antes; fila.editado = eraEditado;
    return { ok: false, motivo };
  };

  const comprobar = PDFDocument.openDocument(salida, 'application/pdf');
  const texto = comprobar.loadPage(paginaActual).toStructuredText('preserve-whitespace').asText();
  if (!texto.includes(textoNuevo.trim())) return volver('El texto nuevo no quedó donde debía; no se cambió nada.');
  if (antes.trim() && texto.includes(antes.trim())) return volver('El texto viejo seguía ahí; no se cambió nada.');

  bytesActuales = salida;
  abrirBytes(salida, nombre);
  return { ok: true, sobreFoto: true };
}


function reescribir(indice, textoNuevo) {
  const r = renglones[indice];
  const pagina = doc.loadPage(paginaActual);
  const marco = marcoDe(pagina);

  if (marco.giro !== 0) {
    return { ok: false, motivo: 'Esta hoja está girada ' + marco.giro + '°; el editor todavía no escribe sobre hojas giradas.' };
  }

  // 1. quitar el texto viejo de dentro del archivo, no taparlo
  const an = pagina.createAnnotation('Redact');
  an.setRect([r.bbox[0], r.bbox[1], r.bbox[2], r.bbox[3]]);
  an.update();
  pagina.applyRedactions(false);

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

  const xPdf = r.x + marco.x0;
  const yPdf = marco.y1 - r.y;
  const [cr, cg, cb] = r.color || [0, 0, 0];
  const buf = new Buffer();
  buf.writeLine(
    'q BT /' + clave + ' ' + r.size + ' Tf ' + tz.toFixed(2) + ' Tz ' +
    cr.toFixed(4) + ' ' + cg.toFixed(4) + ' ' + cb.toFixed(4) + ' rg ' +
    '1 0 0 1 ' + xPdf.toFixed(3) + ' ' + yPdf.toFixed(3) + ' Tm (' + escapar(textoNuevo) + ') Tj ET Q'
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
    const a = document.createElement('div'); a.className = 'antes'; a.textContent = c.antes;
    const b = document.createElement('div'); b.className = 'despues'; b.textContent = c.despues;
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
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

function devolver() {
  if (!grapa || grapa.closed) { avisar('La ventana de Grapa ya no está abierta.', 'mal'); return; }
  grapa.postMessage({ grapa: 'documento-editado', nombre, bytes: bytesActuales, cambios: cambios.length }, '*');
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
$('#pagAnterior').addEventListener('click', () => { if (paginaActual > 0) { paginaActual--; cerrarCampo(); dibujar(); } });
$('#pagSiguiente').addEventListener('click', () => { if (paginaActual < totalPaginas - 1) { paginaActual++; cerrarCampo(); dibujar(); } });
$('#zoom').addEventListener('input', (e) => { escala = Number(e.target.value) / 100; cerrarCampo(); if (doc) dibujar(); });

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
  if (campoAbierto) return;
  if (ev.key === 'ArrowRight' || ev.key === 'PageDown') $('#pagSiguiente').click();
  if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') $('#pagAnterior').click();
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); deshacer(); }
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

window.grapaEditorListo = true;
