/* ===========================================================
   Grapa · Editor · reconocimiento de texto (OCR)

   Lee lo que dice una hoja escaneada y devuelve cada palabra con
   su recuadro. Todo dentro del navegador: la imagen no sale del
   equipo y no hace falta internet.
   =========================================================== */

/*IMPORTA-OCR*/ import T from '../lib/ocr/tesseract.esm.min.js';

/* Las tres piezas pesadas. Servido, se traen de lib/ocr; en el archivo
   suelto, el constructor sustituye esta función por una que las saca de
   dentro del propio archivo. */
/*PIEZAS*/
async function piezas() {
  const traer = async (rel) =>
    new Uint8Array(await (await fetch(new URL(rel, import.meta.url))).arrayBuffer());
  return {
    nucleo: await traer('../lib/ocr/tesseract-core-simd-lstm.wasm.js'),
    trabajador: await traer('../lib/ocr/worker.min.js'),
    idioma: await traer('../lib/ocr/spa.traineddata.gz'),
  };
}

let trabajador = null;
/* A quién se le cuenta el avance. El motor se arranca una sola vez y se
   queda con la función que le pasemos al arrancar: si fuera la de aquella
   primera lectura, las siguientes enseñarían el avance de la primera
   («Hoja 1 de 3» cuando se va por la 1 de 2). Por eso pasa por aquí, y
   cada lectura pone la suya. */
let avisarA = null;

/**
 * El trabajador se arma aquí, pegando tres cosas:
 *   1. un pedacito que responde a la petición de los datos del idioma con
 *      los bytes que ya llevamos, para que no los busque en internet;
 *   2. el núcleo, que al estar ya presente evita que lo cargue de una URL
 *      aparte (un blob: no admite fragmentos, y sin fragmento la ruta no
 *      acaba en «js», que es lo que él exige para no tomarla por carpeta);
 *   3. el trabajador propiamente dicho.
 */
