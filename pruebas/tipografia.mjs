/* Escribir con la tipografía del propio documento.

   Lo corregido «se sentía distinto» porque se reescribía con una de las
   catorce de serie, la más parecida. La buena ya está dentro del archivo;
   lo que faltaba era saber con qué número se pide cada letra, y eso lo dice
   su propio /ToUnicode.

   Lo que se comprueba aquí es lo único que importa de esto: que el renglón
   corregido conserva LA MISMA tipografía que tenía —se lee del archivo que
   sale, no de lo que diga el programa— y que cuando no se puede, porque el
   PDF solo incrusta las letras que usó, se vuelve a la de serie y se dice
   cuál faltaba en vez de callarse. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
spawnSync('/opt/node22/bin/node', [path.join(RAIZ, 'pruebas', 'hacer-solicitud.mjs')], { encoding: 'utf8' });
const PUERTO = process.env.PUERTO || 8640;
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
const lineas = (buf) => {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(buf), 'application/pdf');
  const j = JSON.parse(d.loadPage(0).toStructuredText('preserve-whitespace').asJSON());
  const o = [];
  for (const b of j.blocks || []) for (const l of b.lines || []) o.push(l);
  return o;
};
/** Las tipografías que usa cada renglón, letra a letra: lo que dice si se
 *  ha perdido la negrita de en medio o sigue ahí. */
const fuentesPorRenglon = (buf) => {
  const d = mupdf.PDFDocument.openDocument(new Uint8Array(buf), 'application/pdf');
  const st = d.loadPage(0).toStructuredText('preserve-whitespace');
  const fuera = [];
  let act = null;
  st.walk({
    beginLine() { act = { t: '', f: new Set() }; },
    onChar(c, o, font) { if (act) { act.t += c; act.f.add(font.getName()); } },
    endLine() { if (act && act.t.trim()) fuera.push({ t: act.t, f: [...act.f].sort() }); act = null; },
  });
  return fuera;
};
const antes = lineas(fs.readFileSync(ARCH));

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });
await pag.evaluate(() => document.querySelector('#guardarAqui').click());
await pag.setInputFiles('#archivo', ARCH);
await pag.waitForSelector('.renglon', { timeout: 20000 });

let hechos = 0;
async function corregir(empieza, nuevo) {
  await pag.waitForTimeout(450);
  await pag.evaluate(() => document.querySelectorAll('.aviso').forEach((a) => a.remove()));
  const i = await pag.evaluate((v) => [...document.querySelectorAll('.renglon')]
    .findIndex((x) => (x.title || '').startsWith(v)), empieza);
  if (i < 0) return null;
  await pag.locator('.renglon').nth(i).click();
  await pag.waitForSelector('.campo', { timeout: 5000 });
  await pag.waitForTimeout(150);
  await pag.fill('.campo', nuevo);
  await pag.press('.campo', 'Enter');
  hechos++;
  await pag.waitForFunction((n) => document.querySelectorAll('#cambios li').length === n,
                            hechos, { timeout: 40000 });
  return (await pag.textContent('#avisos')).trim().split('\n').pop();
}

/* ---------- 1. correcciones de las de verdad: cambiar una fecha, un número ----------
   Solo usan letras que el documento ya tenía, que es lo normal al corregir. */
const MISMAS = [
  ['1.4.', '1.4. Se debe adjuntar la cotización de las EE.TT. solicitadas y firmadas.'],
  ['2.1.', '2.1. Una vez que la Entidad le comunique que su representada ha sido favorecida con la contratación, por'],
  ['Agradeciendo', 'Agradeciendo su atención, quedamos a la espera de su respuesta pronta.'],
];
for (const [pre, nuevo] of MISMAS) {
  const aviso = await corregir(pre, nuevo);
  ok(`«${pre}» se corrige`, aviso && !/No se pudo|no quedó|corrido/.test(aviso), aviso);
}

/* ---------- 2. una letra que el documento no incrusta ---------- */
const avisoFalta = await corregir('1.6.', '1.6. Adjuntar BPA, BPM, REGISTRO SANITARIO, FICHA (DE CORRESPONDER)');
ok('cuando la letra no está incrustada, se dice cuál y con qué se escribió',
   avisoFalta && /Escrito en .+: la del documento no trae/.test(avisoFalta), avisoFalta);

