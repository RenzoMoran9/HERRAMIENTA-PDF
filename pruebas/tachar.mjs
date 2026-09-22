/* Tachar de verdad: un DNI, un nombre o una cuenta se QUITAN del archivo,
   no se tapan con un rectángulo que se levanta copiando y pegando.

   Con un documento inventado —una hoja con texto y la misma hoja
   escaneada— se comprueba lo que le importa a quien manda el expediente:

     · marcar no toca nada; tachar sí, todo de una vez;
     · «Tachar todas las coincidencias» encuentra el DNI también en la hoja
       escaneada, una vez reconocida;
     · en el archivo que sale el DNI no está NI EN EL TEXTO NI POR DENTRO
       del PDF (ni como objeto suelto, ni en el texto reconocido que guarda
       la hoja), y en la foto esos píxeles son negros;
     · lo de alrededor sigue ahí;
     · corregir después otro renglón de la hoja escaneada no lo resucita;
     · la lista de cambios no guarda el dato tachado;
     · Deshacer lo devuelve.                                            */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-tachar-'));
const PUERTO = process.env.PUERTO || 8395;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const pag = await ctx.newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !/Estimating resolution/.test(m.text())) fallos.push(m.text().slice(0, 160)); });
let malas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) malas++; };

const ORIGEN = path.join(RAIZ, 'pruebas', 'tachar.pdf');
const DNI = '45678912', NOMBRE = 'Juana Perez Quispe', CUENTA = '2345678';

/** Todo lo que hay dentro del PDF, sin comprimir, y el texto de sus hojas. */
function porDentro(bytes) {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(bytes), 'application/pdf');
  const crudo = Buffer.from(d.saveToBuffer('decompress').asUint8Array()).toString('latin1');
  const texto = [];
  for (let i = 0; i < d.countPages(); i++) texto.push(d.loadPage(i).toStructuredText('preserve-whitespace').asText());
  return { d, crudo, texto };
}
/** ¿Está la palabra en el archivo, escrita tal cual o en hexadecimal? */
const dentro = (crudo, palabra) => crudo.includes(palabra)
  || crudo.toUpperCase().includes(Buffer.from(palabra).toString('hex').toUpperCase());
