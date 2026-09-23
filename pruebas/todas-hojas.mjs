/* Reconocer todas las hojas escaneadas de una vez.

   Un documento de cuatro hojas —tres escaneadas, una de ellas girada, y una
   con texto de verdad— se lee entero con un solo botón. Se comprueba lo que
   ve quien lo usa: cuántas hojas faltan, por cuál va, que se puede detener
   y lo ya leído se queda, que un Deshacer lo devuelve todo de una vez, que
   la hoja con texto no se toca, y que el PDF que sale se puede buscar en
   todas las hojas. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as mupdf from '../lib/mupdf.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-todas-hojas-'));
const PUERTO = process.env.PUERTO || 8397;
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

// el documento de prueba, armado con las muestras inventadas
const abrir = (f) => mupdf.PDFDocument.openDocument(new Uint8Array(fs.readFileSync(path.join(RAIZ, 'pruebas', f))), 'application/pdf');
const junto = new mupdf.PDFDocument();
for (const [f, n] of [['escaneo.pdf', 0], ['tachar.pdf', 0], ['tachar.pdf', 1], ['escaneo-girado.pdf', 0]]) junto.graftPage(-1, abrir(f), n);
const ORIGEN = path.join(SALIDA, 'cuatro-hojas.pdf');
fs.writeFileSync(ORIGEN, junto.saveToBuffer('').asUint8Array());
const textoHoja2 = junto.loadPage(1).toStructuredText().asText();

const aviso = () => pag.$$eval('#avisos > *', (xs) => xs.map((x) => x.textContent).join(' | '));
const porLeer = async () => ({ visible: await pag.$eval('#porLeer', (x) => !x.hidden), texto: await pag.textContent('#porLeerTexto') });
/** Lanza «Reconocer todas» y anota qué «Hoja N de M» fue enseñando. */
async function reconocerTodas(boton, alVer) {
  const vistos = new Set();
  let barra = false;
  await pag.click(boton);
  for (;;) {
    const e = await pag.evaluate(() => ({
      tapa: !document.querySelector('#capaCarga').hidden,
      t: document.querySelector('#cargaTexto').textContent,
      barra: !document.querySelector('#cargaBarra').hidden,
      detener: !document.querySelector('#cargaDetener').hidden,
    }));
    const m = /Hoja \d+ de \d+/.exec(e.t);
    if (m && e.tapa) { vistos.add(m[0]); if (alVer) await alVer(m[0]); }
    if (e.barra && e.detener) barra = true;
    if (!e.tapa && vistos.size) break;
    await pag.waitForTimeout(300);
  }
  return { vistos: [...vistos], barra };
}

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });
await pag.setInputFiles('#archivo', ORIGEN);
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });

console.log('--- lo que ofrece antes de leer ---');
ok('en la hoja escaneada: «Reconocer esta hoja» y «Reconocer las 3 hojas escaneadas»',
   (await pag.textContent('#btnReconocer')).includes('Reconocer esta hoja')
   && await pag.isVisible('#btnReconocerTodas') && /las 3 hojas/.test(await pag.textContent('#btnReconocerTodas')),
   [await pag.textContent('#btnReconocer'), await pag.textContent('#btnReconocerTodas')].map((t) => t.trim()));
await pag.click('#pagSiguiente');
await pag.waitForSelector('.renglon', { timeout: 20000 });
let pl = await porLeer();
ok('en la hoja con texto, el panel avisa de las 3 escaneadas sin leer', pl.visible && /3 hojas escaneadas sin leer/.test(pl.texto), pl);

console.log('\n--- detener a media lectura ---');
let r = await reconocerTodas('#btnReconocerTodas2', async (visto) => {
  if (visto === 'Hoja 1 de 3' && await pag.isEnabled('#cargaDetener')) await pag.click('#cargaDetener');
});
ok('mientras lee, enseña por qué hoja va, con su barra y el botón Detener', r.barra && r.vistos.includes('Hoja 1 de 3'), r);
ok('al detenerse lo dice, y lo ya leído se queda', /Detenido: se leyeron 1 de 3/.test(await aviso()), await aviso());
pl = await porLeer();
ok('quedan 2 por leer', /2 hojas escaneadas sin leer/.test(pl.texto), pl);

console.log('\n--- leer todas ---');
const t0 = Date.now();
r = await reconocerTodas('#btnReconocerTodas2');
const s = ((Date.now() - t0) / 1000).toFixed(0);
ok('sigue con las 2 que faltaban, sin volver a leer la primera', JSON.stringify(r.vistos) === '["Hoja 1 de 2","Hoja 2 de 2"]', r.vistos);
ok('y dice cuántas leyó y en cuánto tiempo', /Leídas 2 hojas en \d+ s/.test(await aviso()), await aviso());
console.log(`   (${s} s)`);
ok('ya no queda ninguna por leer', !(await porLeer()).visible);

const bajar = async (nombre) => {
  const bajada = pag.waitForEvent('download');
  await pag.click('#btnDescargar');
  const b = fs.readFileSync(await (await bajada).path());
  fs.writeFileSync(path.join(SALIDA, nombre), b);
  return mupdf.PDFDocument.openDocument(new Uint8Array(b), 'application/pdf');
};
const d = await bajar('leido.pdf');
const textos = [0, 1, 2, 3].map((i) => d.loadPage(i).toStructuredText().asText());
ok('el PDF sale con sus 4 hojas', d.countPages() === 4);
ok('la hoja 1 (escaneo) ya se puede buscar', /COMERCIAL SAN JOSE/i.test(textos[0]), textos[0].slice(0, 60));
ok('la hoja 3 (escaneo) también', /Juana/i.test(textos[2]), textos[2].slice(0, 60));
ok('y la 4, que estaba girada', textos[3].replace(/\s/g, '').length > 40, textos[3].slice(0, 60));
ok('la hoja 2, que tenía texto, sale igual: no se le puso nada encima', textos[1] === textoHoja2);

console.log('\n--- deshacer ---');
await pag.click('#btnDeshacer');
await pag.waitForTimeout(800);
pl = await porLeer();
ok('un solo Deshacer devuelve las 2 hojas leídas de golpe', /2 hojas escaneadas sin leer/.test(pl.texto), pl);

ok('sin errores en la página', fallos.length === 0, fallos);
await nav.close(); srv.kill();
console.log(malas ? `\n${malas} FALLA(S)` : '\nTodo en orden');
process.exit(malas ? 1 : 0);
