/* Leer escaneos en malas condiciones: torcidos, grises y con motitas.

   Antes de leer, el editor endereza la hoja torcida y le quita el gris y
   las motitas a la copia que lee. Se usa sucio.pdf: cuatro hojas con el
   mismo texto y distinta suciedad, tres torcidas y una derecha. Se mide lo
   que importa:

     · cuántas palabras se leen bien, y que los datos que se buscan —RUC,
       importe, proveedor— salgan exactos;
     · que lo que la limpieza no reconoce como letra (motas) no sale como
       texto basura;
     · que las torcidas quedan derechas en el PDF, que la derecha NO se toca
       y que el texto invisible cae encima de la tinta;
     · que el gris y las motitas se quitan solo para leer: la foto conserva
       su papel gris;
     · que se avisa de cuántas se enderezaron y que un Deshacer lo devuelve
       todo como llegó. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as mupdf from '../lib/mupdf.js';
import { TEXTO_SUCIO, HOJAS_SUCIO } from './hacer-sucio.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-sucio-'));
const PUERTO = process.env.PUERTO || 8398;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push(e.message));
// «Detected N diacritics» y «Estimating resolution» son notas del motor de
// reconocimiento, no errores de la página
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !/Estimating resolution|diacritics/.test(m.text())) fallos.push(m.text().slice(0, 160)); });
let malas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) malas++; };

const ORIGEN = path.join(RAIZ, 'pruebas', 'sucio.pdf');
const N = HOJAS_SUCIO.length;
const norm = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const palabras = (t) => norm(t).split(/[^a-z0-9,.-]+/).map((w) => w.replace(/^[.,-]+|[.,-]+$/g, '')).filter(Boolean);
const esperadas = palabras(TEXTO_SUCIO.join(' '));
/** Cuántas palabras del documento se leyeron bien, y cuántas sobran. */
function puntuar(leido) {
  const bolsa = new Map();
  for (const w of palabras(leido)) bolsa.set(w, (bolsa.get(w) || 0) + 1);
  let bien = 0;
  for (const w of esperadas) if (bolsa.get(w)) { bien++; bolsa.set(w, bolsa.get(w) - 1); }
  return { acierto: bien / esperadas.length, sobran: [...bolsa.values()].reduce((a, b) => a + b, 0) };
}

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
const avisos = () => pag.$$eval('#avisos > *', (xs) => xs.map((x) => x.textContent).join(' | '));

