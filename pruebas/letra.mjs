/* En un escaneo, lo corregido se escribe con una letra parecida a la del
   documento (corto.pdf).

   Salió con una constancia de verdad, escrita en Tahoma negrita: lo
   corregido salía siempre en Helvetica, más fina y más estrecha, y se
   notaba a simple vista. Ahora el editor adivina la letra por lo grueso y
   lo ancho del trazo, la enseña en la barrita del campo y se puede cambiar
   con un clic. Se comprueba:
     · que en un renglón en negrita gruesa propone Tahoma o Verdana;
     · que lo corregido queda con tanta tinta como tenía (no más fino);
     · que el botón cambia la letra y la hoja guarda la elegida;
     · que al añadir un renglón nuevo en el escaneo se usa la de al lado;
     · que en una hoja con texto de verdad el botón no aparece. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-letra-'));
const PUERTO = process.env.PUERTO || 8404;
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
/** Puntos oscuros dentro de una caja de la hoja (en puntos). */
function tinta(d, [x0, y0, x1, y1]) {
  const px = d.loadPage(0).toPixmap(mupdf.Matrix.scale(K, K), mupdf.ColorSpace.DeviceGray, false, true);
  const v = px.getPixels(), st = px.getStride();
  let n = 0;
  for (let y = Math.floor(y0 * K); y < Math.ceil(y1 * K); y++) for (let x = Math.floor(x0 * K); x < Math.ceil(x1 * K); x++) if (v[y * st + x] < 110) n++;
  return n;
}
const letraDelCampo = () => pag.$eval('.campo-letra', (b) => b.textContent).catch(() => null);
let hechos = 0;
async function corregir(busca, nuevo, clicsLetra = 0) {
  await pag.locator('.renglon').nth(await indiceDe(busca)).click();
  await pag.waitForSelector('.campo');
  const propuesta = await letraDelCampo();
  for (let i = 0; i < clicsLetra; i++) await pag.click('.campo-letra');
  const elegida = await letraDelCampo();
  await pag.fill('.campo', nuevo);
  await pag.press('.campo', 'Enter');
  await pag.waitForFunction(() => document.querySelector('#capaCarga').hidden, null, { timeout: 30000 });
  await pag.waitForTimeout(300);
  const n = await pag.locator('#cambios li').count();
  const bien = n > hechos;
  hechos = n;
  return { propuesta, elegida, bien };
}

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'corto.pdf'));
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 180000 });
const d0 = await bajar('leido.pdf');
const f0 = modelo(d0).renglones.find((r) => /Fecha/.test(r.t));
const cajaFecha = [f0.x0 - 1, f0.y0 - 1, f0.x1 + 25, f0.y1 + 1];
const tintaAntes = tinta(d0, cajaFecha);

console.log('--- la letra que propone ---');
let r = await corregir('Fecha', 'Fecha:26/03/2021');
ok('en «Fecha:…», negrita gruesa, propone Tahoma o Verdana (no Arial)', /Tahoma|Verdana/.test(r.propuesta || ''), r.propuesta);
ok('el cambio se hace', r.bien);
let d = await bajar('fecha.pdf');
const f1 = modelo(d).renglones.find((x) => /26\/03/.test(x.t));
ok('la hoja guarda con qué letra se escribió', f1 && /tahoma|verdana/.test(f1.familia), f1 && f1.familia);
const tintaAuto = tinta(d, cajaFecha);
ok('lo corregido tiene casi tanta tinta como tenía (no sale más fino)', tintaAuto > tintaAntes * 0.92 && tintaAuto < tintaAntes * 1.25,
   { antes: tintaAntes, despues: tintaAuto });

