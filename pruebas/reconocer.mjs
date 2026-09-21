/* Reconocer el texto de una hoja escaneada: la foto no se toca, pero el PDF
   pasa a poder buscarse y copiarse. Y no se vuelve editable. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUERTO = 8380;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true });
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push('pageerror: ' + e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) fallos.push(m.text().slice(0, 160)); });
let malas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) malas++; };

const ORIGEN = path.join(RAIZ, 'pruebas', 'escaneo.pdf');
await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
ok('la hoja llega como escaneo', true);

console.log('\n--- reconocer ---');
const t0 = Date.now();
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 180000 });
console.log('tardó', ((Date.now() - t0) / 1000).toFixed(1), 's');
console.log('resumen:', (await pag.textContent('#reconocidoResumen')).trim());
const texto = await pag.inputValue('#reconocidoTexto');
console.log('texto reconocido (primeras líneas):\n' + texto.split('\n').slice(0, 4).map((l) => '   ' + l).join('\n'));

ok('reconoció el nombre del postor', /COMERCIAL SAN JOSE/i.test(texto));
ok('reconoció el importe', /12[.,]450/.test(texto));
ok('reconoció el expediente', /10488/.test(texto));

console.log('\n--- y queda lista para corregir ---');
ok('los renglones se pueden pulsar', (await pag.locator('.renglon').count()) > 5,
   await pag.locator('.renglon').count());
ok('el cartel de escaneo desaparece', await pag.locator('#cartelEscaneo').isHidden());
ok('se ve la hoja', !(await pag.locator('#hojaEnvoltura').isHidden()));
ok('avisa de que corregir cambia también la foto',
   /tapa|foto cambia/i.test(await pag.textContent('#reconocidoResumen')));

console.log('\n--- el PDF que sale ---');
const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const editado = fs.readFileSync(await (await bajada).path());
fs.writeFileSync(path.join(RAIZ, 'pruebas', 'salida-ocr.pdf'), editado);
const leer = (b) => {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
  return { texto: d.loadPage(0).toStructuredText('preserve-whitespace').asText(), hojas: d.countPages() };
};
ok('el PDF sale entero, con su cabecera intacta',
   new TextDecoder().decode(editado.slice(0, 5)) === '%PDF-',
   JSON.stringify(new TextDecoder().decode(editado.slice(0, 9))));
const antes = leer(fs.readFileSync(ORIGEN)), despues = leer(editado);
ok('antes no se podía leer nada dentro', antes.texto.trim() === '', JSON.stringify(antes.texto.slice(0, 40)));
ok('ahora SÍ se puede buscar dentro del PDF', /COMERCIAL SAN JOSE/i.test(despues.texto));
ok('sigue teniendo las mismas hojas', despues.hojas === antes.hojas, despues.hojas);

// la foto tiene que estar intacta: se comparan los píxeles pintados
// getPixels() devuelve una ventana a la memoria del motor, igual que
// asUint8Array(). Si no se copia en el acto, al renderizar el segundo
// documento la primera se queda vacía y la comparación miente.
const pinta = (b) => {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
  const p = d.loadPage(0).toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, false, true);
  return new Uint8Array(p.getPixels());
};
const pa = pinta(fs.readFileSync(ORIGEN)), pd = pinta(editado);
let distintos = 0;
for (let i = 0; i < Math.min(pa.length, pd.length); i++) if (pa[i] !== pd[i]) distintos++;
ok('la foto no se tocó: se ve exactamente igual', distintos === 0 && pa.length === pd.length,
   { pixelesDistintos: distintos, mismoTamano: pa.length === pd.length });

console.log('\nfallos:', fallos.length ? fallos.join(' | ') : 'ninguno');
if (fallos.length) malas++;
await pag.screenshot({ path: path.join(RAIZ, 'pruebas', 'reconocer.png') });
console.log(malas ? `\n${malas} FALLA(S)` : '\nTODO BIEN');
await nav.close(); srv.kill();
process.exit(malas ? 1 : 0);