console.log('--- leer las cuatro hojas ---');
const t0 = Date.now();
await pag.click('#btnReconocerTodas');
await pag.waitForFunction(() => /Leídas|Leída/.test(document.querySelector('#avisos').textContent), null, { timeout: 400000 });
console.log(`   (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const aviso = await avisos();
ok('avisa de que 3 hojas estaban torcidas y se enderezaron', /3 hojas estaban torcidas y se enderezaron/.test(aviso), aviso);

const bajar = async (nombre) => {
  const bajada = pag.waitForEvent('download');
  await pag.click('#btnDescargar');
  const b = fs.readFileSync(await (await bajada).path());
  fs.writeFileSync(path.join(SALIDA, nombre), b);
  return mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
};
const antesDoc = mupdf.PDFDocument.openDocument(new Uint8Array(fs.readFileSync(ORIGEN)), 'application/pdf');
const d = await bajar('leido.pdf');
const textos = HOJAS_SUCIO.map((_, i) => d.loadPage(i).toStructuredText().asText());
const notas = textos.map(puntuar);
const media = notas.reduce((a, n) => a + n.acierto, 0) / N;
console.log('   palabras bien por hoja:', notas.map((n) => Math.round(n.acierto * 100) + ' %').join(' · '),
  ' · sobran:', notas.map((n) => n.sobran).join(' '));
ok(`en conjunto se leen bien al menos 93 de cada 100 palabras (${(media * 100).toFixed(1)} %)`, media >= 0.93);
ok('ninguna hoja baja del 90 %', notas.every((n) => n.acierto >= 0.9), notas.map((n) => Math.round(n.acierto * 100)));
const cuantas = (re) => textos.filter((t) => re.test(t)).length;
ok('el RUC sale exacto en al menos 3 de las 4', cuantas(/20512345678/) >= 3, cuantas(/20512345678/));
ok('el importe sale exacto en al menos 3 de las 4', cuantas(/3,480\.50/) >= 3, cuantas(/3,480\.50/));
ok('el proveedor, en al menos 2 de las 4', cuantas(/DISTRIBUIDORA.LOS ANDES EIRL/) >= 2, cuantas(/DISTRIBUIDORA.LOS ANDES EIRL/));
ok('las motitas casi no salen como texto basura (como mucho 5 palabras por hoja)',
   notas.every((n) => n.sobran <= 5), notas.map((n) => n.sobran));

console.log('\n--- derechas, y la derecha sin tocar ---');
const modeloDe = (i) => { try { return JSON.parse(d.loadPage(i).getObject().get('GrapaOCR').asString()); } catch (e) { return null; } };
const INICIOS = ['Area usuaria', 'RUC 2051', 'Orden de compra', 'Se recibieron', 'de nitrilo', 'dentro del plazo', 'Importe total', 'Firma el jefe'];
HOJAS_SUCIO.forEach((h, i) => {
  const m = modeloDe(i);
  // dónde empieza cada renglón, según el reconocimiento de la hoja ya como
  // se ve: torcida, cada uno empezaría un poco más a la izquierda
  const xs = INICIOS.map((t) => (m && m.renglones.find((r) => r.t.startsWith(t)) || {}).x0).filter((x) => x != null);
  const deriva = xs.length ? Math.max(...xs) - Math.min(...xs) : 99;
  const sinEnderezar = Math.tan((Math.abs(h.grados) * Math.PI) / 180) * 280;
  ok(`hoja ${i + 1} (${h.grados}°): los renglones empiezan en el mismo margen`
     + (h.grados ? ` (torcida habrían variado ${sinEnderezar.toFixed(0)} pt)` : ''),
     xs.length >= 5 && deriva <= 3, { renglones: xs.length, deriva: +deriva.toFixed(1) });
});
const verse = (dd, i) => dd.loadPage(i).toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceGray, false, true).getPixels();
const dif = (a, b) => { let t = 0; for (let k = 0; k < a.length; k++) t += Math.abs(a[k] - b[k]); return t / a.length; };
ok('la hoja que llegó derecha no se giró: se ve exactamente igual',
   dif(verse(d, 3), verse(antesDoc, 3)) < 0.5 && !d.loadPage(3).getObject().get('GrapaEnderezada').isNumber(),
   dif(verse(d, 3), verse(antesDoc, 3)).toFixed(2));
ok('las torcidas sí cambiaron', [0, 1, 2].every((i) => dif(verse(d, i), verse(antesDoc, i)) > 3));

// el texto invisible cae sobre la tinta: donde dice que está el renglón del
// RUC hay mucha más tinta que medio renglón más arriba o más abajo
const K = 3;
const tintaDe = (i) => {
  const r = (modeloDe(i).renglones || []).find((x) => /20512345678/.test(x.t));
  if (!r) return null;
  const px = d.loadPage(i).toPixmap(mupdf.Matrix.scale(K, K), mupdf.ColorSpace.DeviceGray, false, true);
  const v = px.getPixels(), st = px.getStride();
  const en = (dy) => {
    let t = 0, n = 0;
    for (let y = Math.floor((r.y0 + dy) * K); y < Math.ceil((r.y1 + dy) * K); y++) {
      for (let x = Math.floor(r.x0 * K); x < Math.ceil(r.x1 * K); x++) { n++; if (v[y * st + x] < 120) t++; }
    }
    return t / n;
  };
  return { sobre: en(0), arriba: en(-15), abajo: en(15) };
};
const t1 = tintaDe(0);
ok('en una hoja enderezada, el renglón del RUC cae encima de su tinta',
   t1 && t1.sobre > 0.05 && t1.sobre > 3 * Math.max(t1.arriba, t1.abajo),
   t1 && Object.fromEntries(Object.entries(t1).map(([k, x]) => [k, +x.toFixed(3)])));

console.log('\n--- el gris y las motitas, solo para leer ---');
const gris = (dd, i) => {
  const p = dd.loadPage(i).toPixmap(mupdf.Matrix.scale(0.5, 0.5), mupdf.ColorSpace.DeviceGray, false, true);
  const v = p.getPixels(), st = p.getStride();
  let s = 0, n = 0;   // una zona sin letra, abajo de la hoja
  for (let y = Math.floor(p.getHeight() * 0.8); y < p.getHeight() * 0.9; y++) for (let x = 60; x < 200; x++) { s += v[y * st + x]; n++; }
  return s / n;
};
ok('la foto conserva su papel gris: no se ha blanqueado', Math.abs(gris(d, 0) - gris(antesDoc, 0)) < 6,
   { antes: +gris(antesDoc, 0).toFixed(1), despues: +gris(d, 0).toFixed(1) });

console.log('\n--- deshacer ---');
await pag.click('#btnDeshacer');
await pag.waitForTimeout(800);
const d2 = await bajar('deshecho.pdf');
ok('un solo Deshacer deja las cuatro exactamente como llegaron',
   HOJAS_SUCIO.every((_, i) => dif(verse(d2, i), verse(antesDoc, i)) < 0.5));

ok('sin errores en la página', fallos.length === 0, fallos);
await nav.close(); srv.kill();
console.log(malas ? `\n${malas} FALLA(S)` : '\nTodo en orden');
process.exit(malas ? 1 : 0);
