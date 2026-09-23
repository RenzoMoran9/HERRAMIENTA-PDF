/* Ajustar a mano la letra de lo que se corrige: tamaño, negrita y color.

   La medición acierta casi siempre, pero no siempre, y entonces hace falta
   poder decirle «más grande», «sin negrita» o «en azul». Se comprueba en lo
   que sale, no en la pantalla:

     · en una hoja de texto, el renglón sale del tamaño elegido, en negrita
       y del color elegido, y en su sitio;
     · en una hoja escaneada, igual: el renglón nuevo se dibuja en la foto
       con esa letra y ese color;
     · al escribir donde no había nada, también;
     · mientras se escribe, el campo ya se ve como va a quedar;
     · la lista de cambios lo dice, y Deshacer lo quita. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-ajustes-'));
const PUERTO = process.env.PUERTO || 8401;
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

const ORIGEN = path.join(RAIZ, 'pruebas', 'tachar.pdf');   // hoja de texto (16 pt) y la misma escaneada
const bajar = async (nombre) => {
  const bajada = pag.waitForEvent('download');
  await pag.click('#btnDescargar');
  const b = fs.readFileSync(await (await bajada).path());
  fs.writeFileSync(path.join(SALIDA, nombre), b);
  return mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
};
/** La letra con la que está escrito un texto: tamaño, tipografía, sitio. */
function letraDe(d, hoja, texto) {
  const j = JSON.parse(d.loadPage(hoja).toStructuredText('preserve-whitespace').asJSON());
  for (const b of j.blocks || []) for (const l of b.lines || []) {
    if (l.text && l.text.includes(texto)) return { tam: l.font.size, nombre: l.font.name, peso: l.font.weight, x: l.x, y: l.y, caja: l.bbox };
  }
  return null;
}
/** Qué color domina en la tinta de una zona de la hoja (lo que no es papel). */
function tintaEn(d, hoja, caja) {
  const K = 3;
  const px = d.loadPage(hoja).toPixmap(mupdf.Matrix.scale(K, K), mupdf.ColorSpace.DeviceRGB, false, true);
  const v = px.getPixels(), st = px.getStride(), n = px.getNumberOfComponents();
  let r = 0, g = 0, b = 0, c = 0;
  for (let y = Math.floor(caja.y * K); y < Math.ceil((caja.y + caja.h) * K); y++) {
    for (let x = Math.floor(caja.x * K); x < Math.ceil((caja.x + caja.w) * K); x++) {
      const i = y * st + x * n;
      if (v[i] + v[i + 1] + v[i + 2] > 450) continue;       // papel
      r += v[i]; g += v[i + 1]; b += v[i + 2]; c++;
    }
  }
  return c ? { r: Math.round(r / c), g: Math.round(g / c), b: Math.round(b / c), puntos: c } : null;
}
const k = async () => pag.$eval('#zoom', (z) => Number(z.value) / 100);
const indiceDe = (t) => pag.evaluate((t) => [...document.querySelectorAll('.renglon')].findIndex((r) => r.title.includes(t)), t);
const pulsar = async (sel, veces = 1) => { for (let i = 0; i < veces; i++) await pag.click('.campo-ajustes ' + sel); };

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('.renglon', { timeout: 20000 });
const escala = await k();
const antesDoc = mupdf.PDFDocument.openDocument(new Uint8Array(fs.readFileSync(ORIGEN)), 'application/pdf');
const cuenta0 = letraDe(antesDoc, 0, 'Cuenta');

console.log('--- hoja de texto: más grande, negrita y azul ---');
await pag.locator('.renglon').nth(await indiceDe('Cuenta')).click();
await pag.waitForSelector('.campo-ajustes');
ok('encima del campo sale la barrita, con el tamaño medido', (await pag.textContent('.campo-tam')) === '16,0 pt', await pag.textContent('.campo-tam'));
await pulsar('.campo-mas', 4);
await pulsar('.campo-negrita');
await pulsar('.campo-color[title="Azul"]');
const vista = await pag.$eval('.campo', (c) => { const e = getComputedStyle(c); return { tam: parseFloat(e.fontSize), peso: e.fontWeight, color: e.color }; });
ok('mientras se escribe, el campo ya se ve a 18 pt, en negrita y en azul',
   Math.abs(vista.tam - 18 * escala) < 0.3 && Number(vista.peso) >= 600 && /rgb\(15, 51, 158\)/.test(vista.color), vista);
