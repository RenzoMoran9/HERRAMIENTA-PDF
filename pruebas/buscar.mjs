/* Buscar y reemplazar en todo el documento.

   El expediente de prueba lleva «EXP. 10488» en sus cinco hojas: es
   exactamente el caso que motivó la función —un número mal puesto que se
   repite— y sirve para comprobar lo que de verdad importa: que cambian
   TODAS, que no se pierde ningún renglón por el camino y que los cinco
   cambios se deshacen de una vez, no de cinco en cinco. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUERTO = process.env.PUERTO || 8329;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 700));

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true });
const pag = await ctx.newPage();
const errores = [];
pag.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errores.push('console: ' + m.text()); });

let fallas = 0;
const ok = (t, c, extra) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); if (!c) fallas++; };

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });
const original = fs.readFileSync(path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });

/* ---------- 1. buscar ---------- */
await pag.fill('#buscarTexto', '10488');
await pag.click('#btnBuscar');
await pag.waitForSelector('#resultados li', { timeout: 20000 });
const res = await pag.evaluate(() => ({
  cuantos: document.querySelectorAll('#resultados li').length,
  resumen: document.querySelector('#buscarResumen').textContent,
  marcados: [...document.querySelectorAll('#resultados mark')].map((m) => m.textContent),
  hojas: [...document.querySelectorAll('#resultados .donde')].map((d) => d.textContent),
}));
ok('encuentra las cinco, una por hoja', res.cuantos === 5, res);
ok('lo dice en el resumen', /5 coincidencias en 5 hojas/.test(res.resumen), res.resumen);
ok('resalta lo buscado, no el renglón entero', res.marcados.every((m) => m === '10488'), res.marcados);
ok('va saltando de hoja en hoja', res.hojas.join(',') === 'Hoja 1,Hoja 2,Hoja 3,Hoja 4,Hoja 5', res.hojas);

/* ---------- 2. pulsar un resultado lleva a su hoja ---------- */
await pag.locator('#resultados li').nth(3).click();
await pag.waitForTimeout(700);
const tras = await pag.evaluate(() => ({
  etiqueta: document.querySelector('#pagEtiqueta').textContent,
  resaltados: document.querySelectorAll('.renglon.hallado').length,
}));
ok('pulsar el cuarto resultado abre la hoja 4', tras.etiqueta.trim() === '4 / 5', tras);
ok('y deja marcado el renglón en la hoja', tras.resaltados === 1, tras);

/* ---------- 3. buscar algo que no está ---------- */
await pag.fill('#buscarTexto', 'ZZZ-NO-EXISTE');
await pag.click('#btnBuscar');
await pag.waitForTimeout(600);
ok('lo que no está, se dice',
   /Sin coincidencias/.test(await pag.textContent('#buscarResumen')),
   await pag.textContent('#buscarResumen'));

/* ---------- 4. reemplazar todas ---------- */
await pag.fill('#buscarTexto', '10488');
await pag.fill('#reemplazarTexto', '10500');
await pag.click('#btnReemplazarTodo');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 5, null, { timeout: 90000 });
const aviso = (await pag.textContent('#avisos')).trim();
console.log('  aviso:', JSON.stringify(aviso));
ok('avisa de los cinco', /5 renglones cambiados/.test(aviso), aviso);
ok('y ya no queda ninguno por cambiar',
   /Sin coincidencias/.test(await pag.textContent('#buscarResumen')),
   await pag.textContent('#buscarResumen'));

/* ---------- 5. el archivo resultante ---------- */
const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const editado = fs.readFileSync(await (await bajada).path());
ok('la cabecera del PDF está sana', new TextDecoder().decode(editado.slice(0, 5)) === '%PDF-');

const textos = (buf) => {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(buf), 'application/pdf');
  const hojas = [];
  for (let i = 0; i < d.countPages(); i++) {
    hojas.push(d.loadPage(i).toStructuredText('preserve-whitespace').asText()
      .split('\n').map((s) => s.trim()).filter(Boolean));
  }
  return hojas;
};
const antes = textos(original), despues = textos(editado);
const conViejo = despues.filter((h) => h.some((l) => l.includes('10488'))).length;
const conNuevo = despues.filter((h) => h.some((l) => l.includes('10500'))).length;
ok('ninguna hoja conserva el número viejo', conViejo === 0, conViejo);
ok('las cinco llevan el nuevo', conNuevo === 5, conNuevo);

const perdidos = [];
antes.forEach((h, i) => h.forEach((l) => {
  if (l.includes('10488')) return;
  if (!despues[i].includes(l)) perdidos.push('hoja ' + (i + 1) + ': ' + l);
}));
ok('no se perdió ningún renglón de al lado', perdidos.length === 0, perdidos.slice(0, 4));

/* ---------- 6. los cinco cambios se deshacen de una vez ---------- */
await pag.keyboard.press('Control+z');
await pag.waitForTimeout(1500);
const trasDeshacer = await pag.evaluate(() => ({
  cambios: document.querySelectorAll('#cambios li').length,
  deshacer: document.querySelector('#btnDeshacer').disabled,
  resultados: document.querySelectorAll('#resultados li').length,
}));
ok('un solo Ctrl+Z deshace los cinco', trasDeshacer.cambios === 0, trasDeshacer);
ok('y vuelven a aparecer las cinco coincidencias', trasDeshacer.resultados === 5, trasDeshacer);

ok('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3));
console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo en verde');
await nav.close(); srv.kill();
process.exit(fallas ? 1 : 0);
