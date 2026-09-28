/* Un cuadro sin rayas entre columnas (ficha.pdf): cada celda tiene que
   poder corregirse sola.

   Salió con la ficha RUC de un proveedor: la fila entera se leía como un
   renglón, así que corregir una celda reescribía la fila de lado a lado
   encima de las demás columnas, y el renglón mezclado con la segunda línea
   de las celdas de al lado se medía al doble de tamaño. Se comprueba:

     · que cada celda sale como su propio renglón, también las de dos
       líneas, y que ningún renglón mezcla dos columnas;
     · que se miden de su tamaño (7,5 pt);
     · que al corregir una celda las de al lado no cambian ni un punto;
     · que un párrafo con « - » sigue siendo un solo renglón. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as mupdf from '../lib/mupdf.js';
import { FILAS_FICHA, PARRAFO_FICHA } from './hacer-ficha.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-ficha-'));
const PUERTO = process.env.PUERTO || 8403;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !/Estimating resolution|diacritics/.test(m.text())) fallos.push(m.text().slice(0, 160)); });
let malas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) malas++; };

const ORIGEN = path.join(RAIZ, 'pruebas', 'ficha.pdf');
const bajar = async (nombre) => {
  const bajada = pag.waitForEvent('download');
  await pag.click('#btnDescargar');
  const b = fs.readFileSync(await (await bajada).path());
  fs.writeFileSync(path.join(SALIDA, nombre), b);
  return mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
};
const K = 3;
const pixeles = (d) => {
  const p = d.loadPage(0).toPixmap(mupdf.Matrix.scale(K, K), mupdf.ColorSpace.DeviceGray, false, true);
  // copia: lo que da getPixels vive en la memoria de MuPDF y el siguiente dibujo lo pisa
  return { v: new Uint8Array(p.getPixels()), st: p.getStride() };
};
/** Cuánto cambió una zona de la hoja entre dos versiones (media por punto). */
function cambio(a, b, caja) {
  let t = 0, n = 0;
  for (let y = Math.floor(caja[1] * K); y < Math.ceil(caja[3] * K); y++) {
    for (let x = Math.floor(caja[0] * K); x < Math.ceil(caja[2] * K); x++) { t += Math.abs(a.v[y * a.st + x] - b.v[y * b.st + x]); n++; }
  }
  return t / n;
}
const indiceDe = (t) => pag.evaluate((t) => [...document.querySelectorAll('.renglon')].findIndex((r) => r.title === t || r.title.startsWith(t + '\n') || r.title.includes(t)), t);

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 180000 });
const d0 = await bajar('leido.pdf');
const renglones = JSON.parse(d0.loadPage(0).getObject().get('GrapaOCR').asString()).renglones;
console.log(renglones.map((r) => '   │ ' + r.t).join('\n'));

console.log('\n--- cada celda, su renglón ---');
const celdas = FILAS_FICHA.flat().flatMap((t) => t.split(' / '));
const norm = (t) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');
const sueltas = celdas.filter((c) => renglones.some((r) => norm(r.t) === norm(c)));
ok(`casi todas las celdas salen como su propio renglón (${sueltas.length} de ${celdas.length})`, sueltas.length >= celdas.length * 0.9,
   celdas.filter((c) => !sueltas.includes(c)));
const mezclados = renglones.filter((r) => /DEPOSITO|OFICINA/.test(r.t) && /ALQUILADO|PROPIO/.test(r.t));
ok('ningún renglón mezcla columnas (tipo y condición juntos)', mezclados.length === 0, mezclados.map((r) => r.t));
ok('el párrafo con « - » sigue siendo un solo renglón', renglones.some((r) => norm(r.t) === norm(PARRAFO_FICHA)),
   renglones.filter((r) => /Documento|Sistema/.test(r.t)).map((r) => r.t));

console.log('\n--- el tamaño de cada celda ---');
const tams = [];
for (const t of ['CALLE FICTICIA 88', '0103', 'SURCO', 'Domicilio']) {
  const i = await indiceDe(t);
  if (i < 0) { tams.push([t, null]); continue; }
  await pag.locator('.renglon').nth(i).click();
  await pag.waitForSelector('.campo-tam', { timeout: 5000 }).catch(() => console.log('   no se abrió:', t, i));
  tams.push([t, parseFloat((await pag.textContent('.campo-tam')).replace(',', '.'))]);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(200);
}
ok('se miden de su tamaño (7,5 pt), no al doble', tams.every(([, v]) => v != null && Math.abs(v - 7.5) < 1), tams);

