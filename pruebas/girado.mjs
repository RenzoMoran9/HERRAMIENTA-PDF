/* Hojas GIRADAS. Un escaneo llega girado con muchísima frecuencia, y hasta
   hoy el editor se plantaba: avisaba y no tocaba nada.

   Lo que se mide viene en el sistema de lo que se VE —desde arriba y hacia
   abajo—, y lo que se escribe va en el del papel, que no está girado. Si la
   cuenta que los une estuviera mal, el texto caería en otro sitio; y eso el
   propio editor lo comprueba y lo rechaza, así que aquí basta con que los
   cambios SALGAN y con mirar dónde han caído. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
spawnSync('/opt/node22/bin/node', [path.join(RAIZ, 'pruebas', 'hacer-girado.mjs')], { encoding: 'utf8' });
const PUERTO = process.env.PUERTO || 8380;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
const pag = await ctx.newPage();
pag.on('dialog', (d) => d.accept());
const errores = [];
pag.on('pageerror', (e) => errores.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !/Estimating resolution/.test(m.text())) errores.push(m.text().slice(0, 160)); });
let fallas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fallas++; };

const lineas = (buf, hoja) => {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(buf), 'application/pdf');
  const j = JSON.parse(d.loadPage(hoja).toStructuredText('preserve-whitespace').asJSON());
  const out = [];
  for (const b of j.blocks || []) for (const l of b.lines || []) out.push(l);
  return out;
};

const GIRADO = path.join(RAIZ, 'pruebas', 'girado.pdf');
const original = fs.readFileSync(GIRADO);

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });
await pag.evaluate(() => { document.querySelector('#guardarAqui').click(); });   // sin guardar nada
await pag.setInputFiles('#archivo', GIRADO);
await pag.waitForSelector('.renglon', { timeout: 20000 });
await pag.evaluate(() => {
  const z = document.getElementById('zoom');
  z.value = '60'; z.dispatchEvent(new Event('input', { bubbles: true }));
});
await pag.waitForTimeout(500);

ok('dice que la hoja está girada',
   /hoja girada 270°/.test(await pag.textContent('#docDetalle')),
   await pag.textContent('#docDetalle'));

// La hoja girada se VE igual que la de partida —ese es el truco del
// fixture— así que lo que mide el editor tiene que coincidir con lo de
// aquella. Si no, es que el giro se está colando donde no debe.
const recto = lineas(fs.readFileSync(path.join(RAIZ, 'pruebas', 'postores.pdf')), 0);
const torcido = lineas(original, 0);
const iguales = recto.every((l, i) => torcido[i] && torcido[i].text === l.text
  && Math.abs(torcido[i].x - l.x) < 0.5 && Math.abs(torcido[i].y - l.y) < 0.5);
ok('por dentro está girada, pero se ve exactamente igual que la derecha', iguales);

/* ---------- corregir un renglón en cada giro ---------- */
const GIROS = [[0, 270], [1, 180], [2, 90]];
const cambiados = [];
for (const [hoja, grados] of GIROS) {
  if (hoja > 0) {
    await pag.click('#pagSiguiente');
    await pag.waitForTimeout(900);
  }
  const antes = lineas(original, hoja);
  const viejo = 'EXP. 10488 - ADQUISICION DE INSUMOS';
  const nuevo = 'EXP. 99001 - ADQUISICION DE INSUMOS';
  const idx = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
    .findIndex((n) => (n.title || '') === v), viejo);
  ok(`hoja ${hoja + 1} (${grados}°): se encuentra el renglón`, idx >= 0, idx);
  if (idx < 0) continue;
  await pag.locator('.renglon').nth(idx).click();
  await pag.waitForSelector('.campo', { timeout: 5000 });
  await pag.fill('.campo', nuevo);
  await pag.press('.campo', 'Enter');
  await pag.waitForFunction((n) => document.querySelectorAll('#cambios li').length === n,
                            cambiados.length + 1, { timeout: 40000 });
  const aviso = (await pag.textContent('#avisos')).trim().split('\n').pop();
  ok(`hoja ${hoja + 1} (${grados}°): lo cambia en vez de negarse`, !/girada|No se pudo/.test(aviso), aviso);
  cambiados.push({ hoja, grados, viejo, nuevo, ref: antes.find((l) => l.text === viejo) });
}

/* ---------- insertar en una hoja girada ---------- */
await pag.click('#pagAnterior');
await pag.click('#pagAnterior');
await pag.waitForTimeout(900);
const INSERTADO = 'ESCRITO EN HOJA GIRADA';
await pag.click('#btnInsertar');
const punto = await pag.evaluate(() => {
  const caja = document.querySelector('#renglones').getBoundingClientRect();
  const esc = Number(document.getElementById('zoom').value) / 100;
  let abajo = 0, izq = 1e9;
  document.querySelectorAll('.renglon').forEach((n) => {
    const r = n.getBoundingClientRect();
    abajo = Math.max(abajo, r.bottom - caja.top);
    izq = Math.min(izq, r.left - caja.left);
  });
  return { x: caja.left + izq, y: caja.top + abajo + 26 * esc,
           hojaX: izq / esc, hojaY: (abajo + 26 * esc) / esc };
});
await pag.mouse.click(punto.x, punto.y);
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', INSERTADO);
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 4, null, { timeout: 40000 });

