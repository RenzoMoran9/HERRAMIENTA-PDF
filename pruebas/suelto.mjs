/* El archivo suelto, abierto desde el disco como lo hará el usuario:
   sin servidor, sin internet. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true, offline: true });   // sin red, a propósito
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push('pageerror: ' + e.message));
pag.on('console', (m) => { if (m.type() === 'error') fallos.push('console: ' + m.text()); });

const t0 = Date.now();
await pag.goto('file://' + path.join(RAIZ, 'GrapaEditor.html'));
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 60000 });
console.log('arranque desde el disco y sin red:', Date.now() - t0, 'ms');

await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
console.log('renglones:', await pag.locator('.renglon').count());

const VIEJO = 'S/ 12,450.00', NUEVO = 'S/ 13,900.00';
const idx = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes(v)), VIEJO);
const texto = await pag.locator('.renglon').nth(idx).getAttribute('title');
console.log('renglón', idx, '→', JSON.stringify(texto));
await pag.locator('.renglon').nth(idx).click();
await pag.waitForSelector('.campo');
await pag.fill('.campo', texto.replace(VIEJO, NUEVO));
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 25000 });
console.log('aviso:', (await pag.textContent('#avisos')).trim());

const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const editado = fs.readFileSync(await (await bajada).path());

const reng = (buf) => {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(buf), 'application/pdf');
  const j = JSON.parse(d.loadPage(0).toStructuredText('preserve-whitespace').asJSON());
  const o = []; for (const b of j.blocks || []) for (const l of b.lines || []) o.push(l);
  return o;
};
const antes = reng(fs.readFileSync(path.join(RAIZ, 'pruebas', 'postores.pdf')));
const despues = reng(editado);
const v = antes.find((l) => l.text.includes(VIEJO)), n = despues.find((l) => l.text.includes(NUEVO));
console.log('\n=========== COMPROBACIÓN (suelto) ===========');
console.log('renglones antes / después:', antes.length, '/', despues.length);
console.log('el importe viejo sigue   :', despues.some((l) => l.text.includes(VIEJO)));
console.log('el importe nuevo está    :', !!n);
if (v && n) {
  console.log('desvío x / y (pt)        :', Math.abs(n.x - v.x).toFixed(2), '/', Math.abs(n.y - v.y).toFixed(2));
  console.log('tipografía / tamaño      :', n.font.name, n.font.size, '(antes', v.font.name, v.font.size + ')');
  console.log('renglón completo         :', JSON.stringify(n.text));
}
console.log('fallos                   :', fallos.length ? fallos.join(' | ') : 'ninguno');
await pag.screenshot({ path: path.join(RAIZ, 'pruebas', 'suelto.png') });
await nav.close();
