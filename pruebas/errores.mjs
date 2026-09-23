/* Los errores que el reconocimiento repite en un expediente: «N°» leído
   como N*, N" o N?, y «S/» leído como 5/, 51 o un 5 suelto.

   Dos partes:
     · frase a frase, las correcciones y —sobre todo— lo que NO se debe
       tocar: un monto de 51 mil no puede volverse «S/ 1,250.00», ni «casi»
       volverse «caS/», ni «Item 51 12,480.50» ganar un «S/»;
     · con errores.pdf (una hoja limpia y tres malas), que tras leerlo los
       N° y los S/ del documento salgan bien, que se diga cuántos se
       corrigieron y que las trampas sigan como estaban. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as mupdf from '../lib/mupdf.js';
import { TEXTO_ERRORES, HOJAS_ERRORES } from './hacer-errores.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-errores-'));
const PUERTO = process.env.PUERTO || 8399;
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

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });

console.log('--- frase a frase ---');
const CASOS = [
  // [lo que leyó el reconocimiento, lo que tiene que quedar]
  ['CARTA N* 128-2026-HNAL-OL', 'CARTA N° 128-2026-HNAL-OL'],
  ['Informe N? 45 de la', 'Informe N° 45 de la'],
  ['CARTA N" 128', 'CARTA N° 128'],
  ['EXPEDIENTE N- 16438', 'EXPEDIENTE N° 16438'],
  ['Nº 45', 'N° 45'],
  ['Precio unitario: 5/ 18.90', 'Precio unitario: S/ 18.90'],
  ['Son: 51 12,480.50 soles', 'Son: S/ 12,480.50 soles'],
  ['Monto total: 57 1,750.00', 'Monto total: S/ 1,750.00'],
  ['Precio unitario: 5 16.90', 'Precio unitario: S/ 16.90'],
  ['Son: 5: 12,400.50 soles', 'Son: S/ 12,400.50 soles'],
  ['Monto: si 1,250.00', 'Monto: S/ 1,250.00'],
  ['Total $/ 20.00', 'Total S/ 20.00'],
  ['ORDEN na COMPRA', 'ORDEN DE COMPRA'],
  // lo que NO se toca
  ['Monto total: 51,250.00', 'Monto total: 51,250.00'],
  ['Item 51 12,480.50', 'Item 51 12,480.50'],
  ['casi 1,250.00', 'casi 1,250.00'],
  ['Nota 5 12.50', 'Nota 5 12.50'],
  ['Si el postor no cumple', 'Si el postor no cumple'],
  ['Pagina 5 de 12', 'Pagina 5 de 12'],
  ['No hay postores', 'No hay postores'],
  ['S/ 1,250.00', 'S/ 1,250.00'],
  ['N° 45', 'N° 45'],
];
const salen = await pag.evaluate(async (casos) => {
  const m = await import('./assets/ocr.js');
  return casos.map(([de]) => m.corregirHabituales(de));
}, CASOS);
CASOS.forEach(([de, debe], i) => {
  const sin = de === debe;
  ok((sin ? 'no toca  ' : 'corrige  ') + JSON.stringify(de), salen[i].texto === debe, salen[i].texto);
});
ok('lo que ya estaba bien no cuenta como corregido', !Object.keys(salen[CASOS.length - 1].cuentas).length
   && !Object.keys(salen[CASOS.length - 2].cuentas).length);

console.log('\n--- un documento con los errores de verdad ---');
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'errores.pdf'));
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocerTodas');
await pag.waitForFunction(() => /Leídas|Leída/.test(document.querySelector('#avisos').textContent), null, { timeout: 400000 });
const aviso = await pag.textContent('#avisos');
ok('avisa de cuántos errores típicos corrigió, y cuáles', /corrigieron \d+ errores típicos del reconocimiento \(N° ×\d+, S\/ ×\d+\)/.test(aviso), aviso);

const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const b = fs.readFileSync(await (await bajada).path());
fs.writeFileSync(path.join(SALIDA, 'leido.pdf'), b);
const d = mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
const hojas = HOJAS_ERRORES.map((_, i) => d.loadPage(i).toStructuredText().asText());
const esperaN = TEXTO_ERRORES.join('\n').match(/N° \d/g).length * hojas.length;
const esperaS = TEXTO_ERRORES.join('\n').match(/S\/ \d/g).length * hojas.length;
const hayN = hojas.join('\n').match(/N° \d/g) || [];
const hayS = hojas.join('\n').match(/S\/ \d/g) || [];
console.log(`   N° bien escritos: ${hayN.length} de ${esperaN} · S/ bien escritos: ${hayS.length} de ${esperaS}`);
ok('los N° salen bien casi todos (al menos 8 de cada 10)', hayN.length >= esperaN * 0.8, hayN.length);
ok('los S/ salen bien casi todos (al menos 8 de cada 10)', hayS.length >= esperaS * 0.8, hayS.length);
ok('y ninguno de más: no aparece un S/ o un N° donde no lo había', hayS.length <= esperaS && hayN.length <= esperaN);
const trampas = hojas.flatMap((t) => t.split('\n').filter((l) => /segun anexo|Pagina/.test(l)));
ok('las trampas siguen sin S/ ni N°', trampas.length >= hojas.length && trampas.every((l) => !/S\/|N°/.test(l)), trampas);
ok('en la hoja limpia todo sale exacto', TEXTO_ERRORES.slice(0, 12).every((l) => hojas[0].includes(l)),
   TEXTO_ERRORES.slice(0, 12).filter((l) => !hojas[0].includes(l)));

console.log('\n--- y se encuentra buscando ---');
await pag.fill('#buscarTexto', 'N° 10488');
await pag.click('#btnBuscar');
await pag.waitForTimeout(800);
const resumen = await pag.textContent('#buscarResumen');
ok('buscar «N° 10488» lo encuentra en las hojas que lo llevan', /[3-4] (hojas|resultados|veces)|en [3-4]/.test(resumen), resumen);

ok('sin errores en la página', fallos.length === 0, fallos);
await nav.close(); srv.kill();
console.log(malas ? `\n${malas} FALLA(S)` : '\nTodo en orden');
process.exit(malas ? 1 : 0);
