/* Corregir un precio dentro de un CUADRO, que es como vienen las
   cotizaciones de verdad.

   Aquí se rompía: el recuadro que da el reconocimiento a una celda se lleva
   por delante la raya de abajo y las cabezas del renglón siguiente. Midiendo
   «de lo más alto a lo más bajo», un renglón de seis puntos se medía de
   dieciséis y el corregido salía al doble de tamaño; y el parche, al
   estirarse hasta encontrar papel limpio, se tragaba el borde de la celda.

   Se comprueba sobre la propia foto: tamaño, sitio y que los bordes sigan
   estando. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
if (!fs.existsSync(path.join(RAIZ, 'pruebas', 'cuadro.pdf'))) {
  spawnSync('/opt/node22/bin/node', [path.join(RAIZ, 'pruebas', 'hacer-cuadro.mjs')], { encoding: 'utf8' });
}
const PUERTO = process.env.PUERTO || 8740;
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

const ARCH = path.join(RAIZ, 'pruebas', 'cuadro.pdf');
await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });
await pag.evaluate(() => document.querySelector('#guardarAqui').click());
await pag.setInputFiles('#archivo', ARCH);
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 30000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 300000 });

/* ---------- 1. cada celda, su renglón ---------- */
const lista = await pag.evaluate(() => [...document.querySelectorAll('.renglon')].map((n) => n.title));
console.log('  celdas leídas:', JSON.stringify(lista.filter((t) => /27|21,600|800|POLLO|TOTAL/.test(t))));
const iPrecio = lista.findIndex((t) => /27[.,]00/.test(t) && !/21|600/.test(t));
ok('el precio de la celda se lee como un renglón suyo, no pegado al importe', iPrecio >= 0,
   lista[iPrecio]);
ok('el nombre del producto no sale partido en pedazos',
   lista.some((t) => /FILETE.*ENTERO.*POLLO/i.test(t)),
   lista.filter((t) => /FILETE|ENTERO|POLLO/i.test(t)));

/* ---------- 2. cuántas rayas del cuadro hay ANTES ----------
   Lo que se quiere comprobar es que el parche no se coma ninguna: se
   cuentan las columnas con una tirada larga de negro, que es lo que es el
   borde de una celda, y después tienen que seguir siendo las mismas. */
const contarRayas = () => pag.evaluate(() => {
  const c = document.querySelector('#lienzo');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let cuantas = 0;
  for (let x = 0; x < c.width; x++) {
    let racha = 0, mejor = 0;
    for (let y = 0; y < c.height; y++) {
      const j = (y * c.width + x) * 4;
      if ((d[j] + d[j + 1] + d[j + 2]) / 3 < 140) { racha++; if (racha > mejor) mejor = racha; }
      else racha = 0;
    }
    if (mejor > 45) cuantas++;   // tiradas largas: bordes de celda, no palos de letra
  }
  return cuantas;
});
const rayasAntes = await contarRayas();
ok('el cuadro tiene sus rayas', rayasAntes >= 3, rayasAntes);

/* ---------- 3. corregirlo ---------- */
await pag.locator('.renglon').nth(iPrecio).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', 'S/ 24.50');
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 120000 });
await pag.waitForTimeout(900);
const aviso = (await pag.textContent('#avisos')).trim().split('\n').pop();
ok('se corrige sobre la foto', /sobre la foto/.test(aviso), aviso);

const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida = fs.readFileSync(await (await bajada).path());
const doc = mupdf.PDFDocument.openDocument(new Uint8Array(salida), 'application/pdf');
const modelo = JSON.parse(doc.loadPage(0).getObject().get('GrapaOCR').asString());
const fila = modelo.renglones.find((r) => r.editado);
ok('el texto nuevo está en el modelo', !!fila && fila.t === 'S/ 24.50', fila && fila.t);

/* El tamaño medido tiene que parecerse al del documento de verdad: la
   cotización se imprimió a 12 px de CSS, que son 9 puntos. */
ok('el tamaño medido es el de la letra, no el del recuadro',
   !!(fila && fila.tam > 6 && fila.tam < 13), fila && +fila.tam.toFixed(2));

/* ---------- 4. y los bordes de la celda siguen ahí ---------- */
const rayasDespues = await contarRayas();
ok('el parche no se ha comido ninguna raya del cuadro',
   rayasDespues >= rayasAntes - 1, { antes: rayasAntes, despues: rayasDespues });

const texto = doc.loadPage(0).toStructuredText('preserve-whitespace').asText();
ok('lo que se busca dice el precio nuevo', texto.includes('S/ 24.50'));
ok('y el importe de al lado no se tocó', /21,600\.00|21.600,00|21,600/.test(texto), texto.split('\n').filter((l) => /21/.test(l)));
await pag.screenshot({ path: path.join(RAIZ, 'pruebas', 'cuadro.png') });

ok('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3));
console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo en verde');
await nav.close(); srv.kill();
process.exit(fallas ? 1 : 0);
