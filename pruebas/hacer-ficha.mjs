/* Un cuadro SIN rayas entre columnas, como el de una ficha RUC o un reporte
   impreso por un sistema: solo un marco por fuera, las columnas separadas
   por espacio en blanco, celdas de dos líneas pegadas a otras de una, letra
   negrita y pequeña. Escaneado a 300 ppp. Todo inventado.

     node pruebas/hacer-ficha.mjs   →   pruebas/ficha.pdf

   El reconocedor leía cada fila de lado a lado como un solo renglón: al
   corregir una celda se reescribía la fila entera encima de las demás
   columnas, y el renglón mezclado con la segunda línea de las celdas de al
   lado se medía al doble de tamaño. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';

// columnas: x del borde izquierdo de cada una, en puntos, y su alineación
export const COLUMNAS_FICHA = [
  { x: 95, alinear: 'izq' },    // Código
  { x: 130, alinear: 'izq' },   // Tipo
  { x: 250, alinear: 'centro', ancho: 70 },   // Ubigeo
  { x: 330, alinear: 'centro', ancho: 150 },  // Domicilio
  { x: 490, alinear: 'izq' },   // Condición
];
// cada fila: una celda por columna; una celda con « / » va en dos líneas
export const FILAS_FICHA = [
  ['Codigo', 'Tipo', 'Ubigeo', 'Domicilio', 'Condicion'],
  ['0101', 'DEPOSITO', 'LIMA LIMA PUNTA / HERMOSA', 'CAR. SUR KM 40 LOTE 7', 'ALQUILADO'],
  ['0102', 'OFICINA', 'LIMA LIMA SAN / ISIDRO', 'AV. EJEMPLO 1234 / Int 501', 'PROPIO'],
  ['0103', 'DEPOSITO', 'LIMA LIMA / SURCO', 'CALLE FICTICIA 88', 'ALQUILADO'],
];
export const PARRAFO_FICHA = 'Documento emitido a traves de SOL - Sistema de Ejemplo, con validez para tramites.';

const AQUI = path.dirname(new URL(import.meta.url).pathname);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pag = await nav.newPage();
  const jpg = await pag.evaluate(({ columnas, filas, parrafo }) => {
    const K = 300 / 72, W = Math.round(595 * K), H = Math.round(842 * K);
    let semilla = 29;
    const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(245,245,243)'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#0a0a0a';
    const PT = 7.5;
    x.font = 'bold ' + PT * K + 'px "DejaVu Sans", Verdana, sans-serif';
    const escribir = (t, col, y) => {
      const ancho = x.measureText(t).width / K;
      const cx = col.alinear === 'centro' ? col.x + (col.ancho - ancho) / 2 : col.x;
      x.fillText(t, cx * K, y * K);
    };
    let y = 120;
    for (const fila of filas) {
      const dos = fila.some((t) => t.includes(' / '));
      fila.forEach((t, i) => {
        const partes = t.split(' / ');
        if (partes.length === 2) { escribir(partes[0], columnas[i], y); escribir(partes[1], columnas[i], y + PT * 1.2); }
        else escribir(t, columnas[i], y + (dos ? PT * 0.6 : 0));
      });
      y += dos ? PT * 3.2 : PT * 2.2;
    }
    // el marco de fuera, sin rayas entre columnas
    x.lineWidth = 1.2 * K / 3;
    x.strokeStyle = '#0a0a0a';
    x.strokeRect(88 * K, 108 * K, 470 * K, (y - 110) * K);
    x.font = PT * K + 'px "DejaVu Sans", Verdana, sans-serif';
    x.fillText(parrafo, 95 * K, (y + 20) * K);
    const img = x.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (azar() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  }, { columnas: COLUMNAS_FICHA, filas: FILAS_FICHA, parrafo: PARRAFO_FICHA });
  await pag.setContent(`<style>html,body{margin:0;padding:0}img{width:210mm;height:297mm;display:block}</style><img src="${jpg}">`);
  await pag.pdf({ path: path.join(AQUI, 'ficha.pdf'), format: 'A4', margin: { top: '0', bottom: '0', left: '0', right: '0' }, printBackground: true });
  await nav.close();
  console.log('pruebas/ficha.pdf listo');
}
