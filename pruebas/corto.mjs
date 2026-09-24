/* Corregir renglones cortos en negrita de un escaneo (corto.pdf).

   Salió con una constancia de verdad: al corregir «Fecha:25/03/2021» la
   letra salía más chica y sin negrita, y debajo asomaban los restos de los
   números viejos. La parte de abajo de un renglón corto en negrita llena
   casi todo su ancho y se tomaba por la raya de un cuadro. Y «DEPENDENCIA
   SUNAT» → «DEPENDENCIA SUNAT LIMA» se rechazaba: como el texto nuevo
   contiene el viejo, la comprobación creía que el viejo seguía ahí.

   Se comprueba:
     · que el tamaño y la negrita que se miden son los del renglón;
     · que tras corregir no queda tinta vieja debajo de lo nuevo;
     · que se puede añadir algo al final de un renglón;
     · que las rayas del cuadro de abajo siguen siendo rayas al corregir
       una celda. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-corto-'));
const PUERTO = process.env.PUERTO || 8402;
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

const ORIGEN = path.join(RAIZ, 'pruebas', 'corto.pdf');
const indiceDe = (t) => pag.evaluate((t) => [...document.querySelectorAll('.renglon')].findIndex((r) => r.title.includes(t)), t);
const bajar = async (nombre) => {
  const bajada = pag.waitForEvent('download');
  await pag.click('#btnDescargar');
  const b = fs.readFileSync(await (await bajada).path());
  fs.writeFileSync(path.join(SALIDA, nombre), b);
  return mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
};
const modelo = (d) => JSON.parse(d.loadPage(0).getObject().get('GrapaOCR').asString());
const K = 4;
/** Cuántos puntos oscuros hay en una franja de la hoja (en puntos). */
function tintaEnFranja(d, x0, x1, y0, y1) {
  const px = d.loadPage(0).toPixmap(mupdf.Matrix.scale(K, K), mupdf.ColorSpace.DeviceGray, false, true);
  const v = px.getPixels(), st = px.getStride();
  let n = 0;
  for (let y = Math.floor(y0 * K); y < Math.ceil(y1 * K); y++) for (let x = Math.floor(x0 * K); x < Math.ceil(x1 * K); x++) if (v[y * st + x] < 110) n++;
  return n;
}
let hechos = 0;
async function corregir(busca, nuevo) {
  await pag.locator('.renglon').nth(await indiceDe(busca)).click();
  await pag.waitForSelector('.campo');
  const tam = parseFloat((await pag.textContent('.campo-tam')).replace(',', '.'));
  const negrita = await pag.$eval('.campo-negrita', (b) => b.classList.contains('activo'));
  await pag.fill('.campo', nuevo);
  await pag.press('.campo', 'Enter');
  await pag.waitForFunction(() => document.querySelector('#capaCarga').hidden, null, { timeout: 30000 });
  await pag.waitForTimeout(300);
  const n = await pag.locator('#cambios li').count();
  const bien = n > hechos;
  hechos = n;
  return { tam, negrita, bien, aviso: (await pag.textContent('#avisos')).slice(-90) };
}

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 180000 });
const d0 = await bajar('leido.pdf');
const fila0 = modelo(d0).renglones.find((r) => /Fecha/.test(r.t));

console.log('--- «Fecha:25/03/2021», corto y en negrita ---');
let r = await corregir('Fecha', 'Fecha:26/03/2021');
ok('la letra se mide de su tamaño (7,5 pt), no más chica', Math.abs(r.tam - 7.5) < 0.7, r.tam);
ok('y se ve que es negrita', r.negrita);
ok('el cambio se hace', r.bien, r.aviso);
let d = await bajar('fecha.pdf');
const fila = modelo(d).renglones.find((r2) => /26\/03/.test(r2.t));
// por debajo de la línea base del renglón nuevo no puede quedar tinta: lo
// que hubiera ahí son los pies de los números viejos (ni «Fecha» ni las
// cifras bajan de la línea)
const resto = fila ? tintaEnFranja(d, fila0.x0, fila0.x1, fila.base + 0.5, fila0.y1 + 0.8) : -1;
ok('debajo de lo nuevo no asoma nada de lo viejo', resto >= 0 && resto <= 6, { puntosOscuros: resto });