/* ---------- mirar dónde cayó todo ---------- */
const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida = fs.readFileSync(await (await bajada).path());
ok('sale entero', new TextDecoder().decode(salida.slice(0, 5)) === '%PDF-');

for (const c of cambiados) {
  const despues = lineas(salida, c.hoja);
  const puesto = despues.find((l) => l.text === c.nuevo);
  ok(`hoja ${c.hoja + 1} (${c.grados}°): el texto nuevo está`, !!puesto);
  if (puesto && c.ref) {
    ok(`hoja ${c.hoja + 1} (${c.grados}°): cayó donde estaba el viejo (±1,5 pt)`,
       Math.abs(puesto.x - c.ref.x) < 1.5 && Math.abs(puesto.y - c.ref.y) < 1.5,
       { nuevo: [puesto.x.toFixed(1), puesto.y.toFixed(1)], viejo: [c.ref.x.toFixed(1), c.ref.y.toFixed(1)] });
  }
  ok(`hoja ${c.hoja + 1} (${c.grados}°): el viejo ya no está`, !despues.some((l) => l.text === c.viejo));
  const antes = lineas(original, c.hoja);
  const perdidos = antes.map((l) => l.text).filter((t) => t !== c.viejo && !despues.some((l) => l.text === t));
  ok(`hoja ${c.hoja + 1} (${c.grados}°): no se perdió nada de al lado`, perdidos.length === 0, perdidos);
}

const ins = lineas(salida, 0).find((l) => l.text === INSERTADO);
ok('lo insertado en la hoja girada está', !!ins);
if (ins) {
  ok('y cayó donde se pulsó (±2 pt)',
     Math.abs(ins.x - punto.hojaX) < 2 && Math.abs(ins.y - punto.hojaY) < 2,
     { puesto: [ins.x.toFixed(1), ins.y.toFixed(1)], pedido: [punto.hojaX.toFixed(1), punto.hojaY.toFixed(1)] });
}

/* ---------- y un ESCANEO girado, que es el caso de verdad ---------- */
console.log('\n--- escaneo girado: reconocer y corregir ---');
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'escaneo-girado.pdf'));
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 240000 });
await pag.evaluate(() => {
  const z = document.getElementById('zoom');
  z.value = '100'; z.dispatchEvent(new Event('input', { bubbles: true }));
});
await pag.waitForTimeout(900);

const VIEJO = 'COMERCIAL SAN JOSE';
const idxE = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes(v)), VIEJO);
ok('en el escaneo girado se reconoce el texto', idxE >= 0, idxE);
const hueco = await pag.evaluate((i) => {
  const n = document.querySelectorAll('.renglon')[i];
  const c = document.querySelector('#lienzo');
  const cr = c.getBoundingClientRect(), nr = n.getBoundingClientRect();
  const fx = c.width / cr.width, fy = c.height / cr.height;
  return { x: Math.round((nr.left - cr.left) * fx), y: Math.round((nr.top - cr.top) * fy),
           w: Math.max(2, Math.round(nr.width * fx)), h: Math.max(2, Math.round(nr.height * fy)) };
}, idxE);
const luz = (r) => pag.evaluate((q) => {
  const c = document.querySelector('#lienzo');
  const d = c.getContext('2d').getImageData(q.x, q.y, q.w, q.h).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return Math.round(s / (d.length / 4));
}, r);
const luzAntes = await luz(hueco);

const NUEVO = 'DISTRIBUIDORA ANDINA SRL';
await pag.locator('.renglon').nth(idxE).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', NUEVO);
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 120000 });
await pag.waitForTimeout(1000);
const avisoE = (await pag.textContent('#avisos')).trim().split('\n').pop();
ok('corrige sobre el escaneo girado', /sobre la foto/.test(avisoE), avisoE);
const luzDespues = await luz(hueco);
ok('el parche de papel cayó justo encima del renglón viejo',
   Math.abs(luzDespues - luzAntes) > 8, { antes: luzAntes, despues: luzDespues });

const bajada2 = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida2 = fs.readFileSync(await (await bajada2).path());
const t2 = mupdf.PDFDocument.openDocument(new Uint8Array(salida2), 'application/pdf')
  .loadPage(0).toStructuredText('preserve-whitespace').asText();
ok('y el texto buscable cambió con ella', t2.includes(NUEVO) && !t2.includes(VIEJO),
   { nuevo: t2.includes(NUEVO), viejo: t2.includes(VIEJO) });
await pag.screenshot({ path: path.join(RAIZ, 'pruebas', 'girado.png') });

ok('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3));
console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo en verde');
await nav.close(); srv.kill();
process.exit(fallas ? 1 : 0);
