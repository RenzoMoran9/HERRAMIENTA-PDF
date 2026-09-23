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
let tachas = [];            // { hoja, caja: [x0, y0, x1, y1] } · lo que se va a tachar
let tachando = false;       // ¿se están marcando zonas para tachar?

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
  if (!si) { $('#cargaBarra').hidden = true; $('#cargaDetener').hidden = true; }
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
            letras: l,          // hace falta para cambiar solo el trozo que cambió
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

/* ---------- escribir con la tipografía del propio documento ----------

   Al reescribir un renglón se usaba una de las catorce tipografías que todo
   lector trae de serie, la más parecida. En un documento corriente no se
   nota; en uno con personalidad, sí, y es lo que hacía que lo corregido «se
   sintiera distinto» aunque el tamaño, el color y el sitio fueran los
   mismos.

   Pero la tipografía buena ya está dentro del archivo, incrustada. Lo único
   que falta es saber con qué número se pide cada letra, y eso lo dice el
   /ToUnicode de la propia tipografía: la tabla que usa el lector para
   copiar y pegar, que dice qué letra es cada número. Se le da la vuelta.

   Dos cosas que hay que respetar:

     · Un PDF incrusta solo las letras que USÓ. Si el texto nuevo trae una
       que no está —una eñe en un documento que no tenía ninguna— no hay
       nada que hacer con esa tipografía, y se vuelve a la de serie.
     · Los anchos son los suyos, no los de Helvetica, y hay que leerlos de
       su tabla (/W en las CID, /Widths en las sencillas) o el renglón sale
       apretado o suelto.                                                  */

/** Los recursos de una hoja pueden venir heredados del nodo de arriba. */
function recursosDe(objPag) {
  let n = objPag, hondo = 0;
  while (n && n.isDictionary && n.isDictionary() && hondo++ < 16) {
    const r = n.get('Resources');
    if (r && r.isDictionary && r.isDictionary()) return r;
    n = n.get('Parent');
  }
  return null;
}

/** El diccionario de tipografías donde escribir, creándolo si no lo hay.
 *  Ojo: poner un Resources nuevo en la hoja TAPA el heredado y la dejaría
 *  sin sus propias tipografías, así que primero se busca hacia arriba. */
function fuentesDe(objPag) {
  let rec = recursosDe(objPag);
  if (!rec) { rec = doc.addObject(doc.newDictionary()); objPag.put('Resources', rec); }
  let fuentes = rec.get('Font');
  if (!fuentes || !fuentes.isDictionary()) {
    fuentes = doc.addObject(doc.newDictionary());
    rec.put('Font', fuentes);
  }
  return fuentes;
}

/** Le da la vuelta al /ToUnicode: de «qué letra es este número» a «qué
 *  número pide esta letra». */
function leerToUnicode(txt) {
  const mapa = new Map();
  const unaLetra = (h) => (h.length > 4 ? null : String.fromCharCode(parseInt(h, 16)));
  let m;
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = bfchar.exec(txt))) {
    const par = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let q;
    while ((q = par.exec(m[1]))) {
      const c = unaLetra(q[2]);
      if (c !== null && !mapa.has(c)) mapa.set(c, parseInt(q[1], 16));
    }
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrange.exec(txt))) {
    const fila = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    let q;
    while ((q = fila.exec(m[1]))) {
      const desde = parseInt(q[1], 16), hasta = parseInt(q[2], 16);
      if (hasta < desde || hasta - desde > 65535) continue;
      if (q[3] !== undefined) {
        if (q[3].length > 4) continue;
        const base = parseInt(q[3], 16);
        for (let i = 0; i <= hasta - desde; i++) {
          const c = String.fromCharCode(base + i);
          if (!mapa.has(c)) mapa.set(c, desde + i);
        }
      } else {
        const lista = q[4].match(/<[0-9A-Fa-f]+>/g) || [];
        lista.forEach((h, i) => {
          const c = unaLetra(h.slice(1, -1));
          if (c !== null && !mapa.has(c)) mapa.set(c, desde + i);
        });
      }
    }
  }
  return mapa;
}

/** La tabla /W de una tipografía CID: «código [anchos…]» o «desde hasta ancho». */
function leerAnchosW(arr) {
  const anchos = new Map();
  let i = 0;
  while (i < arr.length) {
    const a = arr.get(i);
    if (!a || !a.isNumber()) { i++; continue; }
    const c1 = a.asNumber();
    const seg = arr.get(i + 1);
    if (seg && seg.isArray()) {
      for (let k = 0; k < seg.length; k++) {
        const w = seg.get(k);
        if (w && w.isNumber()) anchos.set(c1 + k, w.asNumber());
      }
      i += 2;
    } else if (seg && seg.isNumber()) {
      const c2 = seg.asNumber(), w = arr.get(i + 2);
      const ww = w && w.isNumber() ? w.asNumber() : 0;
      for (let c = c1; c <= c2 && c - c1 < 65536; c++) anchos.set(c, ww);
      i += 3;
    } else i++;
  }
  return anchos;
}

const PREFIJO = /^[A-Z]{6}\+/;
const sinPrefijo = (n) => String(n || '').replace(PREFIJO, '');

/**
 * Busca en la hoja la tipografía que se llama así y devuelve con qué
 * pedirla: su nombre de recurso, con qué número va cada letra, cuánto mide
 * cada una y si los números son de uno o de dos bytes.
 */
function fuentesIncrustadas(pagina, nombreFuente) {
  if (!nombreFuente) return [];
  const salida = [];
  try {
    const rec = recursosDe(pagina.getObject());
    const fuentes = rec && rec.get('Font');
    if (!fuentes || !fuentes.isDictionary()) return [];
    const buscado = sinPrefijo(nombreFuente).toLowerCase();
    // Una hoja puede traer VARIAS entradas con el mismo nombre y subconjuntos
    // distintos —Chrome lo hace—, así que se recogen todas y luego se usa la
    // que tenga las letras que hacen falta.
    const claves = [];
    fuentes.forEach((v, k) => {
      if (!v || !v.isDictionary()) return;
      const bf = v.get('BaseFont');
      if (!bf || !bf.isName()) return;
      if (sinPrefijo(bf.asName()).toLowerCase() === buscado) claves.push(k);
    });
    for (const clave of claves) {
      const d = describirFuente(fuentes.get(clave), clave);
      if (d) salida.push(d);
    }
  } catch (e) { /* si no se puede mirar, no se inventa nada */ }
  return salida;
}

function describirFuente(obj, clave) {
  try {
    if (!obj || !obj.isDictionary()) return null;
    const tu = obj.get('ToUnicode');
    if (!tu || !tu.isStream || !tu.isStream()) return null;
    const codigos = leerToUnicode(new TextDecoder().decode(new Uint8Array(tu.readStream().asUint8Array())));
    if (!codigos.size) return null;

    const sub = obj.get('Subtype');
    const esCID = sub && sub.isName() && sub.asName() === 'Type0';
    let anchos = new Map(), porDefecto = esCID ? 1000 : 500;
    if (esCID) {
      const hija = obj.get('DescendantFonts');
      const d0 = hija && hija.isArray() && hija.length ? hija.get(0) : null;
      if (d0 && d0.isDictionary()) {
        const dw = d0.get('DW');
        if (dw && dw.isNumber()) porDefecto = dw.asNumber();
        const w = d0.get('W');
        if (w && w.isArray()) anchos = leerAnchosW(w);
      }
    } else {
      const primero = obj.get('FirstChar'), lista = obj.get('Widths');
      if (primero && primero.isNumber() && lista && lista.isArray()) {
        const p = primero.asNumber();
        for (let i = 0; i < lista.length; i++) {
          const w = lista.get(i);
          if (w && w.isNumber()) anchos.set(p + i, w.asNumber());
        }
      }
    }
    return { clave, obj, codigos, anchos, porDefecto, bytes: esCID ? 2 : 1 };
  } catch (e) { return null; }
}

/**
 * Devuelve la tipografía a los recursos de la hoja si hizo falta.
 *
 * Al redactar el renglón, si esa tipografía no la usaba nadie más en la
 * hoja, MuPDF la borra de los recursos —hace bien, ya no la usa nadie— y
 * entonces el texto nuevo se escribiría pidiendo una tipografía que ya no
 * está. Por eso se mira ANTES de redactar y se replanta DESPUÉS.
 */
function plantarFuente(objPag, f) {
  if (!f || !f.ref || !f.clave) return;
  const fuentes = fuentesDe(objPag);
  const hay = fuentes.get(f.clave);
  if (hay && hay.isDictionary && hay.isDictionary()) return;
  fuentes.put(f.clave, f.ref);
}

/** La cadena tal como se pide en el flujo, o null si falta alguna letra. */
function cadenaIncrustada(f, texto) {
  let hex = '';
  for (const c of texto) {
    const cod = f.codigos.get(c);
    if (cod === undefined) return null;
    hex += cod.toString(16).toUpperCase().padStart(f.bytes * 2, '0');
  }
  return '<' + hex + '>';
}

function medirIncrustada(f, texto, tam) {
  let suma = 0;
  for (const c of texto) {
    const cod = f.codigos.get(c);
    suma += cod !== undefined && f.anchos.has(cod) ? f.anchos.get(cod) : f.porDefecto;
  }
  return suma * tam / 1000;
}

/**
 * Con qué se va a escribir este texto en esta hoja: si la tipografía del
 * propio documento sirve, esa; si no, la equivalente de serie de siempre.
 * Devuelve ya todo resuelto —el nombre del recurso, la cadena y el ancho—
 * para que quien escribe no tenga que saber de cuál se trata.
 */
function conQueEscribir(pagina, objPag, nombreFuente, rasgos, texto, tam, cache) {
  // Un renglón se reescribe trozo a trozo y cada trozo pregunta por su
  // tipografía. Sin recordar la respuesta se leería el mismo /ToUnicode cien
  // veces y se meterían cien tipografías de serie iguales en la hoja.
  const llave = String(nombreFuente) + '|' + JSON.stringify(rasgos || {});
  let base = cache && cache.get(llave);
  if (!base) {
    base = { propias: fuentesIncrustadas(pagina, nombreFuente) };
    if (cache) cache.set(llave, base);
  }

  /* Se parte el texto en tramos: cada letra va con la tipografía incrustada
     que la tenga. Una misma hoja puede traer varios subconjuntos del mismo
     tipo de letra —Chrome los parte— y entre todos suelen tener todo lo que
     hace falta; como son el mismo tipo de letra, juntarlos no se nota. Lo
     que no esté en ninguno va con la equivalente de serie. */
  const tramos = [];
  for (const c of texto) {
    const donde = base.propias.find((p) => p.codigos.has(c)) || null;
    const id = donde ? donde.clave : '';
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.id === id) ultimo.texto += c;
    else tramos.push({ id, donde, texto: c });
  }

  const deSerie = () => {
    if (!base.serie) {
      const elegida = resolverFuente(nombreFuente, rasgos);
      const clave = 'GrapaEd' + (contadorFuente++);
      const ref = doc.addSimpleFont(elegida.fuente, 'Latin');
      fuentesDe(objPag).put(clave, ref);
      base.serie = { elegida, clave, ref };
    }
    return base.serie;
  };

  const trozos = [];
  const refs = [];
  let comoQueda = '', ancho = 0, perdidas = [], faltan = [], sustituida = false;
  for (const t of tramos) {
    if (t.donde) {
      trozos.push({ clave: t.donde.clave, cadena: cadenaIncrustada(t.donde, t.texto),
                    ancho: medirIncrustada(t.donde, t.texto, tam) });
      refs.push({ clave: t.donde.clave, ref: t.donde.obj });
      comoQueda += t.texto;
      ancho += trozos[trozos.length - 1].ancho;
    } else {
      const serie = deSerie();
      const queda = comoQuedara(t.texto);
      const a = medirAncho(serie.elegida.fuente, queda.texto, tam);
      trozos.push({ clave: serie.clave, cadena: '(' + escapar(queda.texto) + ')', ancho: a });
      refs.push({ clave: serie.clave, ref: serie.ref });
      comoQueda += queda.texto;
      ancho += a;
      perdidas = perdidas.concat(queda.perdidas);
      faltan = faltan.concat([...t.texto].filter((c) => c !== ' '));
      sustituida = true;
    }
  }

  return {
    trozos, refs, ancho, texto: comoQueda,
    perdidas: [...new Set(perdidas)],
    faltan: [...new Set(faltan)],
    propia: !sustituida && trozos.length > 0,
    sustituida,
    nombre: sustituida ? deSerie().elegida.nombre : sinPrefijo(nombreFuente),
  };
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

