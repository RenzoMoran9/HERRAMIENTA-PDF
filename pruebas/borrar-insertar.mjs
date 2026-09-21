/* Borrar un renglón y escribir donde no había nada.

   Las dos cosas se comprueban en las dos clases de hoja: la de texto, donde
   borrar es quitarlo del archivo de verdad, y la escaneada, donde borrar es
   taparlo con el papel de al lado. En la escaneada no basta con mirar el
   texto buscable: se mide la propia foto, que es lo que se ve. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUERTO = process.env.PUERTO || 8360;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
const pag = await ctx.newPage();
const errores = [];
pag.on('pageerror', (e) => errores.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !/Estimating resolution/.test(m.text())) errores.push(m.text().slice(0, 160)); });
let fallas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fallas++; };
const zoom = (v) => pag.evaluate((n) => {
  const z = document.getElementById('zoom');
  z.value = String(n); z.dispatchEvent(new Event('input', { bubbles: true }));
}, v);

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });

/* ==================== HOJA DE TEXTO ==================== */
console.log('--- hoja de texto ---');
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
await zoom(60);
await pag.waitForTimeout(600);
const cuantosAntes = await pag.locator('.renglon').count();

/* --- borrar: se deja vacío y Enter --- */
const BORRAR = 'Item 3';
const idxB = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes(v)), BORRAR);
ok('se encuentra el renglón que se va a borrar', idxB >= 0, idxB);
await pag.locator('.renglon').nth(idxB).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
ok('la ayuda dice cómo se borra',
   /vacío \+ Enter lo borra/.test(await pag.textContent('.campo-ayuda')),
   await pag.textContent('.campo-ayuda'));
await pag.fill('.campo', '');
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 30000 });
const avisoB = (await pag.textContent('#avisos')).trim().split('\n').pop();
ok('avisa de que lo borró', /Renglón borrado/.test(avisoB), avisoB);
ok('la lista de cambios lo marca como borrado',
   /\(borrado\)/.test(await pag.textContent('#cambios li')),
   (await pag.textContent('#cambios li')).replace(/\s+/g, ' ').slice(0, 90));
ok('queda un renglón menos en la hoja',
   await pag.locator('.renglon').count() === cuantosAntes - 1,
   { antes: cuantosAntes, ahora: await pag.locator('.renglon').count() });

/* --- insertar: se pulsa el sitio y se escribe --- */
const NUEVO = 'ANOTACION: VER ANEXO 2';
await pag.waitForTimeout(600);
await pag.click('#btnInsertar');
ok('el botón de insertar se queda encendido',
   await pag.evaluate(() => document.querySelector('#btnInsertar').classList.contains('activo')));
const punto = await pag.evaluate(() => {
  const caja = document.querySelector('#renglones').getBoundingClientRect();
  const esc = Number(document.getElementById('zoom').value) / 100;
  let abajo = 0, izq = 1e9;
  document.querySelectorAll('.renglon').forEach((n) => {
    const r = n.getBoundingClientRect();
    abajo = Math.max(abajo, r.bottom - caja.top);
    izq = Math.min(izq, r.left - caja.left);
  });
  return { x: caja.left + izq, y: caja.top + abajo + 28 * esc,
           hojaX: izq / esc, hojaY: (abajo + 28 * esc) / esc };
});
await pag.mouse.click(punto.x, punto.y);
await pag.waitForTimeout(400);
if (!(await pag.locator('.campo').count())) await pag.mouse.click(punto.x, punto.y);
await pag.waitForSelector('.campo', { timeout: 10000 });
const ayudaIns = await pag.textContent('.campo-ayuda');
console.log('  ayuda:', JSON.stringify(ayudaIns));
ok('dice con qué letra se escribirá antes de escribir', /Se escribirá en .+ de [\d.]+ pt/.test(ayudaIns), ayudaIns);
await pag.fill('.campo', NUEVO);
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 2, null, { timeout: 30000 });
const avisoI = (await pag.textContent('#avisos')).trim().split('\n').pop();
ok('avisa de que lo escribió', /Escrito/.test(avisoI), avisoI);
ok('el modo de insertar se apaga solo',
   !(await pag.evaluate(() => document.querySelector('#btnInsertar').classList.contains('activo'))));
ok('la lista lo marca como nuevo',
   /\(no había nada\)/.test(await pag.textContent('#cambios li:nth-child(2)')),
   (await pag.textContent('#cambios li:nth-child(2)')).replace(/\s+/g, ' ').slice(0, 90));

/* --- el archivo que sale --- */
const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida = fs.readFileSync(await (await bajada).path());
ok('sale entero', new TextDecoder().decode(salida.slice(0, 5)) === '%PDF-');

const lineasDe = (buf, hoja) => {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(buf), 'application/pdf');
  const j = JSON.parse(d.loadPage(hoja).toStructuredText('preserve-whitespace').asJSON());
  const out = [];
  for (const b of j.blocks || []) for (const l of b.lines || []) out.push(l);
  return out;
};
const original = fs.readFileSync(path.join(RAIZ, 'pruebas', 'postores.pdf'));
const antes = lineasDe(original, 0), despues = lineasDe(salida, 0);
ok('el renglón borrado ya no está en el archivo',
   !despues.some((l) => l.text.includes(BORRAR)), despues.filter((l) => l.text.includes(BORRAR)).map((l) => l.text));
