/* Corre todas las pruebas del editor, una detrás de otra y cada una con su
   puerto, y dice al final cuáles han quedado en rojo.   node pruebas/todas.mjs */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const suites = process.argv.slice(2).length ? process.argv.slice(2) : [
  'editar', 'suelto', 'subconjunto', 'escaneo', 'reconocer', 'corregir-escaneo',
  'suelto-ocr', 'buscar', 'pasos', 'borrar-insertar', 'guardado', 'girado', 'firmado',
];
// El archivo suelto se vuelve a armar antes de nada: dos de las pruebas lo
// abren desde el disco, y probar una versión vieja no prueba nada.
const armado = spawnSync('/opt/node22/bin/node', [path.join(RAIZ, '..', 'construir.mjs')], { encoding: 'utf8' });
console.log((armado.stdout || armado.stderr || '').trim());
if (armado.status !== 0) { console.log('no se pudo armar GrapaEditor.html'); process.exit(1); }

let puerto = 8400;
const malas = [];
for (const s of suites) {
  const r = spawnSync('/opt/node22/bin/node', [path.join(RAIZ, s + '.mjs')],
    { env: { ...process.env, PUERTO: String(puerto++) }, encoding: 'utf8', timeout: 600000 });
  const sal = (r.stdout || '') + (r.stderr || '');
  const fallas = (sal.match(/ FALLA|CABECERA ROTA|no se encontró/g) || []).length;
  const bien = r.status === 0 && fallas === 0;
  if (!bien) malas.push({ s, status: r.status, cola: sal.trim().split('\n').slice(-8).join('\n') });
  console.log((bien ? 'VERDE  ' : 'ROJA   ') + s + (fallas ? `  (${fallas} fallas)` : ''));
}
console.log('\n==========================');
console.log(`${suites.length - malas.length} / ${suites.length} en verde`);
for (const m of malas) console.log('\n### ' + m.s + ' (salida ' + m.status + ')\n' + m.cola);
process.exit(malas.length ? 1 : 0);