/* ---------- escribir una cadena en el flujo del PDF ----------

   El texto se escribe en WinAnsi, que es lo que entienden las catorce
   tipografías que todo lector trae de serie. Casi todo lo que hace falta en
   castellano cabe —tildes, eñe, signos de apertura—, pero NO por su número
   de Unicode: WinAnsi aprovecha los huecos del 128 al 159 para las comillas
   tipográficas, las rayas, el punto de lista, los puntos suspensivos y el
   euro, que en Unicode viven mucho más arriba.

   Sin esa traducción, un correo pegado de Gmail —que escribe «así» las
   comillas y usa raya en vez de guion— salía lleno de interrogantes; la
   comprobación veía que lo escrito no era lo pedido y rechazaba el cambio
   entero. Un renglón con una sola raya no había manera de corregirlo. */
const WINANSI = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A],
  [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92],
  [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C],
  [0x017E, 0x9E], [0x0178, 0x9F],
]);

/* Lo que no cabe de ninguna manera, con su pariente más cercano: más vale
   un guion corriente que un interrogante. */
const PARECIDO = new Map(Object.entries({
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '-', '\u2212': '-',
  '\u2043': '-', '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2007': ' ',
  '\u2008': ' ', '\u2009': ' ', '\u200A': ' ', '\u202F': ' ', '\u3000': ' ',
  '\u200B': '', '\u00AD': '', '\uFEFF': '',
  '\u2032': "'", '\u2033': '"', '\u2035': "'", '\u2036': '"', '\u201B': "'",
  '\u2027': '\u00B7', '\n': ' ', '\r': ' ', '\t': ' ',
  // las ligaduras que mete la imprenta: se deshacen en sus letras
  '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl',
}));

/** El código WinAnsi de una letra, o null si esa letra no está en WinAnsi. */
function enWinAnsi(c) {
  const n = c.codePointAt(0);
  if (n >= 0x20 && n <= 0x7E) return n;
  if (WINANSI.has(n)) return WINANSI.get(n);
  if (n >= 0xA0 && n <= 0xFF) return n;
  return null;
}

/**
 * El texto TAL COMO VA A QUEDAR escrito, que no siempre es el que se pidió:
 * lo que no cabe se cambia por su pariente más cercano. Devuelve además las
 * letras que no tenían pariente, para poder decirlo en vez de dejar un
 * interrogante en silencio.
 *
 * Todo lo que escribe y todo lo que comprueba pasa por aquí: si compararan
 * cosas distintas, un cambio bueno parecería malo.
 */
function comoQuedara(texto) {
  let salida = '';
  const perdidas = [];
  for (const c of String(texto == null ? '' : texto)) {
    if (enWinAnsi(c) !== null) { salida += c; continue; }   // cabe tal cual
    const cerca = PARECIDO.get(c);
    if (cerca !== undefined) { salida += cerca; continue; }
    perdidas.push(c);
    salida += '?';
  }
  return { texto: salida, perdidas: [...new Set(perdidas)] };
}

function escapar(texto) {
  let salida = '';
  for (const c of comoQuedara(texto).texto) {
    if (c === '\\') { salida += '\\\\'; continue; }
    if (c === '(') { salida += '\\('; continue; }
    if (c === ')') { salida += '\\)'; continue; }
    const n = enWinAnsi(c);
    if (n === null) { salida += '?'; continue; }
    salida += n >= 0x20 && n <= 0x7E ? c : '\\' + n.toString(8).padStart(3, '0');
  }
  return salida;
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
  $('#btnTachar').disabled = false;
  tachas = [];
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
  pintarTachas();
  $('#cartelEscaneo').hidden = !esEscaneo || tachando;
  $('#hojaEnvoltura').hidden = esEscaneo && !tachando;
  pintarReconocido(conOCR);
  pintarPorLeer();
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
  // tachando, las zonas se marcan arrastrando: los renglones no recogen el clic
  capa.classList.toggle('tachando', tachando);
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
  $$('.campo-asa, .campo-ajustes').forEach((n) => n.remove());
  if (campoAbierto) { campoAbierto.remove(); campoAbierto = null; }
  const a = document.querySelector('.campo-ayuda');
  if (a) a.remove();
}

/* ---------- corregir sobre la propia hoja ----------

   El campo donde se escribe no es una caja aparte: va encima del renglón,
   con su misma letra, su tamaño, su color y el color del papel de debajo,
   así que lo que se teclea se ve ya como va a quedar. Y se puede mover:
   el asa de la izquierda lo arrastra, y Alt + flechas lo corre de a medio
   punto, para ajustarlo a mano antes de ponerlo.                        */

/** La letra de un renglón, para dibujarla igual en la pantalla. */
function letraDeRenglon(r) {
  let familia = 'Helvetica, Arial, sans-serif', negrita = false, cursiva = false, tam = r.size;
  let base = r.y, color = r.color || [0, 0, 0];
  let x = r.deEscaneo ? r.bbox[0] : r.x;
  if (r.deEscaneo) {
    const pagina = doc.loadPage(paginaActual);
    const m = modeloDe(pagina);
    const fila = (m && m.renglones[r.enModelo]) || {};
    const met = metricaDe(r.texto);
    // Sin corregir todavía, la letra se mide ya en la foto —igual que se
    // medirá al ponerlo—, para que mientras se escribe se vea como quedará.
    const med = fila.tam == null ? medirRenglon(pagina, [fila.x0, fila.y0, fila.x1, fila.y1]) : null;
    if (med) {
      tam = med.altoArriba / Math.max(0.3, met.arriba);
      negrita = esNegrita(med.grosor, tam);
      base = med.base;
      color = med.tinta || color;
      x = med.izquierda;
    } else {
      negrita = !!fila.negrita;
      tam = fila.tam || (r.bbox[3] - r.bbox[1]) / Math.max(0.3, met.alto);
      base = fila.base != null ? fila.base : r.bbox[3] - met.abajo * tam;
      color = fila.tinta || color;
      if (fila.x != null) x = fila.x;
    }
  } else {
    const ras = r.rasgos || {};
    if (ras.mono) familia = '"Courier New", Courier, monospace';
    else if (ras.serif) familia = '"Times New Roman", Times, serif';
    negrita = !!ras.negrita; cursiva = !!ras.cursiva;
  }
  const css = (c) => 'rgb(' + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',') + ')';
  return { familia, negrita, cursiva, tam, base, x, color: css(color) };
}

/** El color del papel junto a una caja de la hoja, sacado de lo dibujado. */
function papelJunto(caja) {
  const lienzo = $('#lienzo');
  const k = lienzo.width / Math.max(1, parseFloat(lienzo.style.width) || lienzo.width) * escala;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  const muestras = [];
  const tomar = (x, y) => {
    const px = Math.round(x * k), py = Math.round(y * k);
    if (px < 0 || py < 0 || px >= lienzo.width || py >= lienzo.height) return;
    const d = ctx.getImageData(px, py, 1, 1).data;
    muestras.push([d[0], d[1], d[2]]);
  };
  for (let i = 0; i <= 8; i++) {
    const x = caja[0] + (caja[2] - caja[0]) * i / 8;
    tomar(x, caja[1] - 2); tomar(x, caja[3] + 2);
  }
  tomar(caja[0] - 3, (caja[1] + caja[3]) / 2);
  if (!muestras.length) return '#fff';
  // lo más claro de lo que hay alrededor: el papel, no una letra vecina
  muestras.sort((p, q) => (q[0] + q[1] + q[2]) - (p[0] + p[1] + p[2]));
  const m = muestras[Math.floor(muestras.length / 4)];
  return 'rgb(' + m.join(',') + ')';
}

/* Los colores que se ofrecen a mano: los de casi cualquier documento. Una
   rueda de colores daría para elegir cualquiera, pero lo que se busca aquí
   es igualar el de al lado o poner el negro o el azul de siempre, y eso va
   mejor con un clic. */
const COLORES_A_MANO = [
  { nombre: 'Negro', rgb: [0, 0, 0] },
  { nombre: 'Azul', rgb: [0.06, 0.2, 0.62] },
  { nombre: 'Rojo', rgb: [0.72, 0.1, 0.1] },
];
const aCss = (c) => 'rgb(' + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',') + ')';

/**
 * Pone un campo con la letra del documento sobre la hoja. `donde` lleva la
 * caja que tapa (lo que había) y la línea base; `alListo(texto, desp,
 * ajustes)` recibe lo escrito, cuánto se movió (en puntos) y lo que se
 * cambió a mano de la letra —{ tam, negrita, tinta }, solo lo tocado—, o
 * null si no se tocó nada.
 *
 * La medición de la letra acierta casi siempre, pero no siempre: una firma
 * que roza el renglón lo hace parecer negrita, un sello lo tiñe de azul.
 * Por eso encima del campo va una barrita para corregirlo a mano —tamaño,
 * negrita y color— viendo ya cómo queda.
 */
function campoSobreHoja(donde, letra, valor, ayudaTexto, alListo, alSalir) {
  cerrarCampo();
  const capa = $('#renglones');
  const desp = { dx: 0, dy: 0 };
  const ajuste = { tam: letra.tam, negrita: !!letra.negrita, tinta: null };
  const tocado = {};
  let tamPx = ajuste.tam * escala;

  const campo = document.createElement('input');
  campo.className = 'campo';
  campo.type = 'text';
  campo.value = valor;
  campo.spellcheck = false;
  campo.style.background = donde.papel;
  const medir = document.createElement('canvas').getContext('2d');
  const anchoMin = donde.tapa ? (donde.tapa[2] - donde.x) * escala : 0;
  const ajustarAncho = () => {
    campo.style.width = Math.max(anchoMin, medir.measureText(campo.value || ' ').width + tamPx * 0.6, 40) + 'px';
  };
  const ponerLetra = () => {
    tamPx = ajuste.tam * escala;
    const fuente = (letra.cursiva ? 'italic ' : '') + (ajuste.negrita ? 'bold ' : '') + tamPx.toFixed(2) + 'px ' + letra.familia;
    campo.style.font = fuente;
    campo.style.color = ajuste.tinta ? aCss(ajuste.tinta) : letra.color;
    campo.style.height = (tamPx * 1.2) + 'px';
    campo.style.lineHeight = (tamPx * 1.2) + 'px';
    medir.font = fuente;
  };
  ponerLetra();

  // la barrita: A− A+ · N · colores
  const barra = document.createElement('div');
  barra.className = 'campo-ajustes';
  const boton = (texto, titulo, hacer, clase) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    b.title = titulo;
    if (clase) b.className = clase;
    // pulsarlo no le quita el foco al campo: así no se cierra
    b.addEventListener('pointerdown', (ev) => ev.preventDefault());
    b.addEventListener('click', () => { hacer(); campo.focus(); });
    barra.appendChild(b);
    return b;
  };
  const tamTexto = document.createElement('span');
  tamTexto.className = 'campo-tam';
  const pintarBarra = () => {
    tamTexto.textContent = ajuste.tam.toFixed(1).replace('.', ',') + ' pt';
    bNegrita.classList.toggle('activo', ajuste.negrita);
    barra.querySelectorAll('.campo-color').forEach((b) => b.classList.toggle('activo',
      b.dataset.i === (ajuste.tinta ? String(COLORES_A_MANO.findIndex((c) => c.rgb === ajuste.tinta)) : 'orig')));
  };
  const cambiar = (que, valor2) => {
    ajuste[que] = valor2;
    tocado[que] = true;
    ponerLetra(); ajustarAncho(); colocar(); pintarBarra();
  };
  // de medio punto en medio punto, desde lo medido: cada clic mueve lo mismo
  boton('A−', 'Letra más chica (medio punto)', () => cambiar('tam', Math.max(4, Math.round((ajuste.tam - 0.5) * 100) / 100)), 'campo-menos');
  barra.appendChild(tamTexto);
  boton('A+', 'Letra más grande (medio punto)', () => cambiar('tam', Math.min(72, Math.round((ajuste.tam + 0.5) * 100) / 100)), 'campo-mas');
  const bNegrita = boton('N', 'Negrita (Ctrl+B)', () => cambiar('negrita', !ajuste.negrita), 'campo-negrita');
  const sep = document.createElement('span');
  sep.className = 'campo-sep';
  barra.appendChild(sep);
  const bOrig = boton('', 'Como estaba: el color medido del renglón', () => { ajuste.tinta = null; delete tocado.tinta; ponerLetra(); pintarBarra(); }, 'campo-color campo-orig');
  bOrig.dataset.i = 'orig';
  bOrig.style.background = letra.color;
  COLORES_A_MANO.forEach((c, i) => {
    const b = boton('', c.nombre, () => cambiar('tinta', c.rgb), 'campo-color');
    b.dataset.i = String(i);
    b.style.background = aCss(c.rgb);
  });
  pintarBarra();

  const asa = document.createElement('div');
  asa.className = 'campo-asa';
  asa.title = 'Arrastra para mover el texto';
  asa.textContent = '⠇';

  const ayuda = document.createElement('div');
  ayuda.className = 'campo-ayuda';
  ayuda.textContent = ayudaTexto;

  const colocar = () => {
    const x = (donde.x + desp.dx) * escala, y = (donde.base + desp.dy) * escala;
    campo.style.left = x + 'px';
    campo.style.top = (y - tamPx) + 'px';
    barra.style.left = x + 'px';
    barra.style.top = (y - tamPx - 34) + 'px';
    asa.style.left = (x - 18) + 'px';
    asa.style.top = (y - tamPx) + 'px';
    asa.style.height = (tamPx * 1.2) + 'px';
    ayuda.style.left = x + 'px';
    ayuda.style.top = (y + tamPx * 0.2 + 8) + 'px';
    campo.classList.toggle('movido', !!(desp.dx || desp.dy));
  };

  // arrastrar por el asa: el campo no pierde el foco
  let agarre = null;
  asa.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    agarre = { x: ev.clientX, y: ev.clientY, dx: desp.dx, dy: desp.dy };
    asa.setPointerCapture(ev.pointerId);
  });
  asa.addEventListener('pointermove', (ev) => {
    if (!agarre) return;
    desp.dx = Math.round((agarre.dx + (ev.clientX - agarre.x) / escala) * 10) / 10;
    desp.dy = Math.round((agarre.dy + (ev.clientY - agarre.y) / escala) * 10) / 10;
    colocar();
  });
  asa.addEventListener('pointerup', () => { agarre = null; campo.focus(); });

  campo.addEventListener('input', ajustarAncho);
  campo.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'b') {
      ev.preventDefault();
      cambiar('negrita', !ajuste.negrita);
      return;
    }
    if (ev.altKey && ev.key.startsWith('Arrow')) {
      ev.preventDefault();
      const paso = ev.shiftKey ? 2 : 0.5;
      if (ev.key === 'ArrowLeft') desp.dx -= paso;
      if (ev.key === 'ArrowRight') desp.dx += paso;
      if (ev.key === 'ArrowUp') desp.dy -= paso;
      if (ev.key === 'ArrowDown') desp.dy += paso;
      colocar();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const v = campo.value;
      const d = { dx: desp.dx, dy: desp.dy };
      // solo lo que se tocó y quedó distinto de lo medido
      const aj = {};
      if (tocado.tam && Math.abs(ajuste.tam - letra.tam) > 0.01) aj.tam = ajuste.tam;
      if (tocado.negrita && ajuste.negrita !== !!letra.negrita) aj.negrita = ajuste.negrita;
      if (tocado.tinta && ajuste.tinta) aj.tinta = ajuste.tinta.slice();
      cerrarCampo();
      alListo(v, d, Object.keys(aj).length ? aj : null);
    }
    if (ev.key === 'Escape') { ev.preventDefault(); cerrarCampo(); if (alSalir) alSalir(); }
  });
  campo.addEventListener('blur', () => setTimeout(() => { if (!agarre) cerrarCampo(); }, 120));

  colocar();
  ajustarAncho();
  capa.appendChild(campo);
  capa.appendChild(asa);
  capa.appendChild(barra);
  capa.appendChild(ayuda);
  campoAbierto = campo;
  campo.focus();
  return campo;
}