console.log('\n--- corregir una celda sin tocar las demás ---');
const antes = pixeles(d0);
const celda = renglones.find((r) => /FICTICIA/.test(r.t));
await pag.locator('.renglon').nth(await indiceDe('CALLE FICTICIA 88')).click();
await pag.waitForSelector('.campo');
await pag.fill('.campo', 'CALLE FICTICIA 90 Int 2');
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 30000 });
const d1 = await bajar('corregido.pdf');
const despues = pixeles(d1);
const vecinas = renglones.filter((r) => r !== celda && Math.abs((r.y0 + r.y1) / 2 - (celda.y0 + celda.y1) / 2) < 14);
const cambios = vecinas.map((r) => [r.t, +cambio(antes, despues, [r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1]).toFixed(2)]);
ok('las celdas de la misma fila no cambian', vecinas.length >= 3 && cambios.every(([, c]) => c < 1), cambios);
ok('la celda corregida sí cambió', cambio(antes, despues, [celda.x0, celda.y0, celda.x1, celda.y1]) > 5);
ok('y el texto nuevo está en el PDF', /CALLE FICTICIA 90 Int 2/.test(d1.loadPage(0).toStructuredText().asText()));

console.log('\n--- volver a leer una hoja leída con el editor de antes ---');
// una hoja como las que dejaba la versión anterior: la fila entera en un
// solo renglón. Se fabrica cambiando el modelo guardado en la hoja.
const vieja = mupdf.PDFDocument.openDocument(new Uint8Array(fs.readFileSync(path.join(SALIDA, 'leido.pdf'))), 'application/pdf');
const objV = vieja.loadPage(0).getObject();
const modV = JSON.parse(objV.get('GrapaOCR').asString());
const fila3 = modV.renglones.filter((r) => /0103|DEPOSITO|FICTICIA|ALQUILADO/.test(r.t) && r.y0 > 175 && r.y0 < 195);
const junta = { t: fila3.map((r) => r.t).join(' '), x0: Math.min(...fila3.map((r) => r.x0)), y0: Math.min(...fila3.map((r) => r.y0)),
  x1: Math.max(...fila3.map((r) => r.x1)), y1: Math.max(...fila3.map((r) => r.y1)) };
modV.renglones = modV.renglones.filter((r) => !fila3.includes(r)).concat([junta]);
objV.put('GrapaOCR', vieja.newString(JSON.stringify(modV)));
const RUTA_VIEJA = path.join(SALIDA, 'leida-antes.pdf');
fs.writeFileSync(RUTA_VIEJA, vieja.saveToBuffer('').asUint8Array());
await pag.setInputFiles('#archivo', RUTA_VIEJA);
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 20000 });
ok('la hoja vieja trae la fila junta', (await indiceDe(junta.t)) >= 0, junta.t);
await pag.click('#btnReleer');
await pag.waitForFunction(() => /Leída otra vez/.test(document.querySelector('#avisos').textContent), null, { timeout: 180000 });
const d2 = await bajar('releida.pdf');
const nuevos = JSON.parse(d2.loadPage(0).getObject().get('GrapaOCR').asString()).renglones;
ok('«Volver a leer esta hoja» la deja con cada celda aparte', nuevos.some((r) => norm(r.t) === 'CALLEFICTICIA88')
   && !nuevos.some((r) => /DEPOSITO/.test(r.t) && /ALQUILADO/.test(r.t)), nuevos.filter((r) => r.y0 > 175 && r.y0 < 195).map((r) => r.t));
ok('una sola capa: el texto no sale repetido', (d2.loadPage(0).toStructuredText().asText().match(/FICTICIA/g) || []).length === 1);
await pag.click('#btnDeshacer');
await pag.waitForTimeout(600);
ok('y Deshacer la devuelve como estaba', (await indiceDe(junta.t)) >= 0);
// en una hoja con correcciones no se hace: se perderían
await pag.setInputFiles('#archivo', path.join(SALIDA, 'corregido.pdf'));
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 20000 });
await pag.click('#btnReleer');
await pag.waitForTimeout(500);
ok('en una hoja ya corregida no la borra: lo avisa', /ya tiene correcciones/.test(await pag.textContent('#avisos')));

ok('sin errores en la página', fallos.length === 0, fallos);
await nav.close(); srv.kill();
console.log(malas ? `\n${malas} FALLA(S)` : '\nTodo en orden');
process.exit(malas ? 1 : 0);
