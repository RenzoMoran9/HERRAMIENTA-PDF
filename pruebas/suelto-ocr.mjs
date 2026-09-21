/* El archivo suelto, desde el disco y con el navegador SIN RED: reconocer el
   texto de un escaneo sin descargar absolutamente nada. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true, offline: true });
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !/Estimating resolution/.test(m.text())) fallos.push(m.text().slice(0, 160)); });
let malas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) malas++; };

const t0 = Date.now();
await pag.goto('file://' + path.join(RAIZ, 'GrapaEditor.html'));
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 90000 });
console.log('arranque desde el disco, sin red:', Date.now() - t0, 'ms');

await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'escaneo.pdf'));
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 30000 });
ok('reconoce que es un escaneo', true);

const t1 = Date.now();
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 240000 });
const ms = Date.now() - t1;
console.log('reconocido en', (ms / 1000).toFixed(1), 's · sin descargar nada');
const texto = await pag.inputValue('#reconocidoTexto');
ok('leyó el postor', /COMERCIAL SAN JOSE/i.test(texto));
ok('leyó el importe', /12[.,]450/.test(texto));

const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida = fs.readFileSync(await (await bajada).path());
ok('el PDF sale entero', new TextDecoder().decode(salida.slice(0, 5)) === '%PDF-',
   JSON.stringify(new TextDecoder().decode(salida.slice(0, 9))));
const d = mupdf.PDFDocument.openDocument(new Uint8Array(salida), 'application/pdf');
ok('y se puede buscar dentro', /COMERCIAL SAN JOSE/i.test(
  d.loadPage(0).toStructuredText('preserve-whitespace').asText()));

console.log('\nfallos:', fallos.length ? fallos.join(' | ') : 'ninguno');
if (fallos.length) malas++;
console.log(malas ? `\n${malas} FALLA(S)` : '\nTODO BIEN');
await nav.close();
process.exit(malas ? 1 : 0);
