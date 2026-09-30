/* ===========================================================
   Pdflash · Editor · reconocimiento de texto (OCR)

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
 * Parte una fila por los HUECOS grandes entre palabras.
 *
 * Muchos cuadros no tienen rayas entre columnas —la ficha RUC de SUNAT, un
 * cuadro comparativo impreso por un sistema—: las columnas se separan solo
 * con espacio en blanco. El reconocedor lee la fila de lado a lado como un
 * renglón, y entonces corregir una celda reescribía la fila entera, encima
 * de las demás columnas. Entre dos palabras de una frase hay un espacio de
 * una fracción de la altura de la letra; entre dos columnas, bastante más.
 * Pero el hueco solo no basta: en la ficha de SUNAT «ALT. KM 38» y
 * «ALQUILADO» están a una letra de distancia, lo mismo que las dos mitades
 * de «POSTOR A · COMERCIAL SAN JOSE» cuando el reconocedor no ve el punto.
 * Lo que distingue un cuadro es que sus columnas se ALINEAN: el blanco
 * entre dos columnas sigue en las filas de arriba y de abajo, como un
 * pasillo; el de una frase no, arriba hay letras. Así que:
 *   · un hueco de más de HUECO_SEGURO letras se corta siempre;
 *   · uno de más de HUECO_COLUMNA, solo si `pasillo` dice que otras líneas
 *     de alrededor también están en blanco justo ahí.
 *
 * Y se corta también donde la palabra siguiente no está a la misma altura:
 * en una celda de dos líneas («LIMA LIMA PUNTA» / «HERMOSA») pegada a otra
 * de una sola, centrada, el reconocedor junta la primera línea de una con
 * la línea de la otra, y ese renglón mezclado se medía al doble de tamaño.
 */
const HUECO_COLUMNA = 0.8;
const HUECO_SEGURO = 1.6;
const SEGURA = 30;   // de 100: por debajo, el reconocedor no está seguro de la palabra

