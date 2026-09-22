/* Corregir sobre la propia hoja, y mover lo corregido.

   Lo que se comprueba es lo que se ve al corregir y lo que sale:

     · el campo va encima del renglón, con su letra, su tamaño y el papel
       del documento —también con el tema oscuro, que antes pintaba una
       caja oscura—, no una caja aparte;
     · se puede mover con el asa o con Alt + flechas, y en el PDF que sale
       el renglón queda donde se dejó, y ya no donde estaba;
     · en una hoja escaneada, el renglón corregido sale del TAMAÑO del
       original y sin negrita si no la llevaba: antes salía una cuarta parte
       más chico y en negrita;
     · lo movido en un escaneo va donde se dejó y lo viejo sigue tapado.  */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-natural-'));
const PUERTO = process.env.PUERTO || 8396;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
// con el tema OSCURO: era ahí donde el campo salía como una caja negra
const ctx = await nav.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 }, colorScheme: 'dark' });
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !/Estimating resolution/.test(m.text())) fallos.push(m.text().slice(0, 160)); });
let malas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) malas++; };

const ORIGEN = path.join(RAIZ, 'pruebas', 'tachar.pdf');   // hoja de texto y la misma escaneada, 16 pt
const bajar = async (nombre) => {
  const bajada = pag.waitForEvent('download');
  await pag.click('#btnDescargar');
  const b = fs.readFileSync(await (await bajada).path());
  fs.writeFileSync(path.join(SALIDA, nombre), b);
  return mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
};
/** Dónde empieza un texto en la hoja (x, y de su línea base), en puntos. */
function dondeEsta(d, hoja, texto) {
  let hallado = null;
  d.loadPage(hoja).toStructuredText('preserve-whitespace').walk({
    beginLine() { this.l = { t: '', x: null, y: null }; },
    onChar(c, origin) { if (!this.l) this.l = { t: '' }; if (this.l.x == null) { this.l.x = origin[0]; this.l.y = origin[1]; } this.l.t += c; },
    endLine() { if (this.l && this.l.t.includes(texto) && !hallado) hallado = { x: this.l.x, y: this.l.y }; this.l = null; },
  });
  return hallado;
}
const escala = async () => pag.$eval('#zoom', (z) => Number(z.value) / 100);
const indiceDe = (texto) => pag.evaluate((t) => [...document.querySelectorAll('.renglon')].findIndex((r) => r.title.includes(t)), texto);

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('.renglon', { timeout: 20000 });
const k = await escala();

console.log('\n--- el campo, sobre la hoja y con la letra del documento ---');
let i = await indiceDe('Otra linea');
await pag.locator('.renglon').nth(i).click();
await pag.waitForSelector('.campo');
const campo = await pag.$eval('.campo', (c) => {
  const e = getComputedStyle(c);
  return { fondo: e.backgroundColor, color: e.color, tam: parseFloat(e.fontSize), familia: e.fontFamily,
           borde: e.borderTopWidth, caja: c.getBoundingClientRect().toJSON() };
});
const renglon = await pag.locator('.renglon').nth(i).boundingBox();
const canales = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
ok('el fondo del campo es el papel, no una caja oscura', canales(campo.fondo).every((v) => v > 235), campo.fondo);
ok('la letra es del color del texto', canales(campo.color).every((v) => v < 60), campo.color);
ok('del mismo tamaño que el renglón (16 pt)', Math.abs(campo.tam - 16 * k) < 0.5, campo.tam);
ok('con la misma familia de letra', /Helvetica|Arial/.test(campo.familia), campo.familia);
ok('encima del renglón, no al lado', Math.abs(campo.caja.x - renglon.x) < 4 && campo.caja.y < renglon.y + renglon.height
   && campo.caja.y + campo.caja.height > renglon.y, { campo: campo.caja, renglon });
ok('el campo tapa el renglón viejo entero', campo.caja.width >= renglon.width - 1);
ok('lleva el asa para moverlo', await pag.locator('.campo-asa').count() === 1);

console.log('\n--- mover un renglón con el asa, sin cambiar el texto ---');
const antesDoc = mupdf.PDFDocument.openDocument(new Uint8Array(fs.readFileSync(ORIGEN)), 'application/pdf');
const p0 = dondeEsta(antesDoc, 0, 'Otra linea');
const asa = await pag.locator('.campo-asa').boundingBox();
await pag.mouse.move(asa.x + asa.width / 2, asa.y + asa.height / 2);
await pag.mouse.down();
await pag.mouse.move(asa.x + asa.width / 2 + 40 * k, asa.y + asa.height / 2 + 30 * k, { steps: 6 });
await pag.mouse.up();
ok('mientras se arrastra, el campo sigue abierto', await pag.locator('.campo').count() === 1);
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 30000 });
ok('la lista dice que se movió', /movido/.test(await pag.textContent('#cambios')), await pag.textContent('#cambios'));
let d = await bajar('movido.pdf');
let p1 = dondeEsta(d, 0, 'Otra linea');
ok('en el PDF, el renglón está 40 pt a la derecha y 30 más abajo',
   p1 && Math.abs(p1.x - p0.x - 40) < 1.5 && Math.abs(p1.y - p0.y - 30) < 1.5, { antes: p0, despues: p1 });
