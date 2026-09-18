/* Un PDF impreso por Chrome (como los de Gmail) incrusta las tipografías en
   subconjunto: «BAAAAA+ArialMT». Antes eso rompía la escritura. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUERTO = 8360;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true });
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push('pageerror: ' + e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) fallos.push(m.text()); });
let malas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) malas++; };

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
const ORIGEN = path.join(RAIZ, 'pruebas', 'correo.pdf');
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('.renglon', { timeout: 20000 });
console.log('renglones:', await pag.locator('.renglon').count());

const casos = [
  ['SOLICITO ACTUALIZACION DE COTIZACION - EXP. 10009', 'SOLICITO ACTUALIZACION DE COTIZACION - EXP. 10488', 'titular en negrita'],
  ['Monto total: S/ 8,400.00', 'Monto total: S/ 9,150.00', 'renglon en cursiva'],
  ['Atentamente, el area de ventas.', 'Atentamente, el area comercial.', 'renglon con gracias (Times)'],
  ['EXP-10009-2026', 'EXP-10488-2026', 'renglon monoespaciado (Courier)'],
];
for (const [viejo, nuevo, que] of casos) {
  const idx = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
    .findIndex((n) => (n.title || '').includes(v)), viejo);
  if (idx < 0) { ok(que + ': se encuentra', false, viejo); continue; }
  const t = await pag.locator('.renglon').nth(idx).getAttribute('title');
  await pag.locator('.renglon').nth(idx).click();
  await pag.waitForSelector('.campo');
  await pag.fill('.campo', t.replace(viejo, nuevo));
  await pag.press('.campo', 'Enter');
  await pag.waitForTimeout(2500);
  const avisos = (await pag.textContent('#avisos')) || '';
  ok(que + ': se pudo aplicar', !/No se pudo aplicar/.test(avisos), avisos.trim().split('\n').pop());
}
const lista = await pag.textContent('#cambios');
console.log('\nlista de cambios:\n' + (lista || '').trim());

const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const editado = fs.readFileSync(await (await bajada).path());
const texto = (b) => {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
  return d.loadPage(0).toStructuredText('preserve-whitespace').asText();
};
ok('el PDF sale entero, con su cabecera intacta',
   new TextDecoder().decode(editado.slice(0, 5)) === '%PDF-',
   JSON.stringify(new TextDecoder().decode(editado.slice(0, 9))));
const antes = texto(fs.readFileSync(ORIGEN)), despues = texto(editado);
console.log('\n=============== COMPROBACIÓN ===============');
for (const [viejo, nuevo, que] of casos) {
  ok(que + ': el texto nuevo está en el PDF', despues.includes(nuevo));
  ok(que + ': el viejo desapareció', !despues.includes(viejo));
}
ok('no se perdieron renglones',
   despues.split('\n').filter((x) => x.trim()).length === antes.split('\n').filter((x) => x.trim()).length,
   { antes: antes.split('\n').filter((x) => x.trim()).length, despues: despues.split('\n').filter((x) => x.trim()).length });
console.log('fallos de consola:', fallos.length ? fallos.join(' | ') : 'ninguno');
await pag.screenshot({ path: path.join(RAIZ, 'pruebas', 'subconjunto.png') });
console.log(malas ? `\n${malas} FALLA(S)` : '\nTODO BIEN');
await nav.close(); srv.kill();
process.exit(malas ? 1 : 0);