ok('el campo sigue abierto tras usar la barrita', await pag.locator('.campo').count() === 1
   && await pag.evaluate(() => document.activeElement && document.activeElement.classList.contains('campo')));
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 30000 });
ok('la lista de cambios dice que se ajustó la letra', /letra ajustada/.test(await pag.textContent('#cambios')), await pag.textContent('#cambios'));
let d = await bajar('texto.pdf');
let l = letraDe(d, 0, 'Cuenta');
ok('en el PDF sale de 18 pt', l && Math.abs(l.tam - 18) < 0.2, l);
ok('en negrita', l && (/bold/i.test(l.nombre) || l.peso === 'bold'), l && [l.nombre, l.peso]);
ok('en su sitio: empieza donde empezaba', l && Math.abs(l.x - cuenta0.x) < 1 && Math.abs(l.y - cuenta0.y) < 1, { antes: [cuenta0.x, cuenta0.y], despues: l && [l.x, l.y] });
let t = l && tintaEn(d, 0, l.caja);
ok('y en azul', t && t.b > t.r + 60 && t.b > t.g + 40, t);
ok('el texto no cambió', d.loadPage(0).toStructuredText().asText().includes('Cuenta 191-2345678-0-12'));

console.log('\n--- quitarle la negrita a un renglón que la tenía ---');
await pag.locator('.renglon').nth(await indiceDe('Cuenta')).click();
await pag.waitForSelector('.campo-ajustes');
ok('la barrita ya la trae marcada', await pag.$eval('.campo-negrita', (b) => b.classList.contains('activo')));
await pag.keyboard.press('Control+b');
ok('Ctrl+B la quita', !(await pag.$eval('.campo-negrita', (b) => b.classList.contains('activo'))));
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 2, null, { timeout: 30000 });
d = await bajar('texto2.pdf');
l = letraDe(d, 0, 'Cuenta');
ok('y sale sin negrita, del mismo tamaño', l && !/bold/i.test(l.nombre) && l.peso !== 'bold' && Math.abs(l.tam - 18) < 0.2, l && [l.nombre, l.peso, l.tam]);

console.log('\n--- escribir donde no había nada, con la letra ajustada ---');
await pag.click('#btnInsertar');
const caja = await pag.locator('#renglones').boundingBox();
await pag.mouse.click(caja.x + 300 * escala, caja.y + 500 * escala);
await pag.waitForSelector('.campo-ajustes');
await pag.keyboard.type('Visto bueno');
await pulsar('.campo-mas', 8);
await pulsar('.campo-color[title="Rojo"]');
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 3, null, { timeout: 30000 });
d = await bajar('insertado.pdf');
l = letraDe(d, 0, 'Visto bueno');
ok('sale 4 pt más grande que la letra de al lado (20 pt)', l && Math.abs(l.tam - 20) < 0.2, l && l.tam);
t = l && tintaEn(d, 0, l.caja);
ok('y en rojo', t && t.r > t.g + 60 && t.r > t.b + 60, t);

console.log('\n--- hoja escaneada: más chico y en rojo ---');
await pag.click('#pagSiguiente');
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 180000 });
await pag.locator('.renglon').nth(await indiceDe('Monto')).click();
await pag.waitForSelector('.campo-ajustes');
const medido = parseFloat((await pag.textContent('.campo-tam')).replace(',', '.'));
await pulsar('.campo-menos');
const unClic = parseFloat((await pag.textContent('.campo-tam')).replace(',', '.'));
ok('cada clic en A− baja justo medio punto, también el primero', Math.abs(medido - unClic - 0.5) < 0.11, { medido, unClic });
await pulsar('.campo-mas');
ok('en el escaneo, la barrita trae el tamaño medido en la foto (unos 16 pt)', Math.abs(medido - 16) < 1.2, medido);
await pag.fill('.campo', 'Monto: S/ 2,500.00');
await pulsar('.campo-menos', 4);
await pulsar('.campo-color[title="Rojo"]');
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 4, null, { timeout: 60000 });
d = await bajar('escaneo.pdf');
const fila = JSON.parse(d.loadPage(1).getObject().get('GrapaOCR').asString()).renglones.find((r) => /2,500/.test(r.t));
ok('el renglón queda 2 pt más chico que lo medido', fila && Math.abs(fila.tam - (medido - 2)) < 0.1, fila && fila.tam);
ok('y en rojo', fila && fila.tinta[0] > 0.6 && fila.tinta[1] < 0.2, fila && fila.tinta);
t = fila && tintaEn(d, 1, { x: fila.x, y: fila.base - fila.tam * 0.75, w: 150, h: fila.tam * 0.75 });
ok('y en la foto se ve rojo', t && t.r > t.g + 50 && t.r > t.b + 50, t);

console.log('\n--- deshacer ---');
await pag.click('#btnDeshacer');
await pag.waitForTimeout(800);
d = await bajar('deshecho.pdf');
ok('Deshacer quita lo último', !/2,500/.test(d.loadPage(1).toStructuredText().asText()));

ok('sin errores en la página', fallos.length === 0, fallos);
await nav.close(); srv.kill();
console.log(malas ? `\n${malas} FALLA(S)` : '\nTodo en orden');
process.exit(malas ? 1 : 0);
