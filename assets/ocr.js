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
      logger: (m) => { if (alProgresar && m.status) alProgresar(m.status, m.progress); },
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  return trabajador;
}

/**
 * Reconoce una imagen y devuelve las palabras con su recuadro, en píxeles
 * de esa imagen.
 *   { texto, confianza, palabras: [{ texto, conf, x0, y0, x1, y1 }] }
 */
export async function reconocer(imagen, alProgresar) {
  const t = await arrancar(alProgresar);
  const { data } = await t.recognize(imagen, {}, { text: true, blocks: true });
  const palabras = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        for (const w of l.words || []) {
          const t2 = (w.text || '').trim();
          if (!t2 || w.confidence < 30) continue;   // basura del ruido del escaneo
          palabras.push({
            texto: t2, conf: w.confidence,
            x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1,
          });
        }
      }
    }
  }
  return { texto: data.text || '', confianza: data.confidence || 0, palabras };
}

export async function soltar() {
  if (!trabajador) return;
  try { await trabajador.terminate(); } catch (e) {}
  trabajador = null;
}
