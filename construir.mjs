/* Junta el editor en un solo archivo, GrapaEditor.html, que funciona
   abriéndolo desde el disco: sin servidor, sin internet, sin instalar.
   Uso:  node construir.mjs                                            */

import fs from 'node:fs';
import path from 'node:path';

const aqui = path.dirname(new URL(import.meta.url).pathname);
const leer = (...p) => fs.readFileSync(path.join(aqui, ...p), 'utf8');

/* --- el wasm viaja dentro, en base64 --- */
const wasm = fs.readFileSync(path.join(aqui, 'lib', 'mupdf-wasm.wasm'));
const wasm64 = wasm.toString('base64');

/* --- el pegamento de Emscripten: le quitamos la exportación por
       defecto y le damos un nombre, porque todo va en un módulo --- */
let pegamento = leer('lib', 'mupdf-wasm.js');
if (!pegamento.includes('export default _;')) throw new Error('el pegamento cambió de forma');
pegamento = pegamento.replace('export default _;', 'const libmupdf_wasm = _;');

/* --- la biblioteca: fuera el import (ya está arriba) y fuera su
       exportación por defecto, que chocaría con la del pegamento --- */
let biblioteca = leer('lib', 'mupdf.js');
if (!biblioteca.includes('import libmupdf_wasm from "./mupdf-wasm.js";')) throw new Error('la biblioteca cambió de forma');
biblioteca = biblioteca.replace('import libmupdf_wasm from "./mupdf-wasm.js";', '');
if (!biblioteca.includes('export default {')) throw new Error('falta la exportación por defecto de la biblioteca');
biblioteca = biblioteca.replace('export default {', 'const apiMuPDF = {');

/* --- el editor: fuera su import, porque las clases ya están en
       este mismo módulo --- */
let motor = leer('assets', 'editor.js');
const marca = motor.split('\n').find((l) => l.startsWith('/*IMPORTA*/'));
if (!marca) throw new Error('falta la línea marcada /*IMPORTA*/ en editor.js');
motor = motor.replace(marca, '/* las clases de MuPDF ya están en este módulo */');

/* --- el reconocimiento de texto: la biblioteca se mete dentro, y las tres
       piezas pesadas (núcleo, trabajador y español) viajan en base64 --- */
let ocr = leer('assets', 'ocr.js');
const marcaOcr = ocr.split('\n').find((l) => l.startsWith('/*IMPORTA-OCR*/'));
if (!marcaOcr) throw new Error('falta la línea marcada /*IMPORTA-OCR*/ en ocr.js');
let biblioOcr = leer('lib', 'ocr', 'tesseract.esm.min.js');
if (!/export\s*\{[^}]*\};?/.test(biblioOcr)) throw new Error('la biblioteca de OCR cambió de forma');
biblioOcr = biblioOcr.replace(/export\s*\{[^}]*\};?/g, 'const T = tesseract_min;');
ocr = ocr.replace(marcaOcr, biblioOcr);

const enB64 = (...r) => fs.readFileSync(path.join(aqui, ...r)).toString('base64');
const desde = (b) => 'Uint8Array.from(atob("' + b + '"), (c) => c.charCodeAt(0))';
const i0 = ocr.indexOf('/*PIEZAS*/');
const i1 = ocr.indexOf('let trabajador = null;');
if (i0 < 0 || i1 < 0) throw new Error('no encuentro el hueco de las piezas en ocr.js');
ocr = ocr.slice(0, i0) + 'async function piezas() {\n  return {\n'
  + '    nucleo: ' + desde(enB64('lib', 'ocr', 'tesseract-core-simd-lstm.wasm.js')) + ',\n'
  + '    trabajador: ' + desde(enB64('lib', 'ocr', 'worker.min.js')) + ',\n'
  + '    idioma: ' + desde(enB64('lib', 'ocr', 'spa.traineddata.gz')) + ',\n'
  + '  };\n}\n\n' + ocr.slice(i1);

const marcaRec = motor.split('\n').find((l) => l.startsWith('/*IMPORTA-RECONOCER*/'));
if (!marcaRec) throw new Error('falta la línea marcada /*IMPORTA-RECONOCER*/ en editor.js');
motor = motor.replace(marcaRec, '/* reconocer() ya está en este módulo */');

const estilos = leer('assets', 'editor.css');

let pagina = leer('index.html');
pagina = pagina.replace(
  '<link rel="stylesheet" href="assets/editor.css">',
  '<style>\n' + estilos + '\n</style>'
);
pagina = pagina.replace(
  '<script type="module" src="assets/editor.js"></script>',
  '<script type="module">\n' +
  'globalThis["$libmupdf_wasm_Module"] = { wasmBinary: Uint8Array.from(atob("' + wasm64 + '"), (c) => c.charCodeAt(0)) };\n' +
  pegamento + '\n' +
  biblioteca + '\n' +
  ocr + '\n' +
  motor + '\n' +
  '</script>'
);
/* suelto no hay archivo LICENSE al lado: que el enlace lleve al repositorio */
pagina = pagina.replace('href="LICENSE"', 'href="https://www.gnu.org/licenses/agpl-3.0.html"');

const destino = path.join(aqui, 'GrapaEditor.html');
fs.writeFileSync(destino, pagina);
const mb = (fs.statSync(destino).size / 1048576).toFixed(1);
console.log('GrapaEditor.html listo · ' + mb + ' MB');
