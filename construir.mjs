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
  motor + '\n' +
  '</script>'
);
/* suelto no hay archivo LICENSE al lado: que el enlace lleve al repositorio */
pagina = pagina.replace('href="LICENSE"', 'href="https://www.gnu.org/licenses/agpl-3.0.html"');

const destino = path.join(aqui, 'GrapaEditor.html');
fs.writeFileSync(destino, pagina);
const mb = (fs.statSync(destino).size / 1048576).toFixed(1);
console.log('GrapaEditor.html listo · ' + mb + ' MB');
