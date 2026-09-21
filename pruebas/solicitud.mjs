/* Un correo de trabajo de verdad: impreso por Chrome desde Gmail, con
   párrafos justificados y, dentro de cada renglón, negrita, cursiva,
   subrayado y enlaces de color.

   Aquí estaba el fallo que dejó a Renzo sin poder corregir su solicitud:
   los renglones con comillas tipográficas, raya o puntos suspensivos —que
   es como escribe Gmail— se rechazaban enteros con un «el texto nuevo no
   quedó donde debía». No era la posición: era que esas letras se escribían
   como interrogantes y la comprobación, con razón, no reconocía lo que
   había salido. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
spawnSync('/opt/node22/bin/node', [path.join(RAIZ, 'pruebas', 'hacer-solicitud.mjs')], { encoding: 'utf8' });
const PUERTO = process.env.PUERTO || 8620;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
const pag = await ctx.newPage();
pag.on('dialog', (d) => d.accept());
const errores = [];
pag.on('pageerror', (e) => errores.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errores.push(m.text().slice(0, 160)); });
let fallas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fallas++; };

const ARCH = path.join(RAIZ, 'pruebas', 'solicitud.pdf');
await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });
await pag.evaluate(() => document.querySelector('#guardarAqui').click());
await pag.setInputFiles('#archivo', ARCH);
await pag.waitForSelector('.renglon', { timeout: 20000 });
await pag.evaluate(() => { const z = document.getElementById('zoom'); z.value = '70'; z.dispatchEvent(new Event('input', { bubbles: true })); });
await pag.waitForTimeout(600);

/* ---------- 1. TODOS los renglones se dejan corregir ---------- */
const n = await pag.locator('.renglon').count();
const mal = [];
for (let i = 0; i < n; i++) {
  const t = await pag.locator('.renglon').nth(i).getAttribute('title');
  if (!t || !t.trim()) continue;
  await pag.evaluate(() => document.querySelectorAll('.aviso').forEach((a) => a.remove()));
  await pag.locator('.renglon').nth(i).click({ force: true });
  await pag.waitForSelector('.campo', { timeout: 5000 }).catch(() => {});
  if (!(await pag.locator('.campo').count())) { mal.push({ i, t: t.slice(0, 40), por: 'no abre el campo' }); continue; }
  await pag.fill('.campo', t.replace(/[0-9]/, 'X') === t ? t + ' Z' : t.replace(/[0-9]/, 'X'));
  await pag.press('.campo', 'Enter');
  await pag.waitForTimeout(650);
  const aviso = (await pag.textContent('#avisos')).trim();
  if (/No se pudo|no quedó|seguía|por delante|corrido/.test(aviso)) {
    mal.push({ i, t: t.slice(0, 44), por: aviso.replace(/\s+/g, ' ').slice(0, 70) });
  }
  await pag.keyboard.press('Control+z');
  await pag.waitForTimeout(350);
}
ok(`los ${n} renglones del correo se dejan corregir`, mal.length === 0, mal.slice(0, 5));

/** Corrige el renglón que empieza por «empieza» y espera a que cuadre la
 *  cuenta de cambios. Se busca por su texto y no por su número: después de
 *  cada cambio la hoja se vuelve a leer y los números bailan. */
async function corregir(empieza, nuevo, cuantos) {
  await pag.waitForTimeout(500);
  const i = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
    .findIndex((x) => (x.title || '').startsWith(v)), empieza);
  if (i < 0) return -1;
  await pag.locator('.renglon').nth(i).click();
  await pag.waitForSelector('.campo', { timeout: 5000 });
  await pag.waitForTimeout(200);
  await pag.fill('.campo', nuevo);
  await pag.press('.campo', 'Enter');
  await pag.waitForFunction((n) => document.querySelectorAll('#cambios li').length === n,
                            cuantos, { timeout: 40000 });
  return i;
}

/* ---------- 2. ida y vuelta de las letras de imprenta ---------- */
const PRUEBA = 'COMILLAS “ASI” · RAYA – Y LARGA — PUNTO • PUNTOS… EURO €';
ok('el renglón con la raya se deja corregir', (await corregir('2.3.', PRUEBA, 1)) >= 0);

/* ---------- 3. una letra que la tipografía no tiene se dice ---------- */
await corregir('2.2.', 'PLAZO → DIEZ DIAS', 2);
const avisoFlecha = (await pag.textContent('#avisos')).trim().split('\n').pop();
ok('avisa de la letra que no cabe en vez de dejarla en silencio',
   /no tiene «→»/.test(avisoFlecha), avisoFlecha);

/* ---------- 4. dos renglones iguales: se cambia el que se pulsó ---------- */
const REPE = 'Adjuntar el anexo firmado.';
await pag.waitForTimeout(500);
const repes = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
  .map((x, k) => ((x.title || '').trim() === v ? k : -1)).filter((k) => k >= 0), REPE);
ok('el correo trae el mismo renglón dos veces', repes.length === 2, repes);
if (repes.length === 2) {
  await pag.locator('.renglon').nth(repes[1]).click();
  await pag.waitForSelector('.campo', { timeout: 5000 });
  await pag.waitForTimeout(200);
  await pag.fill('.campo', 'Adjuntar el anexo firmado y sellado.');
  await pag.press('.campo', 'Enter');
  await pag.waitForFunction(() => document.querySelectorAll('#cambios li').length === 3, null, { timeout: 40000 });
  const av = (await pag.textContent('#avisos')).trim().split('\n').pop();
  ok('cambiar el segundo de dos renglones iguales no se toma por corrido',
     !/corrido|no quedó/.test(av), av);
}

/* ---------- 5. y en el archivo que sale, letra por letra ---------- */
const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida = fs.readFileSync(await (await bajada).path());
ok('sale entero', new TextDecoder().decode(salida.slice(0, 5)) === '%PDF-');
const texto = mupdf.PDFDocument.openDocument(new Uint8Array(salida), 'application/pdf')
  .loadPage(0).toStructuredText('preserve-whitespace').asText();
const puesta = texto.split('\n').find((l) => l.includes('COMILLAS'));
ok('las comillas, la raya, el punto y el euro salen tal cual',
   puesta && puesta.trim() === PRUEBA, { pedido: PRUEBA, quedo: puesta && puesta.trim() });
ok('la flecha, que no existe en la tipografía, quedó como «?»',
   texto.includes('PLAZO ? DIEZ DIAS'),
   texto.split('\n').find((l) => l.includes('PLAZO')));
const donde = texto.split('\n').map((l) => l.trim());
ok('de los dos renglones iguales cambió el de abajo, y el de arriba sigue arriba',
   donde.indexOf(REPE) >= 0 && donde.indexOf('Adjuntar el anexo firmado y sellado.') > donde.indexOf(REPE),
   { arriba: donde.indexOf(REPE), abajo: donde.indexOf('Adjuntar el anexo firmado y sellado.') });

ok('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3));
console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo en verde');
await nav.close(); srv.kill();
process.exit(fallas ? 1 : 0);
