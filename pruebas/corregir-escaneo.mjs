/* Corregir un renglón de una hoja ESCANEADA: se tapa con el color del papel
   y se escribe encima. La foto cambia —eso es lo que se pide— y el texto
   buscable cambia con ella, de modo que no pueden contradecirse. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUERTO = 8390;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true });
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) fallos.push(m.text().slice(0, 160)); });
let malas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) malas++; };

const ORIGEN = path.join(RAIZ, 'pruebas', 'escaneo.pdf');
await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 180000 });
const cuantos = await pag.locator('.renglon').count();
ok('tras reconocer, los renglones SÍ se pueden pulsar', cuantos > 5, cuantos);

console.log('\n--- corregir un renglón de la foto ---');
const VIEJO = 'COMERCIAL SAN JOSE', NUEVO = 'DISTRIBUIDORA ANDINA SRL';
const idx = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes(v)), VIEJO);
ok('se encuentra el renglón', idx >= 0, idx);
const antesTexto = await pag.locator('.renglon').nth(idx).getAttribute('title');
console.log('   dice:', JSON.stringify(antesTexto));
await pag.locator('.renglon').nth(idx).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
ok('avisa de que se tapará y se escribirá encima',
   /tapar/i.test(await pag.textContent('.campo-ayuda')), await pag.textContent('.campo-ayuda'));
await pag.fill('.campo', NUEVO);
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 60000 });
const aviso = (await pag.textContent('#avisos')).trim().split('\n').pop();
console.log('   aviso:', aviso);
ok('se aplicó', !/No se pudo/.test(aviso));
ok('el cambio dice que fue sobre la foto', /sobre la foto/.test(await pag.textContent('#cambios li')));

console.log('\n--- el PDF que sale ---');
const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida = fs.readFileSync(await (await bajada).path());
fs.writeFileSync(path.join(RAIZ, 'pruebas', 'salida-escaneo.pdf'), salida);
ok('sale entero', new TextDecoder().decode(salida.slice(0, 5)) === '%PDF-');

const doc = mupdf.PDFDocument.openDocument(new Uint8Array(salida), 'application/pdf');
const texto = doc.loadPage(0).toStructuredText('preserve-whitespace').asText();
ok('lo que se busca dice lo nuevo', texto.includes(NUEVO));
ok('lo que se busca ya no dice lo viejo', !texto.includes(VIEJO));

// Lo que se BUSCA ya está comprobado. Falta lo que se VE, que es lo que de
// verdad importa: se pinta la hoja resultante y se vuelve a leer con el mismo
// OCR, desde dentro del navegador.
console.log('\n--- y lo que se VE en la foto ---');
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'salida-escaneo.pdf'));
await pag.waitForSelector('.renglon', { timeout: 30000 });
const visto = await pag.evaluate(async () => {
  const lienzo = document.querySelector('#lienzo');
  const url = lienzo.toDataURL('image/png');
  const m = await import('./assets/ocr.js');
  const r = await m.reconocer(url);
  await m.soltar();
  return r.texto;
});
console.log('   leído de la imagen:', JSON.stringify(visto.split('\n').slice(0, 3).join(' | ')));
ok('la FOTO también dice lo nuevo', /ANDINA/i.test(visto));
ok('la FOTO ya no dice lo viejo', !/SAN\s+JOSE/i.test(visto));

console.log('\nfallos:', fallos.length ? fallos.join(' | ') : 'ninguno');
if (fallos.length) malas++;
await pag.screenshot({ path: path.join(RAIZ, 'pruebas', 'corregir-escaneo.png') });
console.log(malas ? `\n${malas} FALLA(S)` : '\nTODO BIEN');
await nav.close(); srv.kill();
process.exit(malas ? 1 : 0);