function editar(indice, valorInicial) {
  const r = renglones[indice];
  const letra = letraDeRenglon(r);
  const campo = campoSobreHoja(
    { x: letra.x, base: letra.base, tapa: r.bbox, papel: papelJunto(r.bbox) },
    letra, valorInicial === undefined ? r.texto : valorInicial,
    (r.deEscaneo ? 'Se tapará con el papel y se escribirá encima · ' : '')
      + 'Enter: poner · Esc: dejar · vacío + Enter: borrar · ⠇ o Alt + flechas: mover',
    (v, desp, aj) => aplicar(indice, v, desp, aj));
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

  /* Las RAYAS del cuadro no son tinta de letra, y si se cuentan como tal
     estropean las dos cosas que más se notan:

       · la altura. El recuadro de un renglón dentro de una celda suele
         llevarse por delante la raya de arriba o la de abajo, y entonces
         «lo que ocupa la tinta» va de la raya a la letra. Ahí es donde
         salía un renglón corregido al doble de tamaño.
       · el parche. Al extenderlo hasta encontrar papel limpio, una raya
         cuenta como sucia, así que el parche se la traga y al taparla
         desaparece el borde de la celda.

     Una raya se reconoce en que cruza la caja de lado a lado: ninguna
     letra llena más de la mitad del ancho en una sola fila. */
  const oscuraEnFila = new Int32Array(al);
  for (let y = 0; y < al; y++) {
    let n = 0;
    for (let x = 0; x < an; x++) if (lum[y * an + x] < umbral) n++;
    oscuraEnFila[y] = n;
  }
  const esRaya = (y) => oscuraEnFila[y] > an * 0.6;
  // una mota suelta no es un renglón: para contar como fila con tinta hace
  // falta algo más que dos o tres píxeles perdidos
  const hayTinta = (y) => !esRaya(y) && oscuraEnFila[y] >= Math.max(2, an * 0.015);

  /* Lo que ocupa de verdad el renglón.
     No vale quedarse con el píxel más alto y el más bajo: el recuadro que
     da el reconocimiento suele pasarse, y por abajo alcanza las cabezas de
     la fila siguiente. Tomando esos dos extremos, un renglón de siete
     puntos se medía de diecisiete, y al corregirlo salía al doble de
     tamaño. Lo que hay que buscar es la BANDA con tinta: se parten las
     filas en bandas —dos filas en blanco seguidas las separan— y se elige
     la que más tinta tiene, que es el renglón. */
  const bandas = [];
  for (let y = dentroY0; y <= dentroY1 && y < al; y++) {
    if (!hayTinta(y)) continue;
    const ultima = bandas[bandas.length - 1];
    if (ultima && y - ultima.b <= 3) { ultima.b = y; ultima.tinta += oscuraEnFila[y]; }
    else bandas.push({ a: y, b: y, tinta: oscuraEnFila[y] });
  }
  if (!bandas.length) return null;
  const banda = bandas.reduce((m, x) => (x.tinta > m.tinta ? x : m), bandas[0]);


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
  for (let i = 0; i < lum.length; i++) {
    if (lum[i] >= umbral) continue;
    const y = (i / an) | 0;
    if (y < banda.a || y > banda.b) continue;
    tintaIdx.push(i);
  }
  if (tintaIdx.length < 12) return null;
  tintaIdx.sort((a, b) => lum[a] - lum[b]);
  const nucleo = tintaIdx.slice(0, Math.max(4, Math.round(tintaIdx.length * 0.25)));

  /* Dónde empieza y dónde acaba la tinta.

     El recuadro de una celda suele empezar justo en su borde, y el borde
     entra en el recorte: contándolo como tinta, el renglón corregido se
     escribe pegado al borde en vez de donde estaba el texto. Así que se
     agrupan las columnas con tinta y se descartan los grupos de los
     extremos que son FINOS y están LEJOS del resto: eso es una raya, no
     una letra. */
  const altoBanda = banda.b - banda.a + 1;
  const tintaCol = new Int32Array(an);
  for (let y = banda.a; y <= banda.b; y++) {
    for (let x = 0; x < an; x++) if (lum[y * an + x] < umbral) tintaCol[x]++;
  }
  const grupos = [];
  for (let x = 0; x < an; x++) {
    if (!tintaCol[x]) continue;
    const u = grupos[grupos.length - 1];
    if (u && x - u.b <= 2) u.b = x;
    else grupos.push({ a: x, b: x });
  }
  if (!grupos.length) return null;
  const lejos = Math.max(4, altoBanda * 0.5);
  const fino = Math.max(2, altoBanda * 0.25);
  while (grupos.length > 1) {
    const g = grupos[0];
    if (g.b - g.a + 1 <= fino && grupos[1].a - g.b > lejos) grupos.shift();
    else break;
  }
  while (grupos.length > 1) {
    const g = grupos[grupos.length - 1];
    if (g.b - g.a + 1 <= fino && g.a - grupos[grupos.length - 2].b > lejos) grupos.pop();
    else break;
  }
  const izq = grupos[0].a, der = grupos[grupos.length - 1].b;

  const rachas = [];
  for (let y = banda.a; y <= banda.b; y++) {
    let racha = 0;
    for (let x = izq; x <= der; x++) {
      if (lum[y * an + x] < umbral) racha++;
      else if (racha) { rachas.push(racha); racha = 0; }
    }
    if (racha) rachas.push(racha);
  }
  const arriba = banda.a, abajo = banda.b;
  if (der < izq) return null;
  rachas.sort((a, b) => a - b);
  const grosor = rachas[Math.floor(rachas.length / 2)] || 1;

  // Cuánto tarda el papel en volverse tinta: en un escaneo el borde de cada
  // letra es blando y ocupa varios píxeles. Es lo que hace que el texto
  // vectorial, de bordes limpios, cante al lado del escaneado.
  let medios = 0, bordes = 0;
  const bajo = masOscuro + (papelLum - masOscuro) * 0.25;
  const alto2 = masOscuro + (papelLum - masOscuro) * 0.75;
  for (let y = arriba; y <= abajo; y++) {
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

  // La LÍNEA BASE: donde acaba de golpe el cuerpo de las letras. Por debajo
  // solo quedan las colas de la g, la p o la coma, y esas a veces cuentan
  // como tinta y a veces no —depende de cuántas haya en el renglón—, así
  // que el tamaño de la letra se mide de la línea base hacia arriba.
  let maxFila = 0;
  for (let y = arriba; y <= abajo; y++) maxFila = Math.max(maxFila, oscuraEnFila[y]);
  let linea = abajo;
  while (linea > arriba && oscuraEnFila[linea] < maxFila * 0.3) linea--;

  // El parche: se buscan las filas SIN tinta —las de los márgenes— y se
  // repiten para cubrir el renglón. Así el trozo tapado lleva el mismo grano
  // y el mismo tono que el papel de al lado, en vez de un rectángulo liso
  // que se adivina a la primera.
  // Papel limpio de verdad: no basta con que no sea un renglón, porque las
  // filas de justo encima y de justo debajo llevan el borde difuminado de
  // las letras, y copiarlas deja el parche con rayas verticales donde
  // estaban. Se pide que estén casi vacías.
  const limpias = [];
  for (let y = 0; y < al; y++) {
    if (y >= banda.a && y <= banda.b) continue;
    if (esRaya(y)) continue;
    if (oscuraEnFila[y] > Math.max(1, an * 0.005)) continue;
    limpias.push(y);
  }
  // El parche se estira hasta la primera fila de papel limpio por arriba y
  // por abajo: si se queda en el recuadro del reconocimiento, los rabillos
  // que sobresalen —tildes, palos altos— se quedan fuera y aparecen motas
  // encima del renglón corregido. Parar en la fila limpia evita además
  // comerse el renglón de al lado.
  // una raya no cuenta como sucia: el parche tiene que pararse ANTES de
  // ella, o al taparla se lleva por delante el borde de la celda
  // El parche se estira hasta la primera fila de papel limpio, para no
  // dejar fuera los rabillos que sobresalen —tildes, palos altos—, pero
  // parándose en la raya del cuadro y en el renglón de al lado: taparlos
  // sería borrar el borde de la celda o comerse la fila siguiente.
  let pArriba = arriba;
  while (pArriba > 0 && hayTinta(pArriba - 1)) pArriba--;
  let pAbajo = abajo;
  while (pAbajo < al - 1 && hayTinta(pAbajo + 1)) pAbajo++;

  let parche = null;
  if (limpias.length >= 2) {
    const alturaParche = pAbajo - pArriba + 1;
    const datos = new Uint8Array(an * alturaParche * 3);
    // Cada fila del parche se mezcla entre la fila limpia más cercana por
    // arriba y la más cercana por abajo, según lo lejos que esté de cada una.
    // Copiar siempre la misma fila deja una costura horizontal muy visible.
    // De cada lado se toma la MEDIANA de varias filas limpias, no una sola:
    // una mota o el rastro de una letra en la fila elegida se convertiría
    // en una raya vertical a lo largo de todo el parche.
    const arribaLimpia = limpias.filter((y) => y < pArriba).slice(-7);
    const abajoLimpia = limpias.filter((y) => y > pAbajo).slice(0, 7);
    const ladoA = arribaLimpia.length ? arribaLimpia : abajoLimpia;
    const ladoB = abajoLimpia.length ? abajoLimpia : ladoA;
    const medianaDe = (filas2, x, canal) => {
      const v2 = filas2.map((y) => rgb[(y * an + x) * 3 + canal]).sort((p, q) => p - q);
      return v2.length ? v2[v2.length >> 1] : 255;
    };
    const colA = [0, 1, 2].map((c) => new Uint8Array(an));
    const colB = [0, 1, 2].map((c) => new Uint8Array(an));
    for (let x = 0; x < an; x++) {
      for (let c = 0; c < 3; c++) {
        colA[c][x] = medianaDe(ladoA, x, c);
        colB[c][x] = medianaDe(ladoB, x, c);
      }
    }
    const yA = ladoA.length ? ladoA[ladoA.length - 1] : pArriba;
    const yB = ladoB.length ? ladoB[0] : pAbajo;
    for (let y = 0; y < alturaParche; y++) {
      const t = yB === yA ? 0 : (y + pArriba - yA) / (yB - yA);
      const w = Math.max(0, Math.min(1, t));
      for (let x = 0; x < an; x++) {
        const d = (y * an + x) * 3;
        for (let c = 0; c < 3; c++) datos[d + c] = colA[c][x] * (1 - w) + colB[c][x] * w;
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
    // el grosor del trazo, en puntos: si es negrita lo decide quien sabe el
    // tamaño de la letra (ver esNegrita)
    grosor: grosor / A,
    altoTinta,
    altoArriba: (linea - arriba + 1) / A,   // de la línea base a lo más alto
    base: (y0 + linea + 1) / A,             // la línea base, desde arriba de la hoja
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

/* ---------- la hoja torcida ----------

   Un escaneo casi nunca entra derecho, y unos pocos grados bastan para que
   el reconocimiento parta los renglones y confunda letras: los números
   largos, como un RUC, son lo primero que se pierde. Antes de leer se mide
   cuánto está torcida —como hace Grapa en «Revisar»: el giro con el que la
   tinta se amontona en renglones más limpios— y, si lo está, se endereza la
   hoja DE VERDAD en el documento. Así lo leído, lo que luego se corrija y
   lo que se ve van derechos y a la vez. */
const TORCIDA_MAXIMA = 8;     // grados: más que esto no es un escaneo torcido
const TORCIDA_MINIMA = 0.4;   // grados: menos que esto no estorba al leer

/** Cuántos grados hay que girar la hoja (a favor del reloj, como se ve)
 *  para enderezarla. 0 si está derecha o si no hay renglones que mirar. */
function medirTorcida(lienzo) {
  const AN = lienzo.width, AL = lienzo.height;
  const datos = lienzo.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, AN, AL).data;
  // a la mitad de resolución: sobra para medir y va cuatro veces más rápido
  const W = AN >> 1, H = AL >> 1;
  const lum = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = ((y * 2) * AN + x * 2) * 4;
      lum[y * W + x] = (datos[j] * 299 + datos[j + 1] * 587 + datos[j + 2] * 114) / 1000;
    }
  }
  // tinta: bastante más oscuro que el papel de su zona
  const B = 24, bx = Math.ceil(W / B), by = Math.ceil(H / B);
  const papel = new Uint8Array(bx * by);
  for (let cy = 0; cy < by; cy++) {
    for (let cx = 0; cx < bx; cx++) {
      const m = [];
      for (let y = cy * B; y < Math.min(H, (cy + 1) * B); y += 2) for (let x = cx * B; x < Math.min(W, (cx + 1) * B); x += 2) m.push(lum[y * W + x]);
      m.sort((a, b) => a - b);
      papel[cy * bx + cx] = m.length ? m[Math.floor(m.length * 0.8)] : 255;
    }
  }
  const mx = Math.round(W * 0.04), my = Math.round(H * 0.04);
  const xs = [], ys = [];
  for (let y = my; y < H - my; y++) {
    for (let x = mx; x < W - mx; x++) {
      const v = lum[y * W + x];
      if (v < 170 && v < papel[((y / B) | 0) * bx + ((x / B) | 0)] * 0.6) { xs.push(x - W / 2); ys.push(y - H / 2); }
    }
  }
  if (xs.length < 400) return 0;
  const paso = Math.max(1, Math.ceil(xs.length / 90000));
  const px = [], py = [];
  for (let i = 0; i < xs.length; i += paso) { px.push(xs[i]); py.push(ys[i]); }
  // cuán limpios salen los renglones girando la tinta «g» grados
  const nitidez = (g) => {
    const r = (g * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
    const h = new Map();
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < px.length; i++) {
      const v = Math.floor((px[i] * si + py[i] * co) / 2);
      h.set(v, (h.get(v) || 0) + 1);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    let s2 = 0;
    for (const n of h.values()) s2 += n * n;
    return (s2 * (max - min + 1)) / (px.length * px.length);
  };
  let mejor = 0, valor = -1;
  for (let g = -TORCIDA_MAXIMA; g <= TORCIDA_MAXIMA + 1e-9; g += 0.5) {
    const v = nitidez(g);
    if (v > valor) { valor = v; mejor = g; }
  }
  const grueso = mejor;
  for (let g = grueso - 0.45; g <= grueso + 0.45 + 1e-9; g += 0.05) {
    const v = nitidez(g);
    if (v > valor) { valor = v; mejor = g; }
  }
  mejor = Math.round(mejor * 20) / 20;
  // si derecha se ve casi igual de limpia, no hay nada que enderezar
  if (Math.abs(mejor) < TORCIDA_MINIMA || valor < nitidez(0) * 1.05) return 0;
  return mejor;
}

/**
 * Gira el contenido de la hoja «grados» a favor del reloj alrededor de su
 * centro. Se envuelve lo que ya había en q…Q con un «cm»: la foto no se
 * vuelve a dibujar, solo se gira, así que no pierde nada, y el texto que se
 * ponga después va por fuera, derecho.
 */
function enderezarHoja(pagina, grados) {
  const objPag = pagina.getObject();
  const m = marcoDe(pagina);
  const cx = (m.mx0 + m.mx1) / 2, cy = (m.my0 + m.my1) / 2;
  // en el papel la y va hacia arriba: a favor del reloj es un ángulo negativo
  const r = (-grados * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const abre = new Buffer();
  abre.writeLine('q ' + [co, si, -si, co, cx - co * cx + si * cy, cy - si * cx - co * cy]
    .map((v) => v.toFixed(5)).join(' ') + ' cm');
  const cierra = new Buffer();
  cierra.writeLine('Q');
  const cont = objPag.get('Contents');
  const arr = doc.newArray();
  arr.push(doc.addStream(abre, {}));
  if (cont.isArray()) { for (let i = 0; i < cont.length; i++) arr.push(cont.get(i)); } else arr.push(cont);
  arr.push(doc.addStream(cierra, {}));
  objPag.put('Contents', arr);
  objPag.put('GrapaEnderezada', doc.newReal(grados));
}

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
  // Para BORRAR una raya vertical basta con que sea larga; para tomarla por
  // BORDE DE CELDA hay que pedirle mucho más, porque el palo de una letra
  // grande llega a los cuarenta y pico píxeles y, si se cuela, parte la
  // celda por la mitad y ya no se puede corregir de una vez. Un borde de
  // verdad cruza la fila entera y sigue.
  const largoColumna = Math.max(70, Math.round(al * 0.025));
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
  barrer(an, al, (x, y) => oscuro(x, y), (x, y) => { borrar[y * an + x] = 1; }, largoV);

  /* Los BORDES de celda se buscan aparte y con otra vara de medir.
     Escaneado, un borde no es una tirada limpia: llega a trozos, con
     huecos. Y el palo de una letra grande da una tirada de cuarenta y
     pico píxeles, que si se toma por borde parte la celda por la mitad y
     ya no se puede corregir de una vez.
     Lo que distingue a un borde es que abarca un tramo LARGO y que dentro
     de ese tramo está casi siempre: una columna de letras alineadas
     abarca mucho pero está medio vacía. */
  const porColumna = new Int32Array(an);
  const HUECO_BORDE = 14;
  for (let x = 0; x < an; x++) {
    let ini = -1, ultimo = -1, dentro = 0, mejor = 0;
    for (let y = 0; y <= al; y++) {
      if (y < al && oscuro(x, y)) {
        if (ini < 0) { ini = y; dentro = 0; }
        ultimo = y; dentro++;
        continue;
      }
      if (ini < 0) continue;
      if (y === al || y - ultimo > HUECO_BORDE) {
        const largo = ultimo - ini + 1;
        if (largo > mejor && dentro >= largo * 0.6) mejor = largo;
        ini = -1; dentro = 0;
      }
    }
    porColumna[x] = mejor;
  }

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
      // Una raya es FINA: un logo o una firma también dan tiradas largas.
      // Se compara con lo que mide ELLA, no con el mínimo: al lado de una
      // raya larga puede haber una mancha corta —una banda de color, un
      // sello— y eso no la convierte en mancha.
      if (v(i - vecinos) > cuenta[i] * 0.5 || v(i + vecinos) > cuenta[i] * 0.5) continue;
      if (salida.length && i - salida[salida.length - 1] <= vecinos) continue;
      salida.push(i);
    }
    return salida;
  };
  const columnas = juntar(porColumna, an, largoColumna, 6);
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

  /* 4. Fuera el gris. Un papel gris, amarillento o con sombra —más oscuro
     hacia el lomo— deja la letra con poco contraste, y el reconocedor, que
     separa tinta de papel con un solo corte para toda la hoja, se come
     letras donde el papel es oscuro. Cada punto se compara con el papel de
     SU zona (repartido suave entre zonas, para que no queden cuadros): el
     papel pasa a blanco y la tinta queda negra, sea cual sea el gris.
     Solo en la copia que se lee: la foto del documento no cambia. */
  const papelEn = (x, y) => {
    const fx = Math.min(bx - 1, Math.max(0, x / B - 0.5)), fy = Math.min(by - 1, Math.max(0, y / B - 0.5));
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(bx - 1, x0 + 1), y1 = Math.min(by - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const a = fondo[y0 * bx + x0] * (1 - tx) + fondo[y0 * bx + x1] * tx;
    const b = fondo[y1 * bx + x0] * (1 - tx) + fondo[y1 * bx + x1] * tx;
    return Math.max(40, a * (1 - ty) + b * ty);
  };
  const gris = new Uint8Array(an * al);
  for (let y = 0; y < al; y++) {
    for (let x = 0; x < an; x++) {
      const i = y * an + x, j = i * 4;
      const v = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
      // lo que llega al 90 % del papel ya es papel
      gris[i] = Math.max(0, Math.min(255, Math.round((v / (papelEn(x, y) * 0.9)) * 255)));
    }
  }

  /* 5. Fuera las motitas: el polvo del cristal y del papel sale como
     puntitos que el reconocedor lee como comas, puntos, guiones o letras
     sueltas. Se borra cada mancha pequeña que no tiene una LETRA al lado.
     Un punto decimal, el de la «i», una coma o los dos puntos están pegados
     a letras y se quedan; una mota en mitad del papel se va, y también las
     que vienen de dos en dos o en grupitos: que una mota tenga otra al lado
     no la convierte en texto. Lo que cuenta es cuánta tinta hay alrededor:
     con letra fina, una letra puede partirse en trocitos, y esos trocitos
     juntos suman mucha más tinta que un puñado de motas. */
  const OSCURO = 150;
  const AREA_MOTA = 40;           // más grande que esto ya es una letra
  const TINTA_GRUPO = 70;         // lo que suman, como mucho, unas motas juntas
  const CERCA_X = 14, CERCA_Y = 9;
  const mancha = new Int32Array(an * al).fill(-1);
  const areas = [];
  const puntos = new Int32Array(an * al);   // los puntos de cada mancha, seguidos
  const desde = [];
  let usados = 0;
  for (let i0 = 0; i0 < an * al; i0++) {
    if (mancha[i0] >= 0 || gris[i0] >= OSCURO) continue;
    const id = areas.length;
    const ini = usados;
    mancha[i0] = id; puntos[usados++] = i0;
    for (let n = ini; n < usados; n++) {
      const i = puntos[n];
      const x = i % an, y = (i / an) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= al) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= an) continue;
          const k = yy * an + xx;
          if (mancha[k] < 0 && gris[k] < OSCURO) { mancha[k] = id; puntos[usados++] = k; }
        }
      }
    }
    areas.push(usados - ini);
    desde.push(ini);
  }
  for (let id = 0; id < areas.length; id++) {
    if (areas[id] > AREA_MOTA) continue;
    let x0 = an, y0 = al, x1 = 0, y1 = 0;
    for (let n = desde[id]; n < desde[id] + areas[id]; n++) {
      const x = puntos[n] % an, y = (puntos[n] / an) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    let letraCerca = false;
    const alrededor = new Set();
    let suma = 0;
    for (let y = Math.max(0, y0 - CERCA_Y); y <= Math.min(al - 1, y1 + CERCA_Y) && !letraCerca; y++) {
      for (let x = Math.max(0, x0 - CERCA_X); x <= Math.min(an - 1, x1 + CERCA_X); x++) {
        const m = mancha[y * an + x];
        if (m < 0 || alrededor.has(m)) continue;
        if (areas[m] > AREA_MOTA) { letraCerca = true; break; }
        alrededor.add(m);
        suma += areas[m];
      }
    }
    if (letraCerca || suma > TINTA_GRUPO) continue;
    // se borra la mota y su borde difuminado, que si no queda un anillito
    // gris que el reconocedor también intenta leer
    for (let y = Math.max(0, y0 - 2); y <= Math.min(al - 1, y1 + 2); y++) {
      for (let x = Math.max(0, x0 - 2); x <= Math.min(an - 1, x1 + 2); x++) {
        const k = y * an + x;
        if (mancha[k] < 0 || mancha[k] === id) gris[k] = 255;
      }
    }
  }
  for (let i = 0, j = 0; i < gris.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = gris[i]; }

  const salida = document.createElement('canvas');
  salida.width = an; salida.height = al;
  salida.getContext('2d').putImageData(img, 0, 0);
  return { lienzo: salida, columnas, filas };
}