async function arrancar(alProgresar) {
  avisarA = alProgresar || null;
  if (trabajador) return trabajador;
  const p = await piezas();
  const b64 = btoa(Array.from(p.idioma, (n) => String.fromCharCode(n)).join(''));
  const sirveIdioma =
    'self.__idioma=Uint8Array.from(atob(' + JSON.stringify(b64) + '),c=>c.charCodeAt(0));'
    + 'const __fetch=self.fetch;'
    + 'self.fetch=function(u,...r){return String(u).includes(".traineddata")'
    + ' ? Promise.resolve(new Response(self.__idioma,{status:200})) : __fetch.call(self,u,...r);};';
  const url = URL.createObjectURL(new Blob(
    [sirveIdioma, '\n', p.nucleo, '\n', p.trabajador], { type: 'text/javascript' }));
  try {
    trabajador = await T.createWorker('spa', 1, {
      workerPath: url,
      workerBlobURL: false,
      langPath: 'https://grapa.interno',   // nunca se llega a pedir: lo sirve el pedacito
      gzip: true,
      cacheMethod: 'none',                 // guardar en el navegador no funciona desde el disco
      logger: (m) => { if (avisarA && m.status) avisarA(m.status, m.progress); },
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  return trabajador;
}

/**
 * Reconoce una imagen y devuelve los renglones con su recuadro, en píxeles
 * de esa imagen.
 *   { texto, confianza, palabras, renglones: [{ texto, conf, x0, y0, x1, y1 }] }
 */
/* Las barras sueltas son restos del borde de la celda, no texto. */
const sinBarras = (t) => String(t || '')
  .replace(/[|¦]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const deLasPalabras = (ws) => ({
  texto: sinBarras(ws.map((w) => w.text.trim()).join(' ')),
  conf: ws.reduce((a, w) => a + w.confidence, 0) / ws.length,
  x0: Math.min(...ws.map((w) => w.bbox.x0)),
  y0: Math.min(...ws.map((w) => w.bbox.y0)),
  x1: Math.max(...ws.map((w) => w.bbox.x1)),
  y1: Math.max(...ws.map((w) => w.bbox.y1)),
});

/* Sin valor: rayas sueltas, comillas perdidas, una letra suelta del ruido. */
const esRuido = (r) => {
  const t = (r.texto || '').replace(/[\s|¦]/g, '');
  return t.length < 2 || !/[\p{L}\p{N}]/u.test(t);
};

/**
 * Parte una fila por las rayas verticales del cuadro. Cada celda pasa a ser
 * un renglón suyo, que es lo que hace falta para poder corregir un importe
 * sin tener que reescribir la fila entera.
 */
function partirPorCeldas(ws, columnas) {
  if (!columnas || columnas.length < 1) return [deLasPalabras(ws)];
  const grupos = new Map();
  for (const w of ws) {
    const centro = (w.bbox.x0 + w.bbox.x1) / 2;
    let celda = 0;
    while (celda < columnas.length && columnas[celda] < centro) celda++;
    if (!grupos.has(celda)) grupos.set(celda, []);
    grupos.get(celda).push(w);
  }
  if (grupos.size < 2) return [deLasPalabras(ws)];
  return [...grupos.keys()].sort((a, b) => a - b).map((k) => deLasPalabras(grupos.get(k)));
}

/**
 * ¿Este renglón está dentro de un cuadro? Lo que lo dice de verdad no son
 * las rayas verticales —un palo de letra o un logo dan tiradas parecidas—
 * sino que esté ENCERRADO entre dos rayas horizontales próximas. Un párrafo
 * corriente no lo está nunca.
 */
const ALTO_FILA_MAX = 130;     // píxeles a 200 ppp: unos 47 puntos

function enCuadro(r, filas) {
  if (!filas || filas.length < 2) return false;
  const cy = (r.y0 + r.y1) / 2;
  let arriba = -1, abajo = -1;
  for (const y of filas) {
    if (y <= cy && (arriba < 0 || y > arriba)) arriba = y;
    if (y >= cy && (abajo < 0 || y < abajo)) abajo = y;
  }
  // encerrado entre dos rayas, y lo bastante juntas como para ser una fila
  return arriba >= 0 && abajo >= 0 && abajo - arriba <= ALTO_FILA_MAX;
}

function renglonesDe(data, columnas, filas) {
  const salida = [];
  let palabras = 0;
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        const buenas = (l.words || []).filter((w) => (w.text || '').trim() && w.confidence >= 30);
        if (!buenas.length) continue;
        palabras += buenas.length;
        // solo se parte si la fila CRUZA alguna raya: así los párrafos
        // normales, que no están en ningún cuadro, se quedan enteros
        const entero = deLasPalabras(buenas);
        const cruza = enCuadro(entero, filas)
          ? (columnas || []).filter((c) => c > entero.x0 + 4 && c < entero.x1 - 4)
          : [];
        const trozos = cruza.length ? partirPorCeldas(buenas, cruza) : [entero];
        trozos.forEach((t) => { if (!esRuido(t)) salida.push(t); });
      }
    }
  }
  return { renglones: salida, palabras };
}

const solapa = (a, b) => {
  const an = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const al = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const area = (a.x1 - a.x0) * (a.y1 - a.y0);
  return area > 0 ? (an * al) / area : 0;
};

/**
 * Junta los trozos que en el papel son UN renglón.
 *
 * Quitadas las rayas del cuadro, cada celda queda como una isla y el
 * reconocedor la parte en palabras o en pedazos. Volver a juntarlos por las
 * rayas no basta: el palo de una letra grande se toma a veces por raya y
 * parte la celda por la mitad.
 *
 * Lo que sí distingue una cosa de otra es el HUECO. Dentro de una celda, de
 * una palabra a la siguiente hay un espacio: una fracción de lo que mide la
 * letra. Entre una celda y la de al lado hay el borde y su margen, que es
 * bastante más que la letra. Así que se juntan los trozos de la misma banda
 * cuyo hueco no llegue a ocho décimas de su altura, y se dejan en paz los
 * demás.
 */
const HUECO_CELDA = 0.8;

function juntarPorHueco(lista) {
  const orden = lista.slice().sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
  const salida = [];
  for (const r of orden) {
    const alto = r.y1 - r.y0;
    const previo = salida.find((p) => {
      // misma banda: se solapan a lo alto más de la mitad
      const solape = Math.min(p.y1, r.y1) - Math.max(p.y0, r.y0);
      if (solape < Math.min(p.y1 - p.y0, alto) * 0.5) return false;
      const hueco = r.x0 - p.x1;
      return hueco >= -2 && hueco < Math.max(alto, p.y1 - p.y0) * HUECO_CELDA;
    });
    if (!previo) { salida.push(Object.assign({}, r)); continue; }
    previo.texto = sinBarras(previo.texto + ' ' + r.texto);
    previo.conf = (previo.conf + r.conf) / 2;
    previo.x0 = Math.min(previo.x0, r.x0); previo.y0 = Math.min(previo.y0, r.y0);
    previo.x1 = Math.max(previo.x1, r.x1); previo.y1 = Math.max(previo.y1, r.y1);
  }
  return salida;
}

/**
 * Se lee dos veces. La primera, en automático, que es la buena para los
 * párrafos. La segunda, en modo disperso, que es la que ve el texto suelto
 * dentro de las celdas de un cuadro: en automático las celdas se funden
 * atravesando las rayas y sale un revoltijo. Se quedan los renglones de la
 * segunda que la primera no vio.
 */
export async function reconocer(imagen, cuadricula, alProgresar) {
  const columnas = (cuadricula && cuadricula.columnas) || [];
  const filas = (cuadricula && cuadricula.filas) || [];
  const t = await arrancar(alProgresar);
  const { data } = await t.recognize(imagen, {}, { text: true, blocks: true });
  const uno = renglonesDe(data, columnas, filas);

  let dos = { renglones: [], palabras: 0 };
  try {
    if (alProgresar) alProgresar('recognizing text', 0.5);
    await t.setParameters({ tessedit_pageseg_mode: '11' });   // texto disperso
    const r2 = await t.recognize(imagen, {}, { text: true, blocks: true });
    dos = renglonesDe(r2.data, columnas, filas);
  } catch (e) { /* si no se puede, nos quedamos con la primera */ }
  finally {
    try { await t.setParameters({ tessedit_pageseg_mode: '3' }); } catch (e) {}
  }

  // Fundir las dos lecturas. La regla: cuando la segunda pasada encuentra
  // VARIAS piezas donde la primera vio una sola línea, mandan las piezas.
  // Eso es exactamente una fila de un cuadro: en automático las celdas se
  // funden en un renglón larguísimo e ilegible, y en modo disperso salen
  // una a una, que es lo que hace falta para poder corregirlas.
  // Las celdas ya las separa el corte por las rayas del cuadro, que respeta
  // la celda entera. De la segunda pasada solo se aprovecha lo que la
  // primera no vio en absoluto: si se usara para sustituir, partiría las
  // celdas en palabras sueltas.
  const renglones = uno.renglones.slice();
  let sumados = 0;
  for (const b of dos.renglones) {
    if (esRuido(b)) continue;
    if (renglones.some((y) => solapa(b, y) > 0.35)) continue;
    renglones.push(b);
    sumados += b.texto.split(/\s+/).length;
  }
  // Quitadas las rayas, cada celda queda como una isla suelta y el
  // reconocedor la parte en palabras. Se vuelven a juntar las que caen en la
  // MISMA celda —misma banda entre rayas horizontales, y mismo hueco entre
  // rayas verticales—, que es lo que hace falta para poder corregir la celda
  // de una vez y no palabra a palabra.
  const celdaDe = (r) => {
    if (!enCuadro(r, filas)) return null;
    const cy = (r.y0 + r.y1) / 2, cx = (r.x0 + r.x1) / 2;
    let fila = 0; while (fila < filas.length && filas[fila] < cy) fila++;
    let col = 0; while (col < columnas.length && columnas[col] < cx) col++;
    return fila + ':' + col;
  };
  const porCelda = new Map();
  const sueltos = [];
  for (const r of renglones) {
    const k = celdaDe(r);
    if (!k) { sueltos.push(r); continue; }
    if (!porCelda.has(k)) porCelda.set(k, []);
    porCelda.get(k).push(r);
  }
  const juntados = [...porCelda.values()].map((lista) => {
    if (lista.length === 1) return lista[0];
    lista.sort((a, b) => (a.y0 - b.y0 > (a.y1 - a.y0) * 0.6 ? 1 : a.x0 - b.x0));
    return {
      texto: sinBarras(lista.map((r) => r.texto).join(' ')),
      conf: lista.reduce((t, r) => t + r.conf, 0) / lista.length,
      x0: Math.min(...lista.map((r) => r.x0)), y0: Math.min(...lista.map((r) => r.y0)),
      x1: Math.max(...lista.map((r) => r.x1)), y1: Math.max(...lista.map((r) => r.y1)),
    };
  });
  const finales = juntarPorHueco(sueltos.concat(juntados));
  renglones.length = 0;
  renglones.push(...finales);
  renglones.sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
  const texto = renglones.map((r) => r.texto).join('\n');
  const conf = renglones.length
    ? renglones.reduce((a, r) => a + r.conf, 0) / renglones.length
    : (data.confidence || 0);
  return { texto, confianza: conf, renglones, palabras: uno.palabras + sumados };
}

export async function soltar() {
  if (!trabajador) return;
  try { await trabajador.terminate(); } catch (e) {}
  trabajador = null;
}
