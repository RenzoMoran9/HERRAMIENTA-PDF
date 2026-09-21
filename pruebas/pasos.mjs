/* El deslizador del tamaño lleva «−» y «+»: arrastrarlo pide pulso fino. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUERTO = process.env.PUERTO || 8333;
const srv = spawn('/opt/node22/bin/node', [path.join(RAIZ, 'servidor.mjs')], { env: { ...process.env, PUERTO } });
await new Promise((r) => setTimeout(r, 700));
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await (await nav.newContext()).newPage();
const errores = []; pag.on('pageerror', (e) => errores.push(e.message));
let fallas = 0;
const ok = (t, c, extra) => { console.log((c ? '  OK  ' : ' FALLA') + ' · ' + t + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); if (!c) fallas++; };

await pag.goto(`http://127.0.0.1:${PUERTO}/`);
await pag.waitForFunction('window.grapaEditorListo === true', null, { timeout: 40000 });
await pag.setInputFiles('#archivo', path.join(RAIZ, 'pruebas', 'postores.pdf'));
await pag.waitForSelector('.renglon', { timeout: 20000 });

const colocacion = await pag.evaluate(() => {
  const ent = document.getElementById('zoom');
  const caja = ent.parentElement;
  const bs = [...caja.querySelectorAll('button.paso')];
  return { envuelto: caja.classList.contains('deslizador'), botones: bs.map((b) => b.textContent),
           orden: caja.children[0] === bs[0] && caja.children[1] === ent && caja.children[2] === bs[1] };
});
ok('el deslizador va entre un − y un +',
   colocacion.envuelto && colocacion.orden && colocacion.botones.join('') === '−+', colocacion);

const ancho = () => pag.evaluate(() => ({
  valor: Number(document.getElementById('zoom').value),
  hoja: Math.round(document.querySelector('#lienzo').getBoundingClientRect().width),
}));
const mas = pag.locator('#zoom').locator('xpath=following-sibling::button[1]');
const menos = pag.locator('#zoom').locator('xpath=preceding-sibling::button[1]');
const a0 = await ancho();
await mas.click(); await pag.waitForTimeout(400);
const a1 = await ancho();
ok('un clic sube un paso proporcional', a1.valor === Math.ceil(a0.valor * 1.12), { a0, a1 });
ok('y la hoja se agranda de verdad', a1.hoja > a0.hoja + 5, { a0, a1 });
await menos.click(); await pag.waitForTimeout(400);
ok('el «−» lo devuelve a su sitio', (await ancho()).valor === a0.valor, await ancho());

const caja = await mas.boundingBox();
await pag.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
await pag.mouse.down();
await pag.waitForTimeout(1100);
await pag.mouse.up();
await pag.waitForTimeout(400);
const tope = await ancho();
ok('mantenido sube solo y no se pasa del tope', tope.valor > a0.valor * 1.5 && tope.valor <= 300, { a0, tope });

ok('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3));
console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo en verde');
await nav.close(); srv.kill();
process.exit(fallas ? 1 : 0);