const NOMBRES_OCR = {
  'loading tesseract core': 'Cargando el motor…',
  'initializing tesseract': 'Arrancando el motor…',
  'loading language traineddata': 'Cargando el español…',
  'initializing api': 'Casi listo…',
  'recognizing text': 'Leyendo la hoja…',
};

/**
 * Lee la hoja n y le pone encima el texto invisible. No toca la pila de
 * deshacer ni avisa: eso lo hace quien llama, que puede ser una hoja sola o
 * todas seguidas. Devuelve { salida, ms } o { vacia: true }.
 */
async function leerYPonerTexto(n, alEstado) {
  let pagina = doc.loadPage(n);
  const escala = PPP_OCR / 72;
  const foto = () => {
    const pix = pagina.toPixmap(Matrix.scale(escala, escala), ColorSpace.DeviceRGB, false, true);
    const c = document.createElement('canvas');
    c.width = pix.getWidth(); c.height = pix.getHeight();
    c.getContext('2d').putImageData(aImageData(pix, c.width, c.height), 0, 0);
    pix.destroy();
    return c;
  };
  let crudo = foto();
  alEstado('Mirando si la hoja está torcida…');
  const torcida = medirTorcida(crudo);
  if (torcida) {
    alEstado('Enderezando la hoja…');
    enderezarHoja(pagina, torcida);
    bytesActuales = bytesDe(doc);
    abrirBytes(bytesActuales, nombre);
    pagina = doc.loadPage(n);
    crudo = foto();
  }
  const marco = marcoDe(pagina);
  alEstado('Limpiando la hoja para leerla…');
  const limpia = limpiarParaLeer(crudo);
  const png = await new Promise((r) => limpia.lienzo.toBlob(r, 'image/png'));

  const t0 = performance.now();
  const salida = await reconocer(png, { columnas: limpia.columnas, filas: limpia.filas }, (estado, avance) => {
    alEstado(NOMBRES_OCR[estado] || estado, avance);
  });
  const ms = Math.round(performance.now() - t0);
  if (!salida.renglones.length) return { vacia: true, torcida };

  alEstado('Poniendo el texto encima de la foto…');
  const modelo = {
    v: 1, ocr: true,
    renglones: salida.renglones.map((w) => ({
      t: w.texto,
      x0: w.x0 / escala, y0: w.y0 / escala, x1: w.x1 / escala, y1: w.y1 / escala,
    })),
  };
  const bytes = aplicarCapa(pagina, modelo, marco);
  if (!bytes) throw new Error('No se pudo escribir el texto.');
  bytesActuales = bytes;
  abrirBytes(bytes, nombre);
  reconocidos.set(n, {
    texto: salida.texto, confianza: Math.round(salida.confianza),
    palabras: salida.palabras, renglones: salida.renglones.length, ms, torcida,
  });
  return { salida, ms, torcida, corregidos: salida.corregidos || {} };
}

