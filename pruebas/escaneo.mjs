/* Una hoja escaneada no tiene letras dentro. El editor tiene que decirlo
   con todas las letras, no dejar una hoja muda con un «0 renglones». */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUERTO = 8370;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 800));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await (await nav.newContext()).newPage();
const fallos = [];
pag.on('pageerror', (e) => fallos.push(e.message));
let malas = 0;
const ok = (t, c, x) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) malas++; };

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', { timeout: 40000 });

console.log('--- una hoja escaneada ---');
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'escaneo.pdf'));
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
ok('se explica que es un escaneo, no se deja muda', true);
const cartel = (await pag.textContent('#cartelEscaneo')).replace(/\s+/g, ' ').trim();
console.log('   dice:', cartel.slice(0, 150) + '…');
ok('dice dónde escribir encima, si hace falta', /Sello y marcas/.test(cartel));
ok('no se muestra una hoja vacía y clicable', await pag.locator('#hojaEnvoltura').isHidden());
ok('la cabecera también lo dice', /escaneo/.test(await pag.textContent('#docDetalle')),
   await pag.textContent('#docDetalle'));
ok('no hay renglones que pulsar', (await pag.locator('.renglon').count()) === 0);

console.log('\n--- y una hoja con texto de verdad sigue igual ---');
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });
ok('el cartel desaparece', await pag.locator('#cartelEscaneo').isHidden());
ok('vuelve a verse la hoja', !(await pag.locator('#hojaEnvoltura').isHidden()));
ok('y sus renglones', (await pag.locator('.renglon').count()) > 5, await pag.locator('.renglon').count());

await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'escaneo.pdf'));
await pag.waitForSelector('#cartelEscaneo:not([hidden])', { timeout: 20000 });
await pag.screenshot({ path: path.join(RAIZ, 'pruebas', 'escaneo.png') });
console.log('\nfallos:', fallos.length ? fallos.join(' | ') : 'ninguno');
if (fallos.length) malas++;
console.log(malas ? `\n${malas} FALLA(S)` : '\nTODO BIEN');
await nav.close(); srv.kill();
process.exit(malas ? 1 : 0);