/* ---------- 3. lo que dice el archivo que sale ---------- */
const bajada = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const salida = fs.readFileSync(await (await bajada).path());
ok('sale entero', new TextDecoder().decode(salida.slice(0, 5)) === '%PDF-');
const despues = lineas(salida);

for (const [pre, nuevo] of MISMAS) {
  const v = antes.find((l) => l.text.startsWith(pre));
  const n = despues.find((l) => l.text === nuevo);
  ok(`«${pre}» conserva la tipografía del documento`,
     // el tamaño se compara con holgura: al apretar el renglón con «Tz», el
     // tamaño que se lee del archivo sale escalado, y eso no es cambiar de letra
     !!(v && n && v.font.name === n.font.name && Math.abs(v.font.size - n.font.size) <= 1.5),
     { antes: v && v.font.name + ' ' + v.font.size, despues: n && n.font.name + ' ' + n.font.size });
}

const nB = fuentesPorRenglon(salida).find((l) => l.t.includes('FICHA'));
ok('lo que no cambió sigue con la letra del documento; solo el trozo nuevo va con la de serie',
   !!(nB && nB.f.some((n) => /LiberationSans-Bold/.test(n)) && nB.f.some((n) => /^Helvetica-Bold$/.test(n))),
   nB && nB.f);

/* ---------- 4. y lo insertado también ---------- */
await pag.click('#btnInsertar');
// se pulsa justo debajo de un renglón de texto corriente, para que la letra
// que se copie sea la del cuerpo y no la del pie, que va en monoespaciada
const punto = await pag.evaluate(() => {
  const caja = document.querySelector('#renglones').getBoundingClientRect();
  const esc = Number(document.getElementById('zoom').value) / 100;
  const n = [...document.querySelectorAll('.renglon')].find((x) => (x.title || '').startsWith('2.1.'));
  const r = n.getBoundingClientRect();
  return { x: r.left + 4, y: r.bottom + 3 * esc };
});
await pag.mouse.click(punto.x, punto.y);
await pag.waitForSelector('.campo', { timeout: 5000 });
const ayuda = await pag.textContent('.campo-ayuda');
ok('al insertar dice la tipografía del documento, sin el prefijo de subconjunto',
   /Se escribirá en LiberationSans /.test(ayuda) && !/Se escribirá en \S*\+/.test(ayuda), ayuda);
await pag.fill('.campo', 'antes de la entrega');
await pag.press('.campo', 'Enter');
hechos++;
await pag.waitForFunction((n) => document.querySelectorAll('#cambios li').length === n, hechos, { timeout: 40000 });

const bajada2 = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const ins = lineas(fs.readFileSync(await (await bajada2).path())).find((l) => l.text === 'antes de la entrega');
ok('lo insertado sale con la tipografía del documento',
   !!(ins && /LiberationSans/.test(ins.font.name)), ins && ins.font.name);

/* ---------- 5. y lo que llevaba dentro el renglón sigue dentro ----------
   El renglón 1.3 lleva media frase normal y media en negrita, azul y
   subrayada. Corregir la hora no puede llevarse eso por delante. */
const antesF = fuentesPorRenglon(fs.readFileSync(ARCH)).find((l) => l.t.startsWith('1.3.'));
ok('el renglón de prueba mezcla dos tipografías', antesF && antesF.f.length === 2, antesF && antesF.f);
const aviso13 = await corregir('1.3.', antesF.t.replace('16:00', '12:30'));
ok('se corrige la hora', aviso13 && !/No se pudo|no quedó|corrido/.test(aviso13), aviso13);

const bajada3 = pag.waitForEvent('download');
await pag.click('#btnDescargar');
const despuesF = fuentesPorRenglon(fs.readFileSync(await (await bajada3).path()))
  .find((l) => l.t.startsWith('1.3.'));
ok('sigue siendo UN solo renglón, no tres trozos sueltos',
   !!(despuesF && despuesF.t.includes('12:30') && despuesF.t.includes('1.3. El plazo')),
   despuesF && despuesF.t.slice(0, 50) + '…');
ok('y conserva las mismas tipografías que tenía: no se pierde la negrita',
   !!(despuesF && despuesF.f.join('|') === antesF.f.join('|')),
   { antes: antesF && antesF.f, despues: despuesF && despuesF.f });

ok('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3));
console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo en verde');
await nav.close(); srv.kill();
process.exit(fallas ? 1 : 0);