/** «Se corrigieron 3 errores típicos del reconocimiento (N° ×2, S/ ×1).» */
function textoCorregidos(c) {
  const total = Object.values(c || {}).reduce((a, n) => a + n, 0);
  if (!total) return '';
  return ` Se ${total === 1 ? 'corrigió 1 error típico' : `corrigieron ${total} errores típicos`} del reconocimiento (`
    + Object.entries(c).map(([k, n]) => `${k} ×${n}`).join(', ') + ').';
}

const enGrados = (g) => Math.abs(g).toFixed(1).replace('.', ',') + '°';

async function reconocerHoja() {
  if (!doc) return;
  const respaldo = bytesActuales;
  cargando(true, 'Preparando el reconocimiento…');
  try {
    const r = await leerYPonerTexto(paginaActual, (t, avance) =>
      cargando(true, t + (avance ? ' ' + Math.round(avance * 100) + '%' : '')));
    if (r.vacia) {
      if (r.torcida) {             // se enderezó: eso sí se puede deshacer
        pila.push({ bytes: respaldo, cambios: cambios.slice() });
        $('#btnDeshacer').disabled = false;
        dibujar();
      }
      cargando(false);
      avisar('No se reconoció ninguna palabra en esta hoja.', 'mal');
      return;
    }
    pila.push({ bytes: respaldo, cambios: cambios.slice() });
    $('#btnDeshacer').disabled = false;
    cargando(false);
    dibujar();
    descargado = false;
    apuntarTrabajo();
    avisar(`Reconocidos ${r.salida.renglones.length} renglones, ${r.salida.palabras} palabras `
      + `(${Math.round(r.salida.confianza)} % de confianza) en ${(r.ms / 1000).toFixed(1)} s.`
      + (r.torcida ? ` La hoja estaba torcida ${enGrados(r.torcida)}: se enderezó antes de leerla.` : '')
      + textoCorregidos(r.corregidos), 'bien');
  } catch (e) {
    console.error(e);
    if (respaldo && bytesActuales !== respaldo) { bytesActuales = respaldo; abrirBytes(respaldo, nombre); }
    cargando(false);
    avisar('No se pudo reconocer: ' + e.message, 'mal');
  }
}

/**
 * Las hojas que son solo foto: sin texto de verdad y sin reconocer todavía.
 * Las que ya tienen texto no se tocan: leerlas otra vez no añade nada.
 */
let porLeerDe = { bytes: null, hojas: [] };
function hojasPorLeer() {
  // leer el texto de cada hoja cuesta: se hace una vez por versión del archivo
  if (porLeerDe.bytes === bytesActuales) return porLeerDe.hojas;
  const faltan = [];
  for (let n = 0; n < totalPaginas; n++) {
    const pagina = doc.loadPage(n);
    const modelo = modeloDe(pagina);
    if (modelo && modelo.ocr !== false) continue;
    // lo mismo que cuenta Grapa al buscar: con menos de 20 letras es una
    // foto con algún resto suelto (un número, una marca), no una hoja de texto
    const letras = leerRenglones(pagina).reduce((a, r) => a + String(r.texto || '').replace(/\s/g, '').length, 0);
    if (letras >= 20) continue;
    faltan.push(n);
  }
  porLeerDe = { bytes: bytesActuales, hojas: faltan };
  return faltan;
}

/** Cuántas hojas quedan por leer, en el cartel del escaneo y en el panel. */
function pintarPorLeer() {
  const faltan = doc ? hojasPorLeer() : [];
  const n = faltan.length;
  const aqui = faltan.includes(paginaActual);
  // en el cartel: «esta hoja» y, si hay más, «todas»
  $('#btnReconocerTexto').textContent = n > 1 ? 'Reconocer esta hoja' : 'Reconocer el texto';
  $('#btnReconocerTodas').hidden = n < 2;
  $('#btnReconocerTodas').textContent = `Reconocer las ${n} hojas escaneadas`;
  // en el panel, cuando la hoja que se mira no es una de ellas
  $('#porLeer').hidden = !n || aqui || tachando;
  $('#porLeerTexto').textContent = (n === 1
    ? 'Hay 1 hoja escaneada sin leer: no se puede buscar ni corregir.'
    : `Hay ${n} hojas escaneadas sin leer: no se pueden buscar ni corregir.`);
  $('#btnReconocerTodas2').textContent = n === 1 ? 'Reconocerla' : `Reconocer las ${n}`;
}

/** «Reconocer todas», con el editor abierto a solas. */
async function reconocerTodasBoton() {
  if (!doc) return;
  const t0 = performance.now();
  let res;
  try {
    res = await reconocerTodas();
  } catch (e) {
    console.error(e);
    avisar('No se pudo reconocer: ' + e.message, 'mal');
    return;
  }
  const s = Math.round((performance.now() - t0) / 1000);
  const tiempo = s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
  let t = res.detenido
    ? `Detenido: se leyeron ${res.leidas} de ${res.total} hojas. Las demás siguen sin leer.`
    : (res.leidas === 1 ? 'Leída 1 hoja' : `Leídas ${res.leidas} hojas`) + ` en ${tiempo}.`;
  if (res.vacias) t += res.vacias === 1 ? ' En 1 no se encontró ninguna palabra.' : ` En ${res.vacias} no se encontró ninguna palabra.`;
  if (res.leidas) t += ' Ya se pueden buscar, copiar y corregir.';
  if (res.enderezadas) t += res.enderezadas === 1 ? ' 1 hoja estaba torcida y se enderezó.' : ` ${res.enderezadas} hojas estaban torcidas y se enderezaron.`;
  t += textoCorregidos(res.corregidos);
  avisar(t, res.leidas ? 'bien' : '');
}

let detenerLectura = false;

/**
 * Lee todas las hojas escaneadas seguidas, con su avance, y deja UN solo paso
 * que deshacer. Se puede detener: lo ya leído se queda.
 * Devuelve { leidas, vacias, total, detenido }.
 */
async function reconocerTodas() {
  const faltan = hojasPorLeer();
  const res = { leidas: 0, vacias: 0, total: faltan.length, detenido: false, enderezadas: 0, corregidos: {} };
  if (!faltan.length) return res;
  const respaldo = bytesActuales;
  detenerLectura = false;
  $('#cargaBarra').hidden = false;
  $('#cargaDetener').hidden = false;
  $('#cargaDetener').disabled = false;
  const pintarAvance = (k, dentro) => {
    $('#cargaAvance').style.width = Math.round(((k + (dentro || 0)) / faltan.length) * 100) + '%';
  };
  try {
    for (let k = 0; k < faltan.length; k++) {
      if (detenerLectura) { res.detenido = true; break; }
      const n = faltan[k];
      const cabeza = `Hoja ${k + 1} de ${faltan.length}`;
      pintarAvance(k, 0);
      cargando(true, cabeza + ' · Preparando…');
      const r = await leerYPonerTexto(n, (t, avance) => {
        cargando(true, cabeza + ' · ' + t + (avance ? ' ' + Math.round(avance * 100) + '%' : ''));
        if (avance) pintarAvance(k, avance);
      });
      if (r.vacia) res.vacias++; else res.leidas++;
      if (r.torcida) res.enderezadas++;
      for (const [k, n] of Object.entries(r.corregidos || {})) res.corregidos[k] = (res.corregidos[k] || 0) + n;
    }
    pintarAvance(faltan.length, 0);
  } catch (e) {
    cargando(false);
    throw e;
  }
  if (res.leidas || res.enderezadas) {
    pila.push({ bytes: respaldo, cambios: cambios.slice() });
    $('#btnDeshacer').disabled = false;
    descargado = false;
    apuntarTrabajo();
  }
  cargando(false);
  dibujar();
  return res;
}

/**
 * Lo que pide Grapa con «Hacer buscables»: leer todas las hojas escaneadas
 * y devolvérselas. Aquí no hay nada que decidir, así que al terminar se
 * devuelve solo y la pestaña se cierra.
 */