/** Cuán oscura es una zona de la hoja, dibujada: 0 negro, 255 blanco. */
function oscuridad(d, hoja, [x0, y0, x1, y1]) {
  const pix = d.loadPage(hoja).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, true);
  const px = pix.getPixels(), an = pix.getWidth(), salto = pix.getStride();
  let s = 0, n = 0;
  for (let y = Math.ceil(y0 + 1); y < Math.floor(y1 - 1); y++) {
    for (let x = Math.ceil(x0 + 1); x < Math.floor(x1 - 1); x++) { s += px[y * salto + x]; n++; }
  }
  return n ? s / n : 255;
}
/** Dónde está una palabra en la hoja 1 del original, en puntos. */
function cajaDe(palabra, hoja = 0) {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(fs.readFileSync(ORIGEN)), 'application/pdf');
  const q = d.loadPage(hoja).search(palabra)[0];
  const xs = q.flatMap((k) => [k[0], k[2], k[4], k[6]]), ys = q.flatMap((k) => [k[1], k[3], k[5], k[7]]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// el original sí lo lleva dentro: si no, la prueba no probaría nada
const antes = porDentro(fs.readFileSync(ORIGEN));
ok('el original lleva el DNI por dentro', dentro(antes.crudo, DNI));

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('.renglon', { timeout: 20000 });
ok('el botón Tachar está en la barra', await pag.isEnabled('#btnTachar'));

console.log('\n--- la hoja escaneada, reconocida ---');
await pag.click('#pagSiguiente');
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.click('#btnReconocer');
await pag.waitForSelector('#reconocido:not([hidden])', { timeout: 180000 });
const leido = await pag.$eval('#reconocidoTexto', (t) => t.value);
ok('el reconocimiento lee el DNI de la foto', leido.includes(DNI), leido.split('\n').slice(0, 5));
await pag.click('#pagAnterior');
await pag.waitForTimeout(300);

console.log('\n--- marcar: todas las veces que aparece el DNI ---');
await pag.fill('#buscarTexto', DNI);
await pag.click('#btnTacharTodas');
await pag.waitForTimeout(300);
ok('marca las dos: la de texto y la de la foto reconocida',
   await pag.textContent('#btnTacharAplicar') === 'Tachar 2 zonas', await pag.textContent('#btnTacharAplicar'));
ok('la lista dice en qué hojas', (await pag.$$eval('#tachasLista li', (l) => l.map((x) => x.textContent))).join('|')
   === 'Hoja 1 · 1 zona|Hoja 2 · 1 zona');
ok('en la hoja se ve la zona marcada', await pag.locator('.tacha').count() === 1);
ok('marcar no cambia nada todavía', await pag.locator('#cambios li').count() === 0);

console.log('\n--- marcar a mano: el nombre, arrastrando ---');
const escala = await pag.$eval('#zoom', (z) => Number(z.value) / 100);
const arrastrar = async ([x0, y0, x1, y1]) => {
  const c = await pag.locator('#renglones').boundingBox();
  await pag.mouse.move(c.x + (x0 - 2) * escala, c.y + (y0 - 2) * escala);
  await pag.mouse.down();
  await pag.mouse.move(c.x + (x0 + x1) / 2 * escala, c.y + (y0 + y1) / 2 * escala, { steps: 4 });
  await pag.mouse.move(c.x + (x1 + 2) * escala, c.y + (y1 + 2) * escala, { steps: 4 });
  await pag.mouse.up();
  await pag.waitForTimeout(150);
};
const cajaNombre = cajaDe(NOMBRE);
await arrastrar(cajaNombre);
ok('arrastrar marca otra zona', await pag.locator('.tacha').count() === 2);
// un clic suelto no marca nada
const c0 = await pag.locator('#renglones').boundingBox();
await pag.mouse.click(c0.x + 300 * escala, c0.y + 400 * escala);
await pag.waitForTimeout(150);
ok('un clic sin arrastrar no marca nada', await pag.locator('.tacha').count() === 2);
// y la cuenta, en la hoja escaneada
await pag.click('#pagSiguiente');
await pag.waitForTimeout(400);
const cajaCuenta = cajaDe('191-2345678-0-12');
await arrastrar(cajaCuenta);
ok('también se marca sobre la foto', await pag.textContent('#btnTacharAplicar') === 'Tachar 4 zonas',
   await pag.textContent('#btnTacharAplicar'));
// y una zona de más, que se quita con su ×
await arrastrar([300, 300, 400, 330]);
await pag.locator('.tacha').last().locator('.tacha-quitar').click();
await pag.waitForTimeout(150);
ok('la × de una zona la quita', await pag.textContent('#btnTacharAplicar') === 'Tachar 4 zonas');

console.log('\n--- tachar ---');
await pag.click('#btnTacharAplicar');
await pag.waitForFunction(() => document.querySelector('#cambios li')
  || /No se pudo|quedaba texto/.test(document.querySelector('#avisos').textContent), null, { timeout: 60000 });
const aviso = (await pag.textContent('#avisos')).trim().split('\n').pop();
console.log('   aviso:', aviso);
ok('dice cuánto quitó', /4 zonas tachadas: \d+ letras quitadas del archivo/.test(aviso), aviso);
const listaCambios = await pag.textContent('#cambios');
ok('la lista de cambios dice que se tachó…', /tachado/.test(listaCambios), listaCambios);
ok('…pero no guarda lo que se tachó', ![DNI, 'Juana', CUENTA].some((x) => listaCambios.includes(x)));
ok('ya no quedan zonas pendientes', await pag.isHidden('#panelTachar'));

const bajar = async (nombre) => {
  const bajada = pag.waitForEvent('download');
  await pag.click('#btnDescargar');
  const b = fs.readFileSync(await (await bajada).path());
  fs.writeFileSync(path.join(SALIDA, nombre), b);
  return b;
};
let fuera = porDentro(await bajar('tachado.pdf'));
ok('en el texto de las hojas ya no está el DNI', !fuera.texto.some((t) => t.includes(DNI)), fuera.texto);
ok('ni el nombre en la hoja 1, donde se tachó', !fuera.texto[0].includes('Juana'), fuera.texto[0]);
ok('ni la cuenta en la hoja 2, donde se tachó', !fuera.texto[1].includes(CUENTA), fuera.texto[1]);
ok('POR DENTRO del archivo tampoco está el DNI, de ninguna manera: ni como texto, ni como objeto suelto, ni en lo reconocido',
   !dentro(fuera.crudo, DNI));
ok('lo de alrededor sigue ahí, en las dos hojas',
   fuera.texto[0].includes('Otra linea que no se toca') && fuera.texto[0].includes('Nombre:')
   && fuera.texto[0].includes('DNI') && /Otra linea/.test(fuera.texto[1]), fuera.texto);
const cajaDni = cajaDe(DNI);
const oscuros = [oscuridad(fuera.d, 0, cajaDni), oscuridad(fuera.d, 1, cajaDni),
                 oscuridad(fuera.d, 0, cajaNombre), oscuridad(fuera.d, 1, cajaCuenta)];
ok('donde estaba, un recuadro negro: en la hoja de texto y en la foto', oscuros.every((v) => v < 30), oscuros.map(Math.round));
ok('y fuera de las zonas, la hoja sigue blanca', oscuridad(fuera.d, 1, [300, 700, 500, 780]) > 200);
// los píxeles de la foto, quitados de la imagen misma y no solo tapados:
// MuPDF los deja en blanco liso, y el recuadro negro va encima
const tintaEnImagen = (d) => {
  const imgs = [];
  d.loadPage(1).toStructuredText('preserve-images').walk({ onImageBlock(bbox, m, im) { imgs.push(im); } });
  const px = imgs[0].toPixmap();
  const W = px.getWidth(), H = px.getHeight(), n = px.getNumberOfComponents(), salto = px.getStride(), v = px.getPixels();
  let min = 255;
  for (let y = Math.ceil((cajaDni[1] + 2) * H / 842); y < Math.floor((cajaDni[3] - 2) * H / 842); y++) {
    for (let x = Math.ceil((cajaDni[0] + 2) * W / 595); x < Math.floor((cajaDni[2] - 2) * W / 595); x++) min = Math.min(min, v[y * salto + x * n]);
  }
  return min;
};
const tintaAntes = tintaEnImagen(antes.d), tintaDespues = tintaEnImagen(fuera.d);
ok('en la IMAGEN escaneada, bajo el DNI había tinta y ya no queda nada (no solo está tapado)',
   tintaAntes < 100 && tintaDespues > 240, { antes: tintaAntes, despues: tintaDespues });

console.log('\n--- corregir después otro renglón de la foto no lo resucita ---');
const idx = await pag.evaluate(() => [...document.querySelectorAll('.renglon')].findIndex((r) => /Monto/.test(r.title)));
ok('está el renglón del monto', idx >= 0);
await pag.locator('.renglon').nth(idx).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', 'Monto: S/ 2,500.00');
await pag.press('.campo', 'Enter');
await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 3, null, { timeout: 60000 });
fuera = porDentro(await bajar('tachado-y-corregido.pdf'));
ok('el monto cambió', fuera.texto[1].includes('2,500.00'), fuera.texto[1]);
ok('y el DNI sigue sin estar, ni en el texto ni por dentro',
   !fuera.texto.some((t) => t.includes(DNI)) && !dentro(fuera.crudo, DNI));
