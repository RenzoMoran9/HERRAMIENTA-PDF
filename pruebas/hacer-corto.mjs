/* Renglones CORTOS y en NEGRITA, a letra pequeña: lo típico del pie de una
   constancia o de una ficha impresa por un sistema («Fecha:25/03/2021»,
   «Hora:11:31», «Importante»). Escaneado a 300 ppp. Todo inventado.

     node pruebas/hacer-corto.mjs   →   pruebas/corto.pdf

   En un renglón así, la parte de abajo de las letras llena casi todo el
   ancho del renglón, y el editor la tomaba por la RAYA de un cuadro: medía
   la letra más chica de lo que era y el papel con el que tapa lo viejo no
   llegaba hasta abajo, así que asomaban los restos del texto de antes.
   Abajo va un cuadro de verdad, cuyas rayas sí tienen que seguir siendo
   rayas. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';

export const RENGLONES_CORTOS = [
  // [texto, tamaño en puntos, negrita]
  ['Importante', 8, true],
  ['La entidad se reserva el derecho de verificar lo declarado.', 8, false],
  ['DEPENDENCIA DE EJEMPLO', 7.5, true],
  ['Fecha:25/03/2021', 7.5, true],
  ['Hora:11:31', 7.5, true],
];

const AQUI = path.dirname(new URL(import.meta.url).pathname);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pag = await nav.newPage();
  const jpg = await pag.evaluate((renglones) => {
    const PPP = 300, K = PPP / 72;
    const W = Math.round(595 * K), H = Math.round(842 * K);
    let semilla = 17;
    const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(246,246,244)'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#0a0a0a';
    let y = 120;
    for (const [t, pt, negrita] of renglones) {
      x.font = (negrita ? 'bold ' : '') + (pt * K) + 'px "DejaVu Sans", Verdana, sans-serif';
      x.fillText(t, 90 * K, y * K);
      y += pt * 1.9;
    }
    // un cuadro de verdad, con sus rayas, debajo
    x.lineWidth = 1.2;
    x.strokeStyle = '#0a0a0a';
    const top = 220, alto = 16, cols = [90, 170, 300, 420];
    for (let f = 0; f <= 2; f++) { x.beginPath(); x.moveTo(90 * K, (top + f * alto) * K); x.lineTo(420 * K, (top + f * alto) * K); x.stroke(); }
    for (const cx of cols) { x.beginPath(); x.moveTo(cx * K, top * K); x.lineTo(cx * K, (top + 2 * alto) * K); x.stroke(); }
    x.font = 'bold ' + (7.5 * K) + 'px "DejaVu Sans", Verdana, sans-serif';
    x.fillText('0003', 96 * K, (top + 11) * K);
    x.fillText('DEPOSITO', 176 * K, (top + 11) * K);
    x.fillText('ALQUILADO', 306 * K, (top + 11) * K);
    x.fillText('0004', 96 * K, (top + alto + 11) * K);
    x.fillText('OFICINA', 176 * K, (top + alto + 11) * K);
    x.fillText('PROPIO', 306 * K, (top + alto + 11) * K);
    const img = x.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (azar() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  }, RENGLONES_CORTOS);
  await pag.setContent(`<style>html,body{margin:0;padding:0}img{width:210mm;height:297mm;display:block}</style><img src="${jpg}">`);
  await pag.pdf({ path: path.join(AQUI, 'corto.pdf'), format: 'A4', margin: { top: '0', bottom: '0', left: '0', right: '0' }, printBackground: true });
  await nav.close();
  console.log('pruebas/corto.pdf listo');
}
