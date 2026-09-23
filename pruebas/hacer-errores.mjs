/* Escaneos con lo que más se lee mal en un expediente de contrataciones:
   montos en soles («S/ 1,250.00»), números de documento («N° 128-2026») y
   títulos en mayúsculas con «DE» entre medias. Todo inventado.

     node pruebas/hacer-errores.mjs   →   pruebas/errores.pdf

   Cuatro hojas con el mismo texto (TEXTO_ERRORES): una limpia y tres
   escaneadas a poca resolución y con la foto muy comprimida, en letras
   distintas. Así salen los errores que el reconocimiento repite de verdad
   —N* por N°, 5/ o 51 por S/—, no los de una sola letra. Los dos últimos
   renglones son trampas: no se deben «corregir». */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';

export const TEXTO_ERRORES = [
  'CARTA N° 128-2026-HNAL-OL',
  'SOLICITUD DE COTIZACION DE BIENES',
  'EXPEDIENTE N° 10488',
  'ORDEN DE COMPRA N° 0456',
  'Precio unitario: S/ 18.90',
  'Monto total: S/ 1,250.00',
  'Son: S/ 12,480.50 soles',
  'Adelanto S/ 850.00 y saldo S/ 400.00',
  'CUADRO COMPARATIVO DE PRECIOS',
  'Si el postor no cumple, se descalifica.',
  'Informe N° 45 de la Unidad de Logistica',
  'RESOLUCION DIRECTORAL N° 312-2026',
  'Item 51 12,480.50 segun anexo',
  'Pagina 5 de 12',
];

// cada hoja: letra, tamaño en píxeles a 150 ppp, si va en negrita, a qué
// parte de 150 ppp se escanea (0,66 son unos 100 ppp) y la calidad de la foto
export const HOJAS_ERRORES = [
  { letra: '"Liberation Sans", Arial, sans-serif', px: 23, negrita: false, semilla: 7, esc: 1, calidad: 0.6 },
  { letra: '"Liberation Sans", Arial, sans-serif', px: 18, negrita: false, semilla: 1, esc: 0.66, calidad: 0.45 },
  { letra: '"Liberation Sans", Arial, sans-serif', px: 16, negrita: true, semilla: 3, esc: 0.66, calidad: 0.45 },
  { letra: '"DejaVu Sans", sans-serif', px: 17, negrita: false, semilla: 5, esc: 0.55, calidad: 0.45 },
];

const AQUI = path.dirname(new URL(import.meta.url).pathname);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pag = await nav.newPage();
  const jpgs = [];
  for (const h of HOJAS_ERRORES) jpgs.push(await pag.evaluate(({ lineas, letra, px, negrita, semillaIni, esc, calidad }) => {
    const W = Math.round(1240 * esc), H = Math.round(1754 * esc);
    let semilla = semillaIni;
    const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(238,236,230)'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#1a1a1a';
    x.font = (negrita ? 'bold ' : '') + (px * esc) + 'px ' + letra;
    lineas.forEach((t, i) => x.fillText(t, 140 * esc, (220 + i * px * 2.6) * esc));
    const img = x.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (azar() - 0.5) * 30;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', calidad);
  }, { lineas: TEXTO_ERRORES, letra: h.letra, px: h.px, negrita: h.negrita, semillaIni: h.semilla, esc: h.esc, calidad: h.calidad }));
  await pag.setContent(`<style>html,body{margin:0;padding:0}img{width:210mm;height:297mm;display:block;break-after:page}</style>
${jpgs.map((j) => `<img src="${j}">`).join('')}`);
  await pag.pdf({ path: path.join(AQUI, 'errores.pdf'), format: 'A4', margin: { top: '0', bottom: '0', left: '0', right: '0' }, printBackground: true });
  await nav.close();
  console.log('pruebas/errores.pdf listo');
}
