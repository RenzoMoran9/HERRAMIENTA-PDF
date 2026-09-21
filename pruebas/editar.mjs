/* Prueba de punta a punta: abrir, editar un renglón, descargar y
   comprobar el archivo resultante fuera del navegador. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUERTO = 8323;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 700));

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true });
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push('pageerror: ' + e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !/Estimating resolution/.test(m.text())) fallos.push('console: ' + m.text()); });

const t0 = Date.now();
await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });
console.log('motor listo en', Date.now() - t0, 'ms');

const original = fs.readFileSync(path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
console.log('renglones:', await pag.locator('.renglon').count(), '·', await pag.textContent('#docDetalle'));

const VIEJO = 'COMERCIAL SAN JOSE SAC';
const NUEVO = 'REPRESENTACIONES DEL SUR EIRL';
const idx = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes(v)), VIEJO);
if (idx < 0) throw new Error('no se encontró el renglón de prueba');
const textoRenglon = await pag.locator('.renglon').nth(idx).getAttribute('title');
console.log('renglón', idx, '→', JSON.stringify(textoRenglon));

await pag.locator('.renglon').nth(idx).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', textoRenglon.replace(VIEJO, NUEVO));
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 25000 });
console.log('aviso:', (await pag.textContent('#avisos')).trim());
await pag.screenshot({ path: path.join(RAIZ, 'pruebas', 'editor.png') });

const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const d = await bajada;
const editado = fs.readFileSync(await d.path());
console.log('descargado:', d.suggestedFilename(), '·', editado.length, 'bytes (original', original.length + ')');

/* --- comprobación fuera del navegador --- */
const reng = (buf) => {
  const doc = mupdf.PDFDocument.openDocument(new Uint8Array(buf), 'application/pdf');
  const j = JSON.parse(doc.loadPage(0).toStructuredText('preserve-whitespace').asJSON());
  const out = [];
  for (const b of j.blocks || []) for (const l of b.lines || []) out.push(l);
  return out;
};
const antes = reng(original), despues = reng(editado);
const viejo = antes.find((l) => l.text.includes(VIEJO));
const nuevo = despues.find((l) => l.text.includes(NUEVO));

const cabecera = new TextDecoder().decode(editado.slice(0, 5));
if (cabecera !== '%PDF-') { console.error('CABECERA ROTA:', JSON.stringify(cabecera)); process.exitCode = 1; }
else console.log('cabecera del PDF: correcta (%PDF-)');
console.log('\n================ COMPROBACIÓN ================');
console.log('renglones antes / después :', antes.length, '/', despues.length);
console.log('el texto viejo sigue ahí  :', despues.some((l) => l.text.includes(VIEJO)));
console.log('el texto nuevo está       :', !!nuevo);
if (nuevo && viejo) {
  console.log('desvío horizontal (pt)    :', Math.abs(nuevo.x - viejo.x).toFixed(2));
  console.log('desvío vertical (pt)      :', Math.abs(nuevo.y - viejo.y).toFixed(2));
  console.log('tipografía antes / después:', viejo.font.name, '/', nuevo.font.name);
  console.log('tamaño antes / después    :', viejo.font.size, '/', nuevo.font.size);
  console.log('texto completo del renglón:', JSON.stringify(nuevo.text));
}
const perdidas = antes.map((l) => l.text).filter((t) => !t.includes(VIEJO) && !despues.some((l) => l.text === t));
console.log('renglones perdidos        :', perdidas.length ? JSON.stringify(perdidas) : 'ninguno');
console.log('fallos de consola         :', fallos.length ? fallos.join(' | ') : 'ninguno');

await nav.close(); srv.kill();