console.log('\n--- añadir al final de un renglón ---');
r = await corregir('DEPENDENCIA', 'DEPENDENCIA DE EJEMPLO LIMA');
ok('«DEPENDENCIA DE EJEMPLO» → «… LIMA» se hace (el texto nuevo contiene el viejo)', r.bien, r.aviso);
d = await bajar('anadido.pdf');
ok('y en el PDF está el renglón nuevo', /DEPENDENCIA DE EJEMPLO LIMA/.test(d.loadPage(0).toStructuredText().asText()));
// a la derecha no hay nada: el renglón más largo no se aprieta, se alarga
const larga = modelo(d).renglones.find((x) => /LIMA/.test(x.t));
const tinta = larga && (() => {
  // dónde acaba la tinta del renglón nuevo, en la foto
  const px = d.loadPage(0).toPixmap(mupdf.Matrix.scale(K, K), mupdf.ColorSpace.DeviceGray, false, true);
  const v = px.getPixels(), st = px.getStride();
  let fin = 0;
  for (let y = Math.floor((larga.base - larga.tam * 0.7) * K); y < Math.ceil(larga.base * K); y++) {
    for (let x = Math.floor(larga.x0 * K); x < Math.floor(Math.min(560, larga.x0 + 300) * K); x++) if (v[y * st + x] < 110 && x > fin) fin = x;
  }
  return fin / K - larga.x;
})();
ok('a la derecha hay papel libre: el renglón más largo no se aprieta', larga && tinta > (larga.x1 - larga.x0) * 1.12,
   { anchoViejo: larga && +(larga.x1 - larga.x0).toFixed(1), anchoNuevo: tinta && +tinta.toFixed(1) });

console.log('\n--- «Importante», una sola palabra en negrita ---');
await pag.locator('.renglon').nth(await indiceDe('Importante')).click();
await pag.waitForSelector('.campo');
const tImp = parseFloat((await pag.textContent('.campo-tam')).replace(',', '.'));
ok('se mide de su tamaño (8 pt)', Math.abs(tImp - 8) < 0.8, tImp);
await pag.keyboard.press('Escape');

console.log('\n--- en el cuadro, las rayas siguen siendo rayas ---');
const rayaAntes = tintaEnFranja(d, 172, 298, 219.2, 220.8);
r = await corregir('DEPOSITO', 'ALMACEN');
ok('la celda se corrige', r.bien, r.aviso);
d = await bajar('cuadro.pdf');
const rayaDespues = tintaEnFranja(d, 172, 298, 219.2, 220.8);
ok('y la raya de arriba de la celda sigue entera', rayaDespues >= rayaAntes * 0.9, { antes: rayaAntes, despues: rayaDespues });

// una celda con la raya a la derecha: el texto más largo NO puede pasarla
const bordeAntes = tintaEnFranja(d, 419.2, 420.8, 237, 247);
r = await corregir('PROPIO', 'PROPIO COMPARTIDO SEGUN CONTRATO');
ok('en una celda, un texto más largo también se pone', r.bien, r.aviso);
d = await bajar('celda.pdf');
const bordeDespues = tintaEnFranja(d, 419.2, 420.8, 237, 247);
const pasado = tintaEnFranja(d, 422, 470, 238, 247);
ok('pero no tapa la raya de la derecha de la celda', bordeDespues >= bordeAntes * 0.9, { antes: bordeAntes, despues: bordeDespues });
ok('ni se sale de la celda (se aprieta dentro)', pasado <= 4, { tintaFuera: pasado });

ok('sin errores en la página', fallos.length === 0, fallos);
await nav.close(); srv.kill();
console.log(malas ? `\n${malas} FALLA(S)` : '\nTodo en orden');
process.exit(malas ? 1 : 0);