async function hacerBuscableParaGrapa() {
  let res;
  try {
    res = await reconocerTodas();
  } catch (e) {
    console.error(e);
    avisar('No se pudo reconocer: ' + e.message + '. No se devolvió nada a Grapa.', 'mal');
    return;
  }
  if (res.detenido && !res.leidas) {
    avisar('Detenido. No se devolvió nada a Grapa.', '');
    return;
  }
  devolver({ tarea: 'buscable', leidas: res.leidas, vacias: res.vacias, total: res.total });
  avisar(`Listo: ${res.leidas} hoja(s) ya se pueden buscar. Vuelve a la pestaña de Grapa.`, 'bien');
  if (!res.detenido) setTimeout(() => { try { window.close(); } catch (e) {} }, 1500);
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

/** ¿Es negrita? El palo de la letra comparado con su TAMAÑO: en Helvetica
 *  el normal ronda el 9 % y el de la negrita el 14 %. Antes se comparaba
 *  con la altura de la mayúscula, que es menor, y la letra normal de un
 *  escaneo salía casi siempre negrita. */
const esNegrita = (grosor, tam) => grosor / Math.max(1, tam) > 0.125;

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
    const natural = medirAncho(cual, comoQuedara(r.t || '').texto, tam);
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

  // Lo tachado va lo último y en negro: aunque un parche de papel caiga
  // encima de esa zona, el recuadro sigue viéndose.
  for (const c of modelo.tachados || []) {
    buf.writeLine('q 0 0 0 rg ' + rectanguloEnHoja(marco, c[0], c[1], c[2] - c[0], c[3] - c[1]) + ' f Q');
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
function cambiarRenglon(indice, textoNuevo, desp, aj) {
  return renglones[indice].deEscaneo
    ? reescribirEnEscaneo(indice, textoNuevo, desp, aj)
    : reescribir(indice, textoNuevo, desp, aj);
}

/* ---------- el cambio de verdad ---------- */
function aplicar(indice, textoNuevo, desp, aj) {
  const r = renglones[indice];
  const movido = !!(desp && textoNuevo && (desp.dx || desp.dy));
  const ajustado = !!(aj && textoNuevo);
  if (textoNuevo === r.texto && !movido && !ajustado) return;
  // sin texto, el cambio es borrar el renglón: se quita del archivo de verdad
  hacerCambio(() => cambiarRenglon(indice, textoNuevo, movido ? desp : null, ajustado ? aj : null), r.texto, textoNuevo);
}

function insertar(x, y, texto, aj) {
  hacerCambio(() => insertarRenglon(x, y, texto, aj), '', texto);
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
        insertado: resultado.insertado, propia: resultado.propia,
        movido: resultado.movido, ajustado: resultado.ajustado,
      });
      $('#btnDeshacer').disabled = false;
      cargando(false);
      pintarCambios();
      dibujar();
      refrescarHallazgosDe(paginaActual);
      descargado = false;
      apuntarTrabajo();
      const perdidas = (resultado.cambiadas && resultado.cambiadas.length
        ? ' La tipografía no tiene ' + resultado.cambiadas.map((c) => '«' + c + '»').join(', ')
          + '; quedó como «?».'
        : '')
        + (resultado.faltan && resultado.faltan.length
          ? ' Escrito en ' + resultado.tipografia + ': la del documento no trae '
            + resultado.faltan.slice(0, 4).map((c) => '«' + c + '»').join(', ') + '.'
          : '');
      avisar((resultado.borrado ? 'Renglón borrado.'
        : resultado.movido && antes === despues ? 'Movido.'
        : resultado.ajustado && antes === despues ? 'Letra ajustada.'
        : resultado.insertado
          ? 'Escrito' + (resultado.tipografia ? ' en ' + resultado.tipografia : '') + '.'
          : (resultado.sobreFoto ? 'Cambiado sobre la foto' : 'Cambiado')
            + (resultado.encogido ? `, ajustado al ancho original (${resultado.encogido} %)` : '') + '.')
        + perdidas, perdidas ? 'mal' : 'bien');
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
function reescribirEnEscaneo(indice, textoNuevo, desp, aj) {
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
    fila.tam = med.altoArriba / Math.max(0.3, metOrig.arriba);
    fila.negrita = esNegrita(med.grosor, fila.tam);
    fila.base = med.base;
    fila.x = med.izquierda;
    fila.hueco = Math.max(med.ancho, fila.x1 - fila.x0);
    fila.suavidad = med.suavidad;
    if (med.parche) parchesPapel.set(paginaActual + ':' + r.enModelo, { p: med.parche, s: med.suavidad });
  }
  // lo ajustado a mano manda sobre lo medido; el parche de papel se vuelve a
  // componer con esa letra, así que también cambia en la foto
  const letraAntes = { tam: fila.tam, negrita: fila.negrita, tinta: fila.tinta };
  if (aj) {
    if (aj.tam != null) fila.tam = aj.tam;
    if (aj.negrita != null) fila.negrita = aj.negrita;
    if (aj.tinta) fila.tinta = aj.tinta;
  }
  // moverlo a mano: el texto va donde se dejó; el parche sigue tapando el
  // sitio de antes, que es donde estaba lo viejo
  const xAntes = fila.x, baseAntes = fila.base;
  if (desp && (desp.dx || desp.dy)) {
    const met = metricaDe(textoNuevo || antes);
    const tam = fila.tam || (fila.y1 - fila.y0) / Math.max(0.3, met.alto);
    fila.x = (fila.x != null ? fila.x : fila.x0) + desp.dx;
    fila.base = (fila.base != null ? fila.base : fila.y1 - met.abajo * tam) + desp.dy;
    if (fila.tam == null) fila.tam = tam;
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
    fila.x = xAntes; fila.base = baseAntes;
    Object.assign(fila, letraAntes);
    return { ok: false, motivo };
  };

  const comprobar = PDFDocument.openDocument(salida, 'application/pdf');
  const texto = comprobar.loadPage(paginaActual).toStructuredText('preserve-whitespace').asText();
  const queda = comoQuedara(textoNuevo);
  if (textoNuevo && !texto.includes(queda.texto.trim())) return volver('El texto nuevo no quedó donde debía; no se cambió nada.');
  // (si solo se movió, el texto viejo y el nuevo son el mismo)
  if (antes.trim() && antes !== textoNuevo && texto.includes(antes.trim())) return volver('El texto viejo seguía ahí; no se cambió nada.');

  bytesActuales = salida;
  abrirBytes(salida, nombre);
  return { ok: true, sobreFoto: true, borrado: !textoNuevo, cambiadas: queda.perdidas,
           movido: !!(desp && (desp.dx || desp.dy)), ajustado: !!aj };
}


/* ---------- el reparto de un renglón en trozos ----------
   Para no perder lo que el renglón lleva dentro hay que saber qué parte de
   verdad ha cambiado: se mira hasta dónde coinciden el texto viejo y el
   nuevo por delante y por detrás. */