function partirPorHuecos(ws, pasillo) {
  if (ws.length < 2) return [deLasPalabras(ws)];
  let orden = ws.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const altos = orden.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const alto = altos[altos.length >> 1];
  // Una «palabra» casi el doble de alta que las demás de su línea abarca dos
  // líneas del papel: es una lectura mala, y metida en el renglón lo hace
  // medir el doble. Se deja fuera; la segunda lectura, la dispersa, trae
  // esas palabras bien.
  if (orden.length >= 3) orden = orden.filter((w) => w.bbox.y1 - w.bbox.y0 <= alto * 1.8);
  if (!orden.length) return [];
  // La raya ALTA que el reconocedor se inventa en el hueco entre dos celdas
  // («—» del doble de alto que la letra) no sirve de puente: el hueco se
  // mide desde lo anterior a ella. Un guion de verdad («SOL - SUNAT») es
  // bajito y sí une.
  const deVerdad = (w) => /[\p{L}\p{N}]/u.test(w.text || '');
  const puenteFalso = (w) => !deVerdad(w) && (w.bbox.y1 - w.bbox.y0) > alto * 1.3;
  const centro = (w) => (w.bbox.y0 + w.bbox.y1) / 2;
  const grupos = [[orden[0]]];
  for (let i = 1; i < orden.length; i++) {
    const w = orden[i];
    const ultimo = grupos[grupos.length - 1];
    const previo = ultimo[ultimo.length - 1];
    const ref = [...ultimo].reverse().find((x) => !puenteFalso(x)) || previo;
    const hueco = w.bbox.x0 - ref.bbox.x1;
    const desnivel = Math.abs(centro(w) - centro(ref));
    const corta = hueco > alto * HUECO_SEGURO
      || (hueco > alto * HUECO_COLUMNA && pasillo && pasillo(ref.bbox.x1, w.bbox.x0, alto));
    if (corta || desnivel > alto * 0.55) grupos.push([w]);
    else ultimo.push(w);
  }
  // los signos sueltos que quedan en el borde de una celda son el ruido del
  // hueco: se quitan, o harían de puente al volver a juntar trozos
  // Las palabras dudosas vienen aquí también: una palabra mal leída en
  // medio de una celda sigue siendo tinta de esa celda, y si se deja fuera
  // la caja no la cubre y al corregir la celda se queda en la foto («G05B»
  // leído «cose» salía dos veces). Pero una celda hecha SOLO de dudosas es
  // ruido o una lectura mala de algo que la segunda pasada lee mejor.
  // En el borde de la celda, una dudosa se queda si parece una palabra de
  // verdad —letras o cifras, dos o más, y del alto de las demás—; si no, es
  // ruido del hueco.
  const pareceDeVerdad = (w) => deVerdad(w) && (w.text || '').trim().length >= 2
    && (w.bbox.y1 - w.bbox.y0) >= alto * 0.6 && (w.bbox.y1 - w.bbox.y0) <= alto * 1.4;
  const valeEnBorde = (w) => w.confidence >= SEGURA ? deVerdad(w) : pareceDeVerdad(w);
  // (solo en los bordes que deja un corte: los extremos del renglón entero
  // se quedan como estaban, con su puntuación)
  const partida = grupos.length > 1;
  return grupos.filter((g) => g.some((w) => w.confidence >= SEGURA && deVerdad(w))).map((g, i, todos) => {
    let a = 0, b = g.length;
    if (partida && i > 0) while (a < b && !valeEnBorde(g[a])) a++;
    else while (a < b && g[a].confidence < SEGURA) a++;
    if (partida && i < todos.length - 1) while (b > a && !valeEnBorde(g[b - 1])) b--;
    else while (b > a && g[b - 1].confidence < SEGURA && !pareceDeVerdad(g[b - 1])) b--;
    // dentro, entre palabras seguras, se queda todo lo que tenga letras
    return g.slice(a, b).filter((w) => deVerdad(w) || w.confidence >= SEGURA);
  }).filter((g) => g.length).map(deLasPalabras);
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
  const lineas = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) lineas.push(l);
  // Las cajas de las palabras de cada línea, para ver si un hueco es un
  // PASILLO: si al menos otras dos líneas cercanas que pasan por ahí
  // tienen también blanco justo en ese sitio.
  const cajas = lineas.map((l) => (l.words || []).filter((w) => /[\p{L}\p{N}]/u.test(w.text || '')).map((w) => w.bbox));
  const pasilloDe = (li) => (x0, x1, alto) => {
    const yo = cajas[li];
    if (!yo.length) return false;
    const cy = (Math.min(...yo.map((c) => c.y0)) + Math.max(...yo.map((c) => c.y1))) / 2;
    const medio0 = x0 + (x1 - x0) * 0.25, medio1 = x1 - (x1 - x0) * 0.25;
    let blancas = 0;
    for (let j = 0; j < cajas.length && blancas < 2; j++) {
      if (j === li || !cajas[j].length) continue;
      const cs = cajas[j];
      const cyj = (Math.min(...cs.map((c) => c.y0)) + Math.max(...cs.map((c) => c.y1))) / 2;
      if (Math.abs(cyj - cy) > alto * 10) continue;
      // la línea tiene que pasar por ahí: si acaba antes, no dice nada
      if (Math.min(...cs.map((c) => c.x0)) > medio0 || Math.max(...cs.map((c) => c.x1)) < medio1) continue;
      if (!cs.some((c) => c.x1 > medio0 && c.x0 < medio1)) blancas++;
    }
    return blancas >= 2;
  };
  lineas.forEach((l, li) => {
    {
      {
        const buenas = (l.words || []).filter((w) => (w.text || '').trim() && w.confidence >= 30);
        if (!buenas.length) return;
        palabras += buenas.length;
        // solo se parte si la fila CRUZA alguna raya: así los párrafos
        // normales, que no están en ningún cuadro, se quedan enteros
        const entero = deLasPalabras(buenas);
        const cruza = enCuadro(entero, filas)
          ? (columnas || []).filter((c) => c > entero.x0 + 4 && c < entero.x1 - 4)
          : [];
        // sin rayas: se parte por los huecos, con todas las palabras (las
        // dudosas solo se quedan si van en medio de palabras seguras)
        const todas = (l.words || []).filter((w) => (w.text || '').trim());
        const trozos = cruza.length ? partirPorCeldas(buenas, cruza) : partirPorHuecos(todas, pasilloDe(li));
        trozos.forEach((t) => { if (!esRuido(t)) salida.push(t); });
      }
    }
  });
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
  const corregidos = {};
  for (const r of renglones) {
    const c = corregirHabituales(r.texto);
    r.texto = c.texto;
    for (const [k, n] of Object.entries(c.cuentas)) corregidos[k] = (corregidos[k] || 0) + n;
  }
  const texto = renglones.map((r) => r.texto).join('\n');
  const conf = renglones.length
    ? renglones.reduce((a, r) => a + r.conf, 0) / renglones.length
    : (data.confidence || 0);
  return { texto, confianza: conf, renglones, palabras: uno.palabras + sumados, corregidos };
}

