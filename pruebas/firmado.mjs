/* Un PDF firmado digitalmente: se avisa ANTES de tocarlo, porque
   cualquier cambio invalida la firma y nadie se entera hasta que el
   documento rebota. No se impide editarlo —a veces se corrige a sabiendas
   para volver a firmar— pero no se hace a ciegas. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
spawnSync('/opt/node22/bin/node', [path.join(RAIZ, 'pruebas', 'hacer-firmado.mjs')], { encoding: 'utf8' });
const PUERTO = process.env.PUERTO || 8395;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await (await nav.newContext()).newPage();
pag.on('dialog', (d) => d.accept());
const errores = [];
pag.on('pageerror', (e) => errores.push(e.message));
pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errores.push(m.text().slice(0, 160)); });
let fallas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fallas++; };

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });
await pag.evaluate(() => document.querySelector('#guardarAqui').click());   // sin guardar nada

/* ---------- sin firma no se avisa de nada ---------- */
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
ok('un PDF sin firmar no avisa de nada', await pag.isHidden('#avisoFirma'));
ok('ni lo dice en la cabecera',
   !/firmado/.test(await pag.textContent('#docDetalle')),
   await pag.textContent('#docDetalle'));

/* ---------- un hueco para firmar tampoco es una firma ---------- */
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'firma-vacia.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
await pag.waitForTimeout(400);
ok('un hueco para firmar, sin firmar, tampoco avisa', await pag.isHidden('#avisoFirma'));

/* ---------- firmado: se avisa ---------- */
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'firmado.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
await pag.waitForTimeout(400);
ok('un PDF firmado avisa nada más abrirlo', await pag.isVisible('#avisoFirma'));
const texto = (await pag.textContent('#avisoFirma')).replace(/\s+/g, ' ').trim();
console.log('  dice:', JSON.stringify(texto));
ok('y dice qué pasa si se toca', /invalida/.test(texto), texto);
ok('la cabecera lo deja dicho también',
   /firmado digitalmente/.test(await pag.textContent('#docDetalle')),
   await pag.textContent('#docDetalle'));

await pag.click('#btnEntendidoFirma');
ok('«Entendido» quita el cartel', await pag.isHidden('#avisoFirma'));
ok('pero la cabecera lo sigue diciendo',
   /firmado digitalmente/.test(await pag.textContent('#docDetalle')));

/* ---------- avisa, pero no impide ---------- */
const idx = await pag.evaluate(() => [...document.querySelectorAll('.renglon')]
  .findIndex((n) => (n.title || '').includes('COMERCIAL SAN JOSE')));
await pag.locator('.renglon').nth(idx).click();
await pag.waitForSelector('.campo', { timeout: 5000 });
await pag.fill('.campo', 'POSTOR A · OTRA EMPRESA SAC');
await pag.press('.campo', 'Enter');
await pag.waitForSelector('#cambios li', { timeout: 30000 });
ok('avisa, pero deja editar si uno quiere', (await pag.locator('#cambios li').count()) === 1);

/* ---------- al abrir otro, el cartel se va ---------- */
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
await pag.waitForTimeout(400);
ok('al abrir uno sin firmar, el cartel se va', await pag.isHidden('#avisoFirma'));
ok('y la cabecera deja de decirlo',
   !/firmado/.test(await pag.textContent('#docDetalle')),
   await pag.textContent('#docDetalle'));

ok('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3));
console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo en verde');
await nav.close(); srv.kill();
process.exit(fallas ? 1 : 0);
