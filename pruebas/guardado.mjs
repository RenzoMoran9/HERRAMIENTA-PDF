/* No perder el trabajo: lo que se lleva editado se guarda en el propio
   navegador y se recupera al volver. Y se puede apagar, que en un equipo
   compartido dejar ahí un expediente no es cosa menor. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUERTO = process.env.PUERTO || 8370;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true });
const pag = await ctx.newPage();
pag.on('dialog', (d) => d.accept());
const errores = [];
pag.on('pageerror', (e) => errores.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errores.push(m.text().slice(0, 160)); });
let fallas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fallas++; };
const arrancar = async () => {
  await pag.goto(`http://127.0.0.1:${PUERTO}/`);
  await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });
  await pag.waitForTimeout(700);
};

const VIEJO = 'COMERCIAL SAN JOSE SAC';
const NUEVO = 'DISTRIBUIDORA EJEMPLO SAC';

/* ---------- 1. editar algo y dejar que se guarde ---------- */
await arrancar();
ok('sin nada guardado no se ofrece recuperar nada',
   await pag.isHidden('#recuperar'));
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
const idx = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes(v)), VIEJO);
const texto = await pag.locator('.renglon').nth(idx).getAttribute('title');
await pag.locator('.renglon').nth(idx).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', texto.replace(VIEJO, NUEVO));
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 30000 });
await pag.waitForTimeout(2200);            // el apunte espera 1,2 s
ok('dice que lo ha guardado aquí',
   /Guardado .*solo en este equipo/.test(await pag.textContent('#guardadoEstado')),
   await pag.textContent('#guardadoEstado'));

/* ---------- 2. se recarga: tiene que ofrecerlo ---------- */
await arrancar();
ok('al volver, ofrece recuperar', await pag.isVisible('#recuperar'));
const detalle = await pag.textContent('#recuperarDetalle');
console.log('  dice:', JSON.stringify(detalle));
ok('y dice qué era y cuánto llevaba', /postores\.pdf · 1 cambio · hace/.test(detalle), detalle);

await pag.click('#btnRecuperar');
await pag.waitForSelector('.renglon', { timeout: 30000 });
const recuperado = await pag.evaluate(() => ({
  nombre: document.querySelector('#docNombre').textContent,
  cambios: document.querySelectorAll('#cambios li').length,
  banda: document.querySelector('#recuperar').hidden,
}));
ok('vuelve el documento con su lista de cambios',
   recuperado.nombre === 'postores.pdf' && recuperado.cambios === 1 && recuperado.banda, recuperado);

const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida = fs.readFileSync(await (await bajada).path());
const d = mupdf.PDFDocument.openDocument(new Uint8Array(salida), 'application/pdf');
const t0 = d.loadPage(0).toStructuredText('preserve-whitespace').asText();
ok('y el cambio que se había hecho sigue puesto', t0.includes(NUEVO) && !t0.includes(VIEJO),
   { nuevo: t0.includes(NUEVO), viejo: t0.includes(VIEJO) });

/* ---------- 3. descartar lo borra de verdad ---------- */
await arrancar();
ok('vuelve a ofrecerlo', await pag.isVisible('#recuperar'));
await pag.click('#btnDescartar');
ok('al descartar se quita la banda', await pag.isHidden('#recuperar'));
await arrancar();
ok('y ya no vuelve a ofrecerlo', await pag.isHidden('#recuperar'));

/* ---------- 4. apagado, no se guarda nada ---------- */
await pag.uncheck('#guardarAqui');
ok('lo dice cuando está apagado',
   /Apagado/.test(await pag.textContent('#guardadoEstado')),
   await pag.textContent('#guardadoEstado'));
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
const idx2 = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes(v)), VIEJO);
await pag.locator('.renglon').nth(idx2).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', 'OTRA COSA DISTINTA');
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 30000 });
await pag.waitForTimeout(2200);
await arrancar();
ok('con el guardado apagado no queda nada que recuperar', await pag.isHidden('#recuperar'));
ok('y el interruptor sigue apagado al volver',
   !(await pag.isChecked('#guardarAqui')));

/* ---------- 5. y lo mismo en el archivo suelto, desde el disco ----------
   Es como se usa en el trabajo, y ahí el navegador es más tacaño con lo que
   deja guardar: conviene comprobarlo donde de verdad importa. */
const suelto = await (await nav.newContext()).newPage();
suelto.on('dialog', (d) => d.accept());
const ARCHIVO = 'file://' + path.join(RAIZ, 'GrapaEditor.html');
await suelto.goto(ARCHIVO);
await suelto.waitForFunction('window.grapaEditorListo === true', null, { timeout: 90000 });
await suelto.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await suelto.waitForSelector('.renglon', { timeout: 30000 });
const iS = await suelto.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes(v)), VIEJO);
await suelto.locator('.renglon').nth(iS).click();
await suelto.waitForSelector('.campo', { timeout: 5000 });
await suelto.fill('.campo', 'CAMBIADO DESDE EL ARCHIVO SUELTO');
await suelto.press('.campo', 'Enter');
await suelto.waitForSelector('#cambios li', { timeout: 30000 });
await suelto.waitForTimeout(2200);
const estadoSuelto = await suelto.textContent('#guardadoEstado');
ok('desde el disco también guarda', /Guardado .*solo en este equipo/.test(estadoSuelto), estadoSuelto);
await suelto.goto(ARCHIVO);
await suelto.waitForFunction('window.grapaEditorListo === true', null, { timeout: 90000 });
await suelto.waitForTimeout(900);
ok('y al volver lo ofrece', await suelto.isVisible('#recuperar'),
   await suelto.textContent('#recuperarDetalle').catch(() => ''));
await suelto.click('#btnDescartar');

ok('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3));
console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo en verde');
await nav.close(); srv.kill();
process.exit(fallas ? 1 : 0);