const puesto = despues.find((l) => l.text.includes(NUEVO));
ok('el texto insertado está en el archivo', !!puesto, puesto && puesto.text);
if (puesto) {
  const vecino = antes.find((l) => l.text.includes('Item 4'));
  ok('lo insertado quedó donde se pulsó (±2 pt)',
     Math.abs(puesto.x - punto.hojaX) < 2 && Math.abs(puesto.y - punto.hojaY) < 2,
     { puesto: [puesto.x.toFixed(1), puesto.y.toFixed(1)], pedido: [punto.hojaX.toFixed(1), punto.hojaY.toFixed(1)] });
  ok('y con el mismo tamaño que sus vecinos',
     Math.abs(puesto.font.size - vecino.font.size) < 0.2,
     { insertado: puesto.font.size, vecino: vecino.font.size, tipo: puesto.font.name });
}
const perdidos = antes.map((l) => l.text)
  .filter((t) => !t.includes(BORRAR) && !despues.some((l) => l.text === t));
ok('no se llevó por delante ningún otro renglón', perdidos.length === 0, perdidos);

/* --- deshacer los dos --- */
await pag.keyboard.press('Control+z');
await pag.waitForTimeout(700);
await pag.keyboard.press('Control+z');
await pag.waitForTimeout(700);
const tras = await pag.evaluate(() => ({
  cambios: document.querySelectorAll('#cambios li').length,
  renglones: document.querySelectorAll('.renglon').length,
}));
ok('dos Ctrl+Z dejan la hoja como estaba',
   tras.cambios === 0 && tras.renglones === cuantosAntes, { tras, cuantosAntes });

/* ==================== HOJA ESCANEADA ==================== */
console.log('\n--- hoja escaneada (reconocer, borrar, insertar) ---');
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'escaneo.pdf'));
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 240000 });
await zoom(100);
await pag.waitForTimeout(800);

const VIEJO = 'COMERCIAL SAN JOSE';
const idxE = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes(v)), VIEJO);
ok('se encuentra el renglón en el escaneo', idxE >= 0, idxE);

// se guarda su hueco en píxeles del lienzo para volver a mirarlo después
const hueco = await pag.evaluate((i) => {
  const n = document.querySelectorAll('.renglon')[i];
  const c = document.querySelector('#lienzo');
  const cr = c.getBoundingClientRect(), nr = n.getBoundingClientRect();
  const fx = c.width / cr.width, fy = c.height / cr.height;
  return { x: Math.round((nr.left - cr.left) * fx), y: Math.round((nr.top - cr.top) * fy),
           w: Math.max(2, Math.round(nr.width * fx)), h: Math.max(2, Math.round(nr.height * fy)) };
}, idxE);
const luz = (caja) => pag.evaluate((r) => {
  const c = document.querySelector('#lienzo');
  const d = c.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return Math.round(s / (d.length / 4));
}, caja);
const luzAntes = await luz(hueco);

await pag.locator('.renglon').nth(idxE).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', '');
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 90000 });
await pag.waitForTimeout(900);
const luzDespues = await luz(hueco);
ok('en la foto ya no queda tinta donde estaba el renglón',
   luzDespues > luzAntes + 20 && luzDespues > 200, { antes: luzAntes, despues: luzDespues });

const bajada2 = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida2 = fs.readFileSync(await (await bajada2).path());
const doc2 = mupdf.PDFDocument.openDocument(new Uint8Array(salida2), 'application/pdf');
const texto2 = doc2.loadPage(0).toStructuredText('preserve-whitespace').asText();
ok('y tampoco queda en lo que se busca y se copia', !texto2.includes(VIEJO));

/* insertar sobre el escaneo */
const NUEVO2 = 'ANULADO';
// el mismo trozo de foto, antes y después: tiene que oscurecerse
const cajaIns = await pag.evaluate(() => {
  const c = document.querySelector('#lienzo');
  const cr = c.getBoundingClientRect();
  const fx = c.width / cr.width, fy = c.height / cr.height;
  const esc = Number(document.getElementById('zoom').value) / 100;
  return { x: Math.round(118 * esc * fx), y: Math.round(106 * esc * fy),
           w: Math.round(70 * esc * fx), h: Math.round(18 * esc * fy) };
});
const luzAntesIns = await luz(cajaIns);
await pag.click('#btnInsertar');
const punto2 = await pag.evaluate(() => {
  const caja = document.querySelector('#renglones').getBoundingClientRect();
  const esc = Number(document.getElementById('zoom').value) / 100;
  return { x: caja.left + 120 * esc, y: caja.top + 120 * esc, hojaX: 120, hojaY: 120 };
});
await pag.mouse.click(punto2.x, punto2.y);
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', NUEVO2);
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 2, null, { timeout: 90000 });
await pag.waitForTimeout(900);

const bajada3 = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida3 = fs.readFileSync(await (await bajada3).path());
const doc3 = mupdf.PDFDocument.openDocument(new Uint8Array(salida3), 'application/pdf');
const texto3 = doc3.loadPage(0).toStructuredText('preserve-whitespace').asText();
ok('lo insertado sobre el escaneo se puede buscar', texto3.includes(NUEVO2));

// y se VE: ese mismo trozo de foto ha oscurecido porque ahora lleva tinta
const luzDespuesIns = await luz(cajaIns);
ok('y se ve escrito sobre la foto', luzDespuesIns < luzAntesIns - 8,
   { antes: luzAntesIns, despues: luzDespuesIns });
await pag.screenshot({ path: path.join(RAIZ, 'pruebas', 'borrar-insertar.png') });

ok('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3));
console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo en verde');
await nav.close(); srv.kill();
process.exit(fallas ? 1 : 0);
