/* ===========================================================
   Grapa · Editor de texto
   Todo ocurre dentro del navegador: el documento no sale del
   equipo, no hay servidor y no hace falta internet.
   =========================================================== */

/*IMPORTA*/ import { PDFDocument, Font, Buffer, Matrix, ColorSpace } from '../lib/mupdf.js';
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
  try {
    const m = pagina.getObject().get('GrapaOCR');
    return !!(m && m.asBoolean && m.asBoolean());
  } catch (e) { return false; }
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

  renglones = leerRenglones(pagina);
  pintarRenglones();

  // Una hoja puede estar de tres maneras: con texto de verdad (se corrige),
  // escaneada y muda (se puede reconocer), o escaneada y ya reconocida (se
  // busca y se copia, pero no se corrige: la foto seguiría diciendo lo de
  // antes y el documento mostraría una cosa y copiaría otra).
  const conOCR = llevaOCR(pagina);
  const esEscaneo = renglones.length === 0 && !conOCR;
  if (conOCR) { renglones = []; capaRenglones(); }
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
  ayuda.textContent = r.uniforme
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

/* ---------- reconocer el texto de una hoja escaneada ----------
   Se lee la foto y se le pone encima una capa de texto INVISIBLE, palabra
   por palabra y cada una en su sitio. La foto no se toca: lo que se ve
   sigue siendo exactamente el papel que se escaneó. Lo que se gana es que
   el PDF pasa a poder buscarse y copiarse, también fuera de aquí. */
const PPP_OCR = 200;

async function reconocerHoja() {
  if (!doc) return;
  const pagina = doc.loadPage(paginaActual);
  const marco = marcoDe(pagina);
  const escala = PPP_OCR / 72;

  cargando(true, 'Preparando el reconocimiento…');
  try {
    const pix = pagina.toPixmap(Matrix.scale(escala, escala), ColorSpace.DeviceRGB, false, true);
    const foto = new Blob([pix.asPNG()], { type: 'image/png' });
    pix.destroy();

    const t0 = performance.now();
    const salida = await reconocer(foto, (estado, avance) => {
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

    if (!salida.palabras.length) {
      cargando(false);
      avisar('No se reconoció ninguna palabra en esta hoja.', 'mal');
      return;
    }

    const respaldo = bytesActuales;
    cargando(true, 'Poniendo el texto encima de la foto…');
    const bytes = escribirCapaOCR(pagina, salida.palabras, escala, marco);
    if (!bytes) { abrirBytes(respaldo, nombre); cargando(false); avisar('No se pudo escribir el texto.', 'mal'); return; }

    pila.push({ bytes: respaldo, cambios: cambios.slice() });
    $('#btnDeshacer').disabled = false;
    bytesActuales = bytes;
    abrirBytes(bytes, nombre);
    reconocidos.set(paginaActual, {
      texto: salida.texto, confianza: Math.round(salida.confianza),
      palabras: salida.palabras.length, ms,
    });
    cargando(false);
    dibujar();
    avisar(`Reconocidas ${salida.palabras.length} palabras (${Math.round(salida.confianza)} % de confianza) en ${(ms / 1000).toFixed(1)} s.`, 'bien');
  } catch (e) {
    console.error(e);
    cargando(false);
    avisar('No se pudo reconocer: ' + e.message, 'mal');
  }
}

function escribirCapaOCR(pagina, palabras, escala, marco) {
  const fuente = new Font('Helvetica');
  const clave = 'GrapaOCR';
  const refFuente = doc.addSimpleFont(fuente, 'Latin');
  const objPag = pagina.getObject();
  let rec = objPag.get('Resources');
  if (!rec.isDictionary()) { rec = doc.addObject(doc.newDictionary()); objPag.put('Resources', rec); }
  let fuentes = rec.get('Font');
  if (!fuentes.isDictionary()) { fuentes = doc.addObject(doc.newDictionary()); rec.put('Font', fuentes); }
  fuentes.put(clave, refFuente);

  const buf = new Buffer();
  let puestas = 0;
  for (const w of palabras) {
    const ancho = (w.x1 - w.x0) / escala;
    const alto = (w.y1 - w.y0) / escala;
    if (ancho <= 0.5 || alto <= 0.5) continue;
    const tam = alto;
    const natural = medirAncho(fuente, w.texto, tam);
    // se estira o encoge cada palabra para que su recuadro coincida con el
    // de la foto: así lo que se selecciona es lo que se ve
    const tz = natural > 0.01 ? Math.max(5, Math.min(900, (ancho / natural) * 100)) : 100;
    const x = w.x0 / escala + marco.x0;
    const y = marco.y1 - w.y1 / escala;
    buf.writeLine('q BT 3 Tr /' + clave + ' ' + tam.toFixed(2) + ' Tf ' + tz.toFixed(2)
      + ' Tz 1 0 0 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Tm ('
      + escapar(w.texto) + ') Tj ET Q');
    puestas++;
  }
  if (!puestas) return null;

  const refFlujo = doc.addStream(buf, {});
  let cont = objPag.get('Contents');
  if (cont.isArray()) { cont.push(refFlujo); }
  else { const arr = doc.newArray(); arr.push(cont); arr.push(refFlujo); objPag.put('Contents', arr); }
  objPag.put('GrapaOCR', doc.newBoolean(true));   // la marca, para reconocerlo después
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
      const resultado = reescribir(indice, textoNuevo);
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
      });
      $('#btnDeshacer').disabled = false;
      cargando(false);
      pintarCambios();
      dibujar();
      avisar(resultado.encogido
        ? `Cambiado, y ajustado al ancho original (${resultado.encogido} %).`
        : 'Cambiado.', 'bien');
    } catch (e) {
      abrirBytes(respaldo, nombre);
      cargando(false);
      dibujar();
      avisar('No se pudo aplicar: ' + e.message, 'mal');
    }
  }, 20);
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
  $('#reconocidoResumen').textContent = r
    ? `${r.palabras} palabras · ${r.confianza} % de confianza · ${(r.ms / 1000).toFixed(1)} s. `
      + 'Ya se puede buscar y copiar en el PDF. No se corrige: la foto seguiría diciendo lo de antes.'
    : 'Esta hoja ya lleva texto reconocido: se puede buscar y copiar, pero no corregir, '
      + 'porque la foto seguiría diciendo lo de antes.';
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