/* ---------- los errores que el reconocimiento repite ----------

   En un expediente hay cosas que aparecen en cada hoja y que el
   reconocimiento lee mal casi siempre igual. Se corrigen aquí, pero solo
   cuando no hay duda de qué era:

     · «N°» sale como N*, N", N', N”, N?, NS, N- o No… Se corrige cuando
       detrás viene un número: «N* 128-2026» es «N° 128-2026».
     · «S/» sale como 5/, S|, $/, 51, 57, 5:, si, SI o un 5 suelto. Se
       corrige cuando detrás viene un MONTO con sus dos decimales. Las formas
       que también podrían ser otra cosa —«51 12,480.50» puede ser el ítem 51
       con su monto, «si 1,250.00» puede ser una frase— solo se corrigen si
       delante hay algo que habla de dinero: «Son:», «total», «precio»…
       Y ninguna cifra se toca: «51,250.00» sigue siendo 51,250.00.
     · «DE» sale como na, ne, oe, pe, 0E u OE entre dos palabras en
       MAYÚSCULAS: «ORDEN na COMPRA» es «ORDEN DE COMPRA».

   Lo que no se ha podido leer no se inventa: si el reconocimiento se come
   una palabra entera, eso no se arregla aquí. */
const MONTO = String.raw`\d{1,3}(?:[,.]\d{3})*[.,]\d{2}(?!\d)`;
const DINERO = String.raw`\b(?:total|monto|precio|unitario|importe|son|adelanto|saldo|pago|valor|costo|subtotal|igv|soles|suma|asciende|a)\W{0,3}`;
const REGLAS = [
  // N°: la marca de número mal leída, seguida de un número
  { que: 'N°', re: /\bN\s?(?:[*"'”“’?º\-]|S(?=\s)|o(?=\s?\d)|e(?=\s?\d))\s?(?=\d)/g, por: 'N° ' },
  // S/: las formas que no pueden ser otra cosa, delante de un monto
  { que: 'S/', re: new RegExp(String.raw`(^|[^\p{L}\p{N}])(?:5\/|S\||5\||\$\/|\$|S7|S1|SI\/|5I)\.?\s?(?=` + MONTO + ')', 'gu'), por: '$1S/ ' },
  // S/: las dudosas, solo si delante se habla de dinero
  // (las hechas de cifras piden un espacio antes del monto: «51,250.00» es un
  // monto de cincuenta y un mil y no se toca; nunca se come una cifra)
  { que: 'S/', re: new RegExp('(' + DINERO + String.raw`)(?:(?:51|57|5)\s|5:\s?|(?:si|sl)\.?\s?)(?=` + MONTO + ')', 'giu'), por: '$1S/ ' },
  // DE entre dos palabras en mayúsculas
  { que: 'DE', re: /(\b[A-ZÁÉÍÓÚÑ]{2,}\s)(?:na|ne|oe|pe|0E|OE|DF)(?=\s[A-ZÁÉÍÓÚÑ]{2,}\b)/g, por: '$1DE' },
];

/**
 * Corrige un renglón. Devuelve el texto y cuántas veces se corrigió cada
 * cosa, para poder decirlo: { texto, cuentas: { 'N°': 2, 'S/': 1 } }.
 */
export function corregirHabituales(texto) {
  let t = String(texto || '');
  const cuentas = {};
  for (const r of REGLAS) {
    t = t.replace(r.re, (...m) => {
      cuentas[r.que] = (cuentas[r.que] || 0) + 1;
      // el reemplazo con $1 hay que hacerlo a mano dentro de una función
      return r.por.replace('$1', typeof m[1] === 'string' ? m[1] : '');
    });
  }
  // el espacio que ya traía el original no se duplica
  t = t.replace(/(N°|S\/) {2,}/g, '$1 ');
  return { texto: t, cuentas };
}

export async function soltar() {
  if (!trabajador) return;
  try { await trabajador.terminate(); } catch (e) {}
  trabajador = null;
}