console.log('\n--- cambiarla con el botón ---');
// Hora: la misma letra; se pasa a la siguiente de la lista hasta llegar a Arial
const h0 = modelo(d).renglones.find((x) => /Hora/.test(x.t));
const cajaHora = [h0.x0 - 1, h0.y0 - 1, h0.x1 + 10, h0.y1 + 1];
const tintaHora = tinta(d, cajaHora);
await pag.locator('.renglon').nth(await indiceDe('Hora')).click();
await pag.waitForSelector('.campo-letra');
const vistas = [await letraDelCampo()];
for (let i = 0; i < 5; i++) { await pag.click('.campo-letra'); vistas.push(await letraDelCampo()); }
ok('cada clic pasa a otra letra y al final vuelve a la primera', new Set(vistas).size === 5 && vistas[0] === vistas[5], vistas);
const fuenteCampo = await pag.$eval('.campo', (c) => c.style.fontFamily);
await pag.keyboard.press('Escape');
await pag.waitForTimeout(400);
const clicsAArial = (5 - ['Arial', 'Tahoma', 'Verdana', 'Times', 'Courier'].indexOf(vistas[0])) % 5;
r = await corregir('Hora', 'Hora:11:32', clicsAArial);
ok('elegida Arial en el botón', r.elegida === 'Arial', r.elegida);
d = await bajar('hora.pdf');
const h1 = modelo(d).renglones.find((x) => /11:32/.test(x.t));
ok('la hoja guarda Arial', h1 && h1.familia === 'arial', h1 && h1.familia);
const tintaArial = tinta(d, cajaHora);
ok('y con Arial se nota: sale más fina que el original', tintaArial < tintaHora * 0.85, { original: tintaHora, conArial: tintaArial });
ok('mientras se escribe, el campo enseña la letra elegida', /Tahoma|Verdana|DejaVu|Arial|Times|Courier/.test(fuenteCampo), fuenteCampo);

console.log('\n--- añadir un renglón nuevo en el escaneo ---');
const bajo = modelo(d).renglones.find((x) => /DEPENDENCIA/.test(x.t));
await pag.click('#btnInsertar');
const caja = await pag.locator('#renglones').boundingBox();
const escala = caja.width / 595;
await pag.mouse.click(caja.x + (bajo.x1 + 8) * escala, caja.y + (bajo.y1 - 1) * escala);
await pag.waitForSelector('.campo');
const letraNueva = await letraDelCampo();

ok('al añadir, propone la letra del renglón de al lado', /Tahoma|Verdana/.test(letraNueva || ''), letraNueva);
await pag.fill('.campo', 'AGREGADO');
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelector('#capaCarga').hidden, null, { timeout: 30000 });
d = await bajar('nuevo.pdf');
const nuevo = modelo(d).renglones.find((x) => x.insertado);
ok('y el renglón nuevo se guarda con esa letra', nuevo && /tahoma|verdana/.test(nuevo.familia), nuevo && nuevo.familia);

console.log('\n--- letras que bajan de la línea (p, g, y) ---');
// «La entidad se reserva…» no tiene ninguna letra que baje de la línea; el
// texto nuevo sí. El recuadro que tapa lo viejo se medía con el texto viejo
// y acababa en la línea: la «p» y la «g» nuevas salían cortadas por abajo.
const e0 = modelo(d).renglones.find((x) => /entidad/.test(x.t));
await corregir('entidad', 'Plazo y pago: 15 dias, garantia y equipo.');
d = await bajar('bajan.pdf');
const e1 = modelo(d).renglones.find((x) => /Plazo y pago/.test(x.t));
const rabos = e1 ? tinta(d, [e1.x, e1.base + 0.6, e1.x + 200, e1.base + e1.tam * 0.22]) : -1;
ok('las p, g, y nuevas se ven enteras (tinta por debajo de la línea)', rabos > 60, { puntosBajoLaLinea: rabos, renglonViejo: e0 && e0.t });

console.log('\n--- en una hoja con texto de verdad ---');
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'tachar.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
await pag.locator('.renglon').first().click();
await pag.waitForSelector('.campo');
ok('no aparece el botón de la letra (se usa la del documento)', (await pag.$('.campo-letra')) === null);
await pag.keyboard.press('Escape');

ok('sin errores en la página', fallos.length === 0, fallos);
await nav.close(); srv.kill();
console.log(malas ? `\n${malas} FALLA(S)` : '\nTodo en orden');
process.exit(malas ? 1 : 0);