ok('y una sola vez: donde estaba ya no hay nada',
   d.loadPage(0).toStructuredText().asText().split('Otra linea').length === 2);

console.log('\n--- corregir y correr de a medio punto con Alt + flechas ---');
i = await indiceDe('Cuenta');
await pag.locator('.renglon').nth(i).click();
await pag.waitForSelector('.campo');
await pag.fill('.campo', 'Cuenta 191-0000000-0-99');
for (let n = 0; n < 4; n++) await pag.keyboard.press('Alt+ArrowUp');
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 2, null, { timeout: 30000 });
d = await bajar('corregido.pdf');
const c0 = dondeEsta(antesDoc, 0, 'Cuenta'), c1 = dondeEsta(d, 0, 'Cuenta 191-0000000');
ok('el texto nuevo, dos puntos más arriba', c1 && Math.abs(c1.y - (c0.y - 2)) < 0.8 && Math.abs(c1.x - c0.x) < 0.8, { antes: c0, despues: c1 });

console.log('\n--- en la hoja escaneada ---');
await pag.click('#pagSiguiente');
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 180000 });
i = await indiceDe('Monto');
await pag.locator('.renglon').nth(i).click();
await pag.waitForSelector('.campo');
const tamEscaneo = await pag.$eval('.campo', (c) => parseFloat(getComputedStyle(c).fontSize));
ok('también en el escaneo, el campo con el papel de la foto',
   canales(await pag.$eval('.campo', (c) => getComputedStyle(c).backgroundColor)).every((v) => v > 230));
await pag.fill('.campo', 'Monto: S/ 2,500.00');
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 3, null, { timeout: 60000 });
d = await bajar('escaneo.pdf');
const modelo = JSON.parse(d.loadPage(1).getObject().get('GrapaOCR').asString());
const fila = modelo.renglones.find((r) => /2,500/.test(r.t));
ok('el renglón corregido sale del tamaño del original (16 pt), no una cuarta parte más chico',
   fila && Math.abs(fila.tam - 16) < 1.2, fila && fila.tam);
ok('y sin negrita, que el original no llevaba', fila && !fila.negrita, fila && fila.negrita);
const m0 = dondeEsta(antesDoc, 0, 'Monto');
ok('en su línea base', fila && Math.abs(fila.base - m0.y) < 1.2, { base: fila && fila.base, original: m0.y });
console.log('   (el campo mientras se escribía: ' + (tamEscaneo / k).toFixed(1) + ' pt)');

// y moverlo después: se vuelve a pulsar y se arrastra
i = await indiceDe('2,500');
await pag.locator('.renglon').nth(i).click();
await pag.waitForSelector('.campo');
for (let n = 0; n < 10; n++) await pag.keyboard.press('Shift+Alt+ArrowRight');
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 4, null, { timeout: 60000 });
d = await bajar('escaneo-movido.pdf');
const fila2 = JSON.parse(d.loadPage(1).getObject().get('GrapaOCR').asString()).renglones.find((r) => /2,500/.test(r.t));
ok('lo corregido se mueve 20 pt a la derecha', fila2 && Math.abs(fila2.x - fila.x - 20) < 0.6, { antes: fila.x, despues: fila2 && fila2.x });
ok('y el sitio viejo sigue tapado: el parche no se mueve', fila2 && JSON.stringify(fila2.parcheCaja) === JSON.stringify(fila.parcheCaja));

console.log('\n--- insertar usa el mismo campo ---');
await pag.click('#pagAnterior');
await pag.click('#btnInsertar');
const caja = await pag.locator('#renglones').boundingBox();
await pag.mouse.click(caja.x + 300 * k, caja.y + 450 * k);
await pag.waitForSelector('.campo');
const ins = await pag.$eval('.campo', (c) => ({ tam: parseFloat(getComputedStyle(c).fontSize), asa: !!document.querySelector('.campo-asa') }));
ok('con la letra del renglón más cercano y su asa', Math.abs(ins.tam - 16 * k) < 0.6 && ins.asa, ins);
await pag.keyboard.type('Visto bueno');
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 5, null, { timeout: 30000 });
d = await bajar('insertado.pdf');
const v = dondeEsta(d, 0, 'Visto bueno');
ok('y queda donde se pulsó', v && Math.abs(v.x - 300) < 1.5 && Math.abs(v.y - 450) < 1.5, v);

ok('sin errores en la página', fallos.length === 0, fallos);
await pag.screenshot({ path: path.join(SALIDA, 'final.png') });
await nav.close(); srv.kill();
console.log(malas ? `\n${malas} FALLA(S)` : '\nTodo en orden');
process.exit(malas ? 1 : 0);