function comunPorDelante(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function comunPorDetras(a, b, tope) {
  let i = 0;
  while (i < tope && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Reparte el renglón corregido en trozos: lo que no ha cambiado por
 * delante, lo que se escribe nuevo y lo que no ha cambiado por detrás.
 *
 * Cada letra que no cambia se vuelve a escribir CON SU LETRA Y EN SU SITIO
 * —la misma tipografía incrustada, el mismo color, la misma coordenada—, de
 * modo que un párrafo con una palabra en negrita y un enlace en azul los
 * conserva aunque se corrija un número del medio. Antes se reescribía todo
 * con la tipografía de la primera letra y se perdía lo demás.
 *
 * Si las letras del renglón no cuadran con su texto —una hoja reconocida,
 * por ejemplo— se devuelve un trozo único, que es lo que se hacía siempre.
 */
function repartirRenglon(r, textoNuevo) {
  const viejo = [...r.texto], nuevo = [...textoNuevo];
  const letras = r.letras && r.letras.length === viejo.length ? r.letras : null;
  if (!letras) {
    return [{ texto: textoNuevo, x: r.x, y: r.y, medio: true, hueco: r.bbox[2] - r.bbox[0],
              fuente: r.fuente, rasgos: r.rasgos, size: r.size, color: r.color }];
  }
  const comoEra = (k, extra) => Object.assign({
    x: k.x, y: k.y, fuente: k.fuente, rasgos: k.rasgos, size: k.size, color: k.color,
  }, extra);

  const p = comunPorDelante(viejo, nuevo);
  const s = comunPorDetras(viejo, nuevo, Math.min(viejo.length, nuevo.length) - p);
  const hasta = viejo.length - s;
  const medio = nuevo.slice(p, nuevo.length - s).join('');
  const modelo = letras[Math.min(p, letras.length - 1)];
  const xMedio = p < letras.length ? letras[p].x : r.bbox[2];
  const xFin = hasta < letras.length ? letras[hasta].x : r.bbox[2];

  const piezas = [];
  for (let i = 0; i < p; i++) piezas.push(comoEra(letras[i], { texto: viejo[i] }));
  piezas.push(comoEra(modelo, { texto: medio, x: xMedio, medio: true, hueco: xFin - xMedio }));
  for (let i = hasta; i < letras.length; i++) piezas.push(comoEra(letras[i], { texto: viejo[i], sufijo: true }));
  return piezas;
}

function reescribir(indice, textoNuevo, desp, aj) {
  const r = renglones[indice];
  const dx = desp ? desp.dx : 0, dy = desp ? desp.dy : 0;
  const pagina = doc.loadPage(paginaActual);
  const marco = marcoDe(pagina);

  const raro = giroRaro(marco);
  if (raro) return { ok: false, motivo: raro };

  // El renglón se reparte en trozos y cada uno guarda su letra: así lo que
  // no cambia se vuelve a escribir tal y como estaba —misma tipografía,
  // mismo color, mismo sitio— y no se pierde la palabra en negrita ni el
  // enlace en azul que hubiera dentro.
  //
  // Las tipografías se miran ANTES de redactar: al quitar el renglón, la
  // que no use nadie más en la hoja se la lleva la redacción por delante.
  const objPag = pagina.getObject();
  const cacheFuentes = new Map();
  const piezas = textoNuevo ? repartirRenglon(r, textoNuevo) : [];
  // lo ajustado a mano va para el renglón entero. La negrita no se puede
  // sacar de la tipografía del documento si esta no la trae: se pide la de
  // serie de su misma familia, con o sin negrita.
  if (aj) {
    for (const t of piezas) {
      if (aj.tam != null) t.size = aj.tam;
      if (aj.tinta) t.color = aj.tinta;
      if (aj.negrita != null && aj.negrita !== !!(t.rasgos || {}).negrita) {
        t.rasgos = Object.assign({}, t.rasgos, { negrita: aj.negrita });
        t.fuente = nombreDeSerie(familiaDe(t.fuente, t.rasgos), aj.negrita, !!t.rasgos.cursiva);
      }
    }
  }
  for (const t of piezas) {
    t.f = conQueEscribir(pagina, objPag, t.fuente, t.rasgos, t.texto, t.size, cacheFuentes);
  }

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

  // 2. volver a escribir el renglón, trozo a trozo y cada uno en su sitio
  for (const t of piezas) for (const rf of t.f.refs) plantarFuente(objPag, rf);

  // El trozo cambiado se aprieta para que quepa en el hueco que dejó el
  // viejo; así lo que va detrás no se mueve. Si ni apretándolo cabe, se
  // corre lo de detrás, que es lo que hace cualquier editor.
  const cambiada = piezas.find((t) => t.medio);
  let tz = 100, encogido = 0, corrimiento = 0;
  if (aj) {
    // con otra letra los trozos ya no miden lo que medían: van uno detrás
    // de otro desde donde empezaba el renglón, y no se aprietan (si se
    // agranda la letra a mano, es para que se vea más grande)
    let cursor = piezas.length ? piezas[0].x : 0;
    for (const t of piezas) { t.x = cursor; t.sufijo = false; t.medio = false; cursor += t.f.ancho; }
  } else if (cambiada) {
    const hueco = Math.max(0, cambiada.hueco);
    if (hueco > 0.5 && cambiada.f.ancho > hueco * 1.01) {
      tz = Math.max(70, (hueco / cambiada.f.ancho) * 100);
      encogido = Math.round(tz);
    }
    corrimiento = cambiada.f.ancho * (tz / 100) - hueco;
  }

  // Todo en UN solo bloque de texto: emitido de una vez, el lector lo lee
  // como un renglón. Suelto en flujos distintos lo partiría en varios, y
  // entonces buscar «12:30» en el PDF ya no encontraría nada.
  const buf = new Buffer();
  buf.writeLine('q BT');
  for (const t of piezas) {
    if (!t.texto) continue;
    const [cr, cg, cb] = t.color || [0, 0, 0];
    const tzT = t.medio ? tz : 100;
    let x = t.x + dx + (t.sufijo ? corrimiento : 0);
    for (const sub of t.f.trozos) {
      buf.writeLine('/' + sub.clave + ' ' + t.size + ' Tf ' + tzT.toFixed(2) + ' Tz '
        + cr.toFixed(4) + ' ' + cg.toFixed(4) + ' ' + cb.toFixed(4) + ' rg '
        + matrizTexto(marco, x, t.y + dy) + ' ' + sub.cadena + ' Tj');
      x += sub.ancho * (tzT / 100);
    }
  }
  buf.writeLine('ET Q');
  const refFlujo = doc.addStream(buf, {});
  let cont = objPag.get('Contents');
  if (cont.isArray()) { cont.push(refFlujo); }
  else { const arr = doc.newArray(); arr.push(cont); arr.push(refFlujo); objPag.put('Contents', arr); }

  // 3. comprobar el resultado antes de darlo por bueno
  const salida = bytesDe(doc);
  const comprobar = PDFDocument.openDocument(salida, 'application/pdf');
  const nuevos = leerRenglones(comprobar.loadPage(paginaActual));
  // Puede haber dos renglones iguales en la misma hoja —«EE.TT.», una fila
  // repetida— y entonces quedarse con el primero que aparezca daría por
  // corrido un cambio que está en su sitio. Se toma el más cercano.
  const esperado = piezas.map((t) => t.f.texto).join('');
  const puesto = nuevos
    .filter((x) => x.texto.trim() === esperado.trim())
    .sort((a, b) => (Math.abs(a.x - r.x - dx) + Math.abs(a.y - r.y - dy))
                  - (Math.abs(b.x - r.x - dx) + Math.abs(b.y - r.y - dy)))[0];
  if (!puesto) {
    return { ok: false, motivo: 'El texto nuevo no quedó donde debía; no se cambió nada.' };
  }
  const desvio = Math.max(Math.abs(puesto.x - r.x - dx), Math.abs(puesto.y - r.y - dy));
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
  const dueña = cambiada || piezas[0];
  return { ok: true, encogido, desvio, movido: !!(dx || dy), ajustado: !!aj,
           cambiadas: [...new Set(piezas.flatMap((t) => t.f.perdidas))],
           propia: !!(dueña && dueña.f.propia),
           tipografia: dueña && dueña.f.sustituida ? dueña.f.nombre : '',
           faltan: (dueña && dueña.f.faltan) || [] };
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

function insertarRenglon(x, y, texto, aj) {
  const pagina = doc.loadPage(paginaActual);
  const marco = marcoDe(pagina);
  const raro = giroRaro(marco);
  if (raro) return { ok: false, motivo: raro };
  const modelo = modeloDe(pagina);
  return modelo && modelo.ocr !== false
    ? insertarEnEscaneo(pagina, modelo, marco, x, y, texto, aj)
    : insertarEnTexto(pagina, marco, x, y, texto, aj);
}

function insertarEnTexto(pagina, marco, x, y, texto, aj) {
  const l = letraParaInsertar(x, y);
  const cerca = l.cerca;
  const tam = aj && aj.tam != null ? aj.tam : l.tam;
  const color = aj && aj.tinta ? aj.tinta : l.color;
  let fuente = cerca ? cerca.fuente : 'Helvetica';
  let rasgos = cerca ? cerca.rasgos : null;
  if (aj && aj.negrita != null && aj.negrita !== !!(rasgos || {}).negrita) {
    rasgos = Object.assign({}, rasgos, { negrita: aj.negrita });
    fuente = nombreDeSerie(familiaDe(fuente, rasgos), aj.negrita, !!rasgos.cursiva);
  }
  const objPag = pagina.getObject();
  envolverCerrado(objPag);

  const f = conQueEscribir(pagina, objPag, fuente, rasgos, texto, tam);

  const [cr, cg, cb] = color;
  const buf = new Buffer();
  buf.writeLine('q BT');
  let cursor = x;
  for (const sub of f.trozos) {
    buf.writeLine('/' + sub.clave + ' ' + tam.toFixed(2) + ' Tf '
      + cr.toFixed(4) + ' ' + cg.toFixed(4) + ' ' + cb.toFixed(4) + ' rg '
      + matrizTexto(marco, cursor, y) + ' ' + sub.cadena + ' Tj');
    cursor += sub.ancho;
  }
  buf.writeLine('ET Q');
  const flujo = doc.addStream(buf, {});
  const cont = objPag.get('Contents');
  if (cont.isArray()) { cont.push(flujo); }
  else { const arr = doc.newArray(); arr.push(cont); arr.push(flujo); objPag.put('Contents', arr); }

  // comprobar antes de darlo por bueno, igual que al corregir
  const salida = bytesDe(doc);
  const comprobar = PDFDocument.openDocument(salida, 'application/pdf');
  const nuevos = leerRenglones(comprobar.loadPage(paginaActual));
  const puesto = nuevos
    .filter((n) => n.texto.trim() === f.texto.trim())
    .sort((a, b) => (Math.abs(a.x - x) + Math.abs(a.y - y))
                  - (Math.abs(b.x - x) + Math.abs(b.y - y)))[0];
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
  return { ok: true, insertado: true, cambiadas: f.perdidas, propia: f.propia,
           tipografia: f.sustituida ? f.nombre : '', faltan: f.faltan };
}

function insertarEnEscaneo(pagina, modelo, marco, x, y, texto, aj) {
  const l = letraParaInsertar(x, y);
  const tam = aj && aj.tam != null ? aj.tam : l.tam;
  const color = aj && aj.tinta ? aj.tinta : l.color;
  const negrita = aj && aj.negrita != null ? aj.negrita : l.negrita;
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
  if (!txt.includes(comoQuedara(texto).texto.trim())) {
    modelo.renglones.pop();
    return { ok: false, motivo: 'El texto no llegó a escribirse; no se cambió nada.' };
  }
  bytesActuales = salida;
  abrirBytes(salida, nombre);
  return { ok: true, insertado: true, sobreFoto: true, cambiadas: comoQuedara(texto).perdidas };
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
    if (motivo) {
      const p = document.createElement('div');
      p.className = 'porque';
      p.textContent = motivo;
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
  if (nuevo) editar(idx, sustituirEn(x.texto, ultimaAguja, nuevo));
}

async function reemplazarTodas() {
  const aguja = $('#buscarTexto').value;
  const nuevo = $('#reemplazarTexto').value;
  if (!doc || !aguja) { avisar('Escribe primero qué hay que buscar.', 'mal'); return; }
  if (nuevo === aguja) { avisar('El texto nuevo es igual al que buscas.', 'mal'); return; }

  const plan = new Map();              // hoja → Map(texto del renglón → veces)
  for (let h = 0; h < totalPaginas; h++) {
    for (const l of renglonesDeHoja(doc.loadPage(h))) {
      if (!posicionesDe(l.texto, aguja).length) continue;
      if (!plan.has(h)) plan.set(h, new Map());
      const m = plan.get(h);
      m.set(l.texto, (m.get(l.texto) || 0) + 1);
    }
  }
  const cuantos = [...plan.values()]
    .reduce((n, m) => n + [...m.values()].reduce((a, b) => a + b, 0), 0);
  if (!cuantos) { avisar('No aparece «' + aguja + '» en ninguna hoja.', 'mal'); return; }

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
  if (fallos) partes.push(fallos + ' que no se pudieron');
  avisar(partes.join(' · ') + (fallos ? '. Están marcados en la lista.' : '.'),
         fallos ? 'mal' : 'bien');
}


/* ---------- el modo de insertar ----------
   Mientras está puesto, los renglones dejan de recoger el clic: sin eso no
   hay manera de pulsar en el hueco que hay entre dos. Se quita solo en
   cuanto se escribe algo, para no dejarlo puesto sin querer. */
let insertando = false;

function modoInsertar(si) {
  insertando = !!si && !!doc && !$('#hojaEnvoltura').hidden;
  if (insertando && tachando) modoTachar(false);
  $('#renglones').classList.toggle('insertando', insertando);
  $('#btnInsertar').classList.toggle('activo', insertando);
  if (!insertando) cerrarCampo();
}

function campoInsertar(xHoja, yHoja) {
  const l = letraParaInsertar(xHoja, yHoja);
  const cerca = l.cerca;
  const css = (c) => 'rgb(' + (c || [0, 0, 0]).slice(0, 3).map((v) => Math.round(v * 255)).join(',') + ')';
  const ras = (cerca && cerca.rasgos) || {};
  const letra = {
    familia: ras.mono ? '"Courier New", Courier, monospace' : ras.serif ? '"Times New Roman", Times, serif'
      : 'Helvetica, Arial, sans-serif',
    negrita: !!l.negrita, cursiva: !!ras.cursiva, tam: l.tam, base: yHoja, color: css(l.color),
  };
  const campo = campoSobreHoja(
    { x: xHoja, base: yHoja, tapa: null, papel: 'transparent' },
    letra, '',
    'Se escribirá en ' + (cerca ? sinPrefijo(cerca.fuente) : l.elegida.nombre) + ' de ' + l.tam.toFixed(1) + ' pt'
      + ' · Enter: poner · Esc: dejar · ⠇ o Alt + flechas: mover',
    (v, desp, aj) => { modoInsertar(false); if (v.trim()) insertar(xHoja + desp.dx, yHoja + desp.dy, v, aj); },
    () => modoInsertar(false));
  campo.placeholder = 'Escribe aquí…';
}

$('#renglones').addEventListener('click', (ev) => {
  if (!insertando || tachando || campoAbierto) return;
  const caja = ev.currentTarget.getBoundingClientRect();
  campoInsertar((ev.clientX - caja.left) / escala, (ev.clientY - caja.top) / escala);
});

$('#btnInsertar').addEventListener('click', () => modoInsertar(!insertando));

/* ---------- tachar de verdad ----------

   Tachar un DNI, una cuenta o un nombre no es ponerle un rectángulo negro
   encima: eso se levanta copiando y pegando, o abriendo el archivo con
   cualquier otro programa. Aquí se usa la redacción de MuPDF, que:

     · QUITA del archivo las letras que caen dentro de la zona;
     · pinta de negro los PÍXELES de la foto en esa zona, si la hoja es un
       escaneo, en la imagen misma y no encima;
     · y deja un recuadro negro donde estaba, para que se vea que ahí había
       algo.

   Dos cosas más para que no quede ni rastro:

     · el archivo se guarda LIMPIO (garbage): si no, el trozo viejo de la
       hoja se queda dentro del PDF como un objeto suelto que nadie dibuja
       pero que cualquiera puede leer;
     · en una hoja escaneada y reconocida, el texto reconocido vive también
       en el modelo que guarda Grapa dentro de la hoja. Se borra de ahí lo
       que cae en la zona, o volvería a salir en la siguiente corrección.

   Primero se marcan las zonas —arrastrando sobre la hoja, o todas las
   veces que aparece una palabra— y se tachan todas juntas: un solo paso
   que deshacer.                                                       */


/** Las letras de la hoja que caen dentro de la caja (por su centro). */
function textoEnCaja(pagina, caja) {
  let t = '';
  const [x0, y0, x1, y1] = caja;
  pagina.toStructuredText('preserve-whitespace').walk({
    onChar(c, origin, font, size, quad) {
      const cx = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
      const cy = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) t += c;
    },
  });
  return t;
}

/** Guardar sin los objetos que ya no usa nadie: ahí dormía lo tachado. */
function bytesLimpios(documento) {
  const buf = documento.saveToBuffer('garbage');
  const copia = new Uint8Array(buf.asUint8Array());
  try { buf.destroy(); } catch (e) {}
  return copia;
}

/**
 * Del texto reconocido, fuera lo que cae en las cajas. Cada letra se sitúa
 * a lo largo de su renglón según lo que mide —así la escribe la capa, que
 * estira el renglón a lo ancho que ocupa en la foto—, y las que caen dentro
 * se quitan. Lo que queda a cada lado pasa a ser un renglón por su cuenta,
 * con su sitio exacto: con espacios en el hueco, el renglón se volvía a
 * estirar entero y lo de al lado se corría dentro de la zona.
 */
function limpiarModelo(modelo, cajas) {
  const letra = new Font('Helvetica');
  const nuevos = [];
  for (const r of modelo.renglones) {
    if (!r.t) continue;
    const alto = r.y1 - r.y0;
    const dentro = cajas.filter((c) => Math.min(r.y1, c[3]) - Math.max(r.y0, c[1]) >= alto * 0.4);
    if (!dentro.length) continue;
    const letras = [...r.t];
    const medidas = letras.map((c) => Math.max(0.01, medirAncho(letra, comoQuedara(c).texto || 'x', 10)));
    const total = medidas.reduce((a, b) => a + b, 0);
    const propio = r.editado || r.insertado;
    if (propio) {
      // lo que escribimos nosotros va con su propio tamaño: se deja en su
      // sitio y lo tachado pasa a espacios; el recuadro negro lo tapa
      const x0 = r.x != null ? r.x : r.x0, ancho = (r.hueco || r.x1 - r.x0);
      let x = x0, t = '';
      letras.forEach((c, i) => {
        const w = (medidas[i] / total) * ancho, centro = x + w / 2;
        x += w;
        t += dentro.some((k) => centro >= k[0] && centro <= k[2]) ? ' ' : c;
      });
      r.t = t.trim() ? t : '';
      continue;
    }
    // los trozos que se quedan, cada uno con lo que ocupa
    const ancho = r.x1 - r.x0;
    const trozos = [];
    let x = r.x0, act = null;
    letras.forEach((c, i) => {
      const w = (medidas[i] / total) * ancho, centro = x + w / 2;
      const fuera = !dentro.some((k) => centro >= k[0] && centro <= k[2]);
      if (fuera) {
        if (!act) { act = { t: '', x0: x }; trozos.push(act); }
        act.t += c; act.x1 = x + w;
      } else act = null;
      x += w;
    });
    const utiles = trozos.filter((k) => k.t.trim());
    if (!utiles.length) { r.t = ''; continue; }
    utiles.forEach((k, i) => {
      const destino = i === 0 ? r : Object.assign({}, r);
      destino.t = k.t; destino.x0 = k.x0; destino.x1 = k.x1;
      if (i > 0) nuevos.push(destino);
    });
  }
  modelo.renglones.push(...nuevos);
}

/** Quita de la hoja la capa del reconocimiento, para volver a ponerla
 *  limpia después de tachar: una redacción reescribe todo el contenido y
 *  la dejaría metida dentro, con el texto viejo. */
function quitarCapa(objPag) {
  const capa = objPag.get(CLAVE_CAPA);
  const cont = objPag.get('Contents');
  if (cont.isArray()) {
    const mismo = (a, b) => a && b && a.isIndirect && a.isIndirect() && b.isIndirect && b.isIndirect()
      && a.asIndirect() === b.asIndirect();
    const esApertura = (o) => {
      try { return o.isStream() && o.readStream().asString().trim() === 'q'; } catch (e) { return false; }
    };
    const arr = doc.newArray();
    for (let i = 0; i < cont.length; i++) {
      const o = cont.get(i);
      if (mismo(o, capa)) continue;
      // el «q» con que envolverContenido abrió lo anterior: sin su capa, sobra
      if (i === 0 && objPag.get('GrapaEnvuelto').isBoolean && objPag.get('GrapaEnvuelto').isBoolean() && esApertura(o)) continue;
      arr.push(o);
    }
    objPag.put('Contents', arr);
  }
  objPag.delete(CLAVE_CAPA);
  objPag.delete('GrapaEnvuelto');
}

function tacharEnHoja(pagina, cajas) {
  const marco = marcoDe(pagina);
  const raro = giroRaro(marco);
  if (raro) return raro;
  const objPag = pagina.getObject();
  const modelo = modeloDe(pagina);
  const conCapa = modelo && modelo.ocr !== false;
  if (modelo) {
    limpiarModelo(modelo, cajas);
    modelo.tachados = (modelo.tachados || []).concat(cajas.map((c) => c.map((v) => Math.round(v * 100) / 100)));
    if (conCapa) quitarCapa(objPag);
  }
  for (const c of cajas) {
    const an = pagina.createAnnotation('Redact');
    an.setRect(c);
    an.update();
  }
  // negro encima · los píxeles de la foto, fuera · las rayas tapadas del
  // todo, fuera · las letras, fuera
  pagina.applyRedactions(true, 2, 1, 0);
  if (modelo) {
    if (conCapa) aplicarCapa(pagina, modelo, marco);
    else objPag.put(CLAVE_MODELO, doc.newString(JSON.stringify(modelo)));
  }
  return '';
}

function tacharPendientes() {
  if (!doc || !tachas.length) return;
  const respaldo = bytesActuales;
  const lista = tachas.slice();
  cargando(true, 'Tachando…');
  setTimeout(() => {
    const volver = (motivo) => {
      abrirBytes(respaldo, nombre);
      cargando(false);
      dibujar();
      avisar(motivo, 'mal');
    };
    try {
      const porHoja = new Map();
      for (const t of lista) {
        if (!porHoja.has(t.hoja)) porHoja.set(t.hoja, []);
        porHoja.get(t.hoja).push(t.caja);
      }
      let letras = 0;
      for (const [h, cajas] of porHoja) {
        const pagina = doc.loadPage(h);
        letras += cajas.reduce((n, c) => n + textoEnCaja(pagina, c).replace(/\s/g, '').length, 0);
        const fallo = tacharEnHoja(pagina, cajas);
        if (fallo) return volver('Hoja ' + (h + 1) + ': ' + fallo);
      }
      const salida = bytesLimpios(doc);

      // Comprobar en el archivo que sale, no en lo que creemos haber hecho:
      // en ninguna zona tachada puede quedar ni una letra
      const comp = PDFDocument.openDocument(salida, 'application/pdf');
      for (const [h, cajas] of porHoja) {
        const pagina = comp.loadPage(h);
        for (const c of cajas) {
          if (textoEnCaja(pagina, c).trim()) {
            return volver('En la hoja ' + (h + 1) + ' quedaba texto dentro de la zona; no se tachó nada.');
          }
        }
      }

      pila.push({ bytes: respaldo, cambios: cambios.slice() });
      // en la lista de cambios NO se apunta lo que se tachó: esa lista se
      // guarda en el equipo con el trabajo, y ahí no debe quedar el dato
      for (const [h, cajas] of porHoja) {
        cambios.push({ hoja: h, antes: '', despues: '', tachado: cajas.length });
      }
      bytesActuales = salida;
      abrirBytes(salida, nombre);
      tachas = [];
      $('#btnDeshacer').disabled = false;
      cargando(false);
      modoTachar(false);
      pintarCambios();
      dibujar();
      if (ultimaAguja) buscarEnTodo(true);
      descargado = false;
      apuntarTrabajo();
      const n = lista.length;
      avisar((n === 1 ? 'Zona tachada' : n + ' zonas tachadas')
        + (letras ? ': ' + letras + (letras === 1 ? ' letra quitada' : ' letras quitadas') + ' del archivo.' : '.'), 'bien');
    } catch (e) {
      volver('No se pudo tachar: ' + e.message);
    }
  }, 20);
}

function modoTachar(si) {
  tachando = !!si && !!doc;
  if (tachando && insertando) modoInsertar(false);
  $('#btnTachar').classList.toggle('activo', tachando);
  $('#renglones').classList.toggle('tachando', tachando);
  if (doc) dibujar();
  pintarTachas();
}

/** Las zonas por tachar: en la hoja, recuadros rojos; en el lateral, la lista. */
function pintarTachas() {
  const capa = $('#renglones');
  $$('.tacha', capa).forEach((n) => n.remove());
  tachas.forEach((t, i) => {
    if (t.hoja !== paginaActual) return;
    const d = document.createElement('div');
    d.className = 'tacha';
    d.style.left = (t.caja[0] * escala) + 'px';
    d.style.top = (t.caja[1] * escala) + 'px';
    d.style.width = ((t.caja[2] - t.caja[0]) * escala) + 'px';
    d.style.height = ((t.caja[3] - t.caja[1]) * escala) + 'px';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tacha-quitar';
    x.title = 'No tachar esta zona';
    x.setAttribute('aria-label', 'No tachar esta zona');
    x.textContent = '×';
    x.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    x.addEventListener('click', (ev) => { ev.stopPropagation(); tachas.splice(i, 1); pintarTachas(); });
    d.appendChild(x);
    capa.appendChild(d);
  });

  const panel = $('#panelTachar');
  panel.hidden = !tachando && !tachas.length;
  const lista = $('#tachasLista');
  lista.textContent = '';
  const porHoja = new Map();
  tachas.forEach((t) => porHoja.set(t.hoja, (porHoja.get(t.hoja) || 0) + 1));
  [...porHoja.keys()].sort((a, b) => a - b).forEach((h) => {
    const li = document.createElement('li');
    const n = porHoja.get(h);
    li.textContent = 'Hoja ' + (h + 1) + ' · ' + (n === 1 ? '1 zona' : n + ' zonas');
    li.addEventListener('click', () => { if (paginaActual !== h) { paginaActual = h; cerrarCampo(); dibujar(); } });
    lista.appendChild(li);
  });
  const n = tachas.length;
  $('#btnTacharAplicar').disabled = !n;
  $('#btnTacharAplicar').textContent = n === 1 ? 'Tachar 1 zona' : n ? 'Tachar ' + n + ' zonas' : 'Tachar';
  $('#btnTacharQuitar').hidden = !n;
  $('#tacharPista').textContent = tachando
    ? 'Arrastra sobre la hoja para marcar lo que hay que quitar. Puedes marcar varias zonas, en varias hojas.'
    : 'Estas zonas están marcadas, pero todavía no se ha tachado nada.';
}

/** Todas las veces que aparece lo buscado, marcadas para tachar. */
function tacharCoincidencias() {
  const aguja = $('#buscarTexto').value.trim();
  if (!doc || !aguja) { avisar('Escribe primero qué hay que tachar: un DNI, una cuenta, un nombre.', 'mal'); return; }
  let nuevas = 0;
  const hojas = new Set();
  for (let h = 0; h < totalPaginas; h++) {
    const pagina = doc.loadPage(h);
    for (const hit of pagina.search(aguja)) {
      for (const q of hit) {
        const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
        const caja = [Math.min(...xs) - 0.5, Math.min(...ys) - 0.5, Math.max(...xs) + 0.5, Math.max(...ys) + 0.5];
        const ya = tachas.some((t) => t.hoja === h && t.caja.every((v, i) => Math.abs(v - caja[i]) < 0.5));
        if (ya) continue;
        tachas.push({ hoja: h, caja });
        nuevas++;
        hojas.add(h);
      }
    }
  }
  if (!nuevas) { avisar('No aparece «' + aguja + '» en ninguna hoja.', 'mal'); return; }
  const primera = Math.min(...hojas);
  if (paginaActual !== primera) { paginaActual = primera; cerrarCampo(); }
  modoTachar(true);
  avisar((nuevas === 1 ? '1 coincidencia marcada' : nuevas + ' coincidencias marcadas') + ' en '
    + (hojas.size === 1 ? '1 hoja' : hojas.size + ' hojas') + '. Revísalas y pulsa «Tachar».', 'bien');
}

/* arrastrar para marcar una zona */
let arrastre = null;
$('#renglones').addEventListener('pointerdown', (ev) => {
  if (!tachando || ev.button !== 0) return;
  ev.preventDefault();
  const caja = ev.currentTarget.getBoundingClientRect();
  const x = (ev.clientX - caja.left) / escala, y = (ev.clientY - caja.top) / escala;
  const d = document.createElement('div');
  d.className = 'tacha tacha-nueva';
  ev.currentTarget.appendChild(d);
  arrastre = { x, y, d, caja };
  ev.currentTarget.setPointerCapture(ev.pointerId);
});
$('#renglones').addEventListener('pointermove', (ev) => {
  if (!arrastre) return;
  const x = (ev.clientX - arrastre.caja.left) / escala, y = (ev.clientY - arrastre.caja.top) / escala;
  const d = arrastre.d;
  d.style.left = (Math.min(x, arrastre.x) * escala) + 'px';
  d.style.top = (Math.min(y, arrastre.y) * escala) + 'px';
  d.style.width = (Math.abs(x - arrastre.x) * escala) + 'px';
  d.style.height = (Math.abs(y - arrastre.y) * escala) + 'px';
});
$('#renglones').addEventListener('pointerup', (ev) => {
  if (!arrastre) return;
  const a = arrastre;
  arrastre = null;
  a.d.remove();
  const x = (ev.clientX - a.caja.left) / escala, y = (ev.clientY - a.caja.top) / escala;
  const pagina = doc.loadPage(paginaActual);
  const lim = pagina.getBounds();
  const caja = [Math.max(0, Math.min(x, a.x)), Math.max(0, Math.min(y, a.y)),
                Math.min(lim[2] - lim[0], Math.max(x, a.x)), Math.min(lim[3] - lim[1], Math.max(y, a.y))];
  // un clic sin arrastrar no marca nada: no se tacha media hoja sin querer
  if (caja[2] - caja[0] < 3 || caja[3] - caja[1] < 3) return;
  tachas.push({ hoja: paginaActual, caja });
  pintarTachas();
});

$('#btnTachar').addEventListener('click', () => modoTachar(!tachando));
$('#btnTacharAplicar').addEventListener('click', tacharPendientes);
$('#btnTacharQuitar').addEventListener('click', () => { tachas = []; pintarTachas(); });
$('#btnTacharTodas').addEventListener('click', tacharCoincidencias);

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
      + (c.movido ? ' · movido' : '')
      + (c.ajustado ? ' · letra ajustada' : '')
      + (c.tipografia ? ' · escrito en ' + c.tipografia
         : c.propia ? ' · con la letra del documento' : '');
    if (c.tachado) {
      donde.textContent = 'Hoja ' + (c.hoja + 1) + ' · tachado';
      const t = document.createElement('div');
      t.className = 'despues';
      t.textContent = (c.tachado === 1 ? '1 zona tachada' : c.tachado + ' zonas tachadas')
        + ': lo que había se quitó del archivo.';
      li.append(donde, t);
      lista.appendChild(li);
      return;
    }
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

function devolver(extra) {
  if (!grapa || grapa.closed) { avisar('La ventana de Grapa ya no está abierta.', 'mal'); return; }
  grapa.postMessage(Object.assign({ grapa: 'documento-editado', nombre, bytes: bytesActuales, cambios: cambios.length },
    extra && extra.tarea ? extra : {}), '*');
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
  if (d.tarea === 'buscable') { hacerBuscableParaGrapa(); return; }
  avisar('Documento recibido de Grapa.', 'bien');
});

/* ---------- conexiones de la interfaz ---------- */
$('#btnEntendidoFirma').addEventListener('click', () => { $('#avisoFirma').hidden = true; });
$('#btnAbrir').addEventListener('click', () => $('#archivo').click());
$('#archivo').addEventListener('change', (e) => { leerArchivo(e.target.files[0]); e.target.value = ''; });
$('#btnDescargar').addEventListener('click', descargar);
$('#btnDevolver').addEventListener('click', () => devolver());
$('#cargaDetener').addEventListener('click', () => {
  detenerLectura = true;
  $('#cargaDetener').disabled = true;
  $('#cargaTexto').textContent = 'Deteniendo al terminar esta hoja…';
});
$('#btnDeshacer').addEventListener('click', deshacer);
$('#btnReconocer').addEventListener('click', reconocerHoja);
$('#btnReconocerTodas').addEventListener('click', reconocerTodasBoton);
$('#btnReconocerTodas2').addEventListener('click', reconocerTodasBoton);
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
  if (ev.key === 'Escape' && tachando) modoTachar(false);
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

$('#btnDescartar').addEventListener('click', async () => {
  $('#recuperar').hidden = true;
  guardadoEnEspera = null;
  // se espera a que esté borrado de verdad antes de decir que lo está:
  // recargando en ese medio segundo, volvía a aparecer
  await olvidarTrabajo();
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