ok('y su recuadro negro sigue en la foto', oscuridad(fuera.d, 1, cajaDni) < 30, Math.round(oscuridad(fuera.d, 1, cajaDni)));

console.log('\n--- deshacer ---');
await pag.click('#btnDeshacer');
await pag.waitForTimeout(500);
await pag.click('#btnDeshacer');
await pag.waitForTimeout(500);
await pag.click('#pagAnterior');
await pag.waitForTimeout(400);
const titulos = await pag.$$eval('.renglon', (r) => r.map((x) => x.title));
ok('Deshacer devuelve el DNI y el nombre', titulos.some((t) => t.includes(DNI)) && titulos.some((t) => t.includes('Juana')), titulos);

console.log('\n--- hojas giradas: 90, 180 y 270 grados ---');
const GIRADO = path.join(RAIZ, 'pruebas', 'girado.pdf');
await pag.setInputFiles('#archivo', GIRADO);
await pag.waitForSelector('.renglon', { timeout: 20000 });
await pag.fill('#buscarTexto', '10488');
await pag.click('#btnTacharTodas');
await pag.waitForTimeout(300);
ok('lo encuentra en las cinco hojas', await pag.textContent('#btnTacharAplicar') === 'Tachar 5 zonas',
   await pag.textContent('#btnTacharAplicar'));
await pag.click('#btnTacharAplicar');
await pag.waitForSelector('#cambios li', { timeout: 60000 });
const giradoFuera = porDentro(await bajar('girado-tachado.pdf'));
const giradoAntes = mupdf.PDFDocument.openDocument(new Uint8Array(fs.readFileSync(GIRADO)), 'application/pdf');
const enGiradas = giradoFuera.texto.map((t, i) => {
  const q = giradoAntes.loadPage(i).search('10488')[0][0];
  const caja = [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])];
  return { sin: !t.includes('10488'), resto: t.includes('ADQUISICION'), negro: Math.round(oscuridad(giradoFuera.d, i, caja)) };
});
ok('en cada hoja girada: el número fuera, lo demás igual y el recuadro negro en su sitio',
   enGiradas.every((x) => x.sin && x.resto && x.negro < 30), enGiradas);
ok('y por dentro del archivo tampoco está', !dentro(giradoFuera.crudo, '10488'));

ok('sin errores en la página', fallos.length === 0, fallos);
await nav.close(); srv.kill();
console.log(malas ? `\n${malas} FALLA(S)` : '\nTodo en orden');
process.exit(malas ? 1 : 0);
