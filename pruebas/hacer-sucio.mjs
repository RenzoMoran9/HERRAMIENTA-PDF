/* Escaneos en malas condiciones, como los que llegan de verdad: la hoja
   entró torcida en el escáner, el papel sale gris y desparejo (más oscuro
   hacia un lado) y está lleno de motitas. Todo inventado.

     node pruebas/hacer-sucio.mjs   →   pruebas/sucio.pdf

   Son cuatro hojas con el mismo texto (TEXTO_SUCIO, para que la prueba
   pueda medir cuánto se lee bien) y distinta suciedad: tres torcidas hacia
   un lado u otro y una derecha, que NO se debe enderezar. Una sola hoja no
   basta para medir: el reconocimiento acierta o falla una palabra por
   cualquier motita, y una hoja sola puede salir de las fáciles o de las
   difíciles. Las motitas y el grano salen de un sorteo con semilla fija:
   el archivo sale igual cada vez. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';

// cómo entró cada hoja: grados a favor del reloj, cuántas motitas y lo
// oscuro que es el papel en su esquina más oscura
export const HOJAS_SUCIO = [
  { semilla: 11, grados: 2.5, motas: 2600, oscuro: 178 },
  { semilla: 22, grados: -1.8, motas: 1200, oscuro: 190 },
  { semilla: 44, grados: -3, motas: 2000, oscuro: 200 },
  { semilla: 66, grados: 0, motas: 1500, oscuro: 185 },
];
export const TEXTO_SUCIO = [
  'INFORME DE CONFORMIDAD 045-2026',
  'Area usuaria: Servicio de Farmacia',
  'Proveedor: DISTRIBUIDORA LOS ANDES EIRL',
  'RUC 20512345678',
  'Orden de compra 1187 del 14 de agosto',
  'Se recibieron cuarenta cajas de guantes',
  'de nitrilo talla mediana, en buen estado,',
  'dentro del plazo y conforme a lo pedido.',
  'Importe total 3,480.50 soles',
  'Firma el jefe del servicio de ejemplo',
];

const AQUI = path.dirname(new URL(import.meta.url).pathname);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pag = await nav.newPage();
  const jpgs = [];
  for (const h of HOJAS_SUCIO) jpgs.push(await pag.evaluate(({ lineas, grados, semillaIni, motas, oscuro }) => {
    const W = 1240, H = 1754;                 // A4 a 150 ppp
    let semilla = semillaIni;
    const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };

    // 1. la hoja limpia
    const hoja = document.createElement('canvas');
    hoja.width = W; hoja.height = H;
    const h = hoja.getContext('2d');
    h.fillStyle = '#fff'; h.fillRect(0, 0, W, H);
    h.fillStyle = '#141414';
    h.font = 'bold 34px "Liberation Sans", Arial, sans-serif';
    h.fillText(lineas[0], 150, 230);
    h.font = '25px "Liberation Serif", "Times New Roman", serif';
    lineas.slice(1).forEach((t, i) => h.fillText(t, 150, 330 + i * 62 + (i >= 4 ? 30 : 0) + (i >= 8 ? 30 : 0)));

    // 2. el papel: gris y desparejo, más oscuro a la izquierda y abajo
    const sal = document.createElement('canvas');
    sal.width = W; sal.height = H;
    const s = sal.getContext('2d');
    const g = s.createLinearGradient(0, H, W, 0);
    g.addColorStop(0, `rgb(${oscuro},${oscuro - 2},${oscuro - 8})`);
    g.addColorStop(1, 'rgb(222,220,214)');
    s.fillStyle = g; s.fillRect(0, 0, W, H);

    // 3. la hoja entra torcida: se multiplica sobre el papel, así la letra
    //    oscurece el gris y el blanco deja ver el papel
    s.globalCompositeOperation = 'multiply';
    s.translate(W / 2, H / 2);
    s.rotate((grados * Math.PI) / 180);
    s.translate(-W / 2, -H / 2);
    s.drawImage(hoja, 0, 0);
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';

    // 4. motitas: polvo del cristal y del papel
    for (let i = 0; i < motas; i++) {
      const r = 0.5 + azar() * 1.3;
      s.fillStyle = `rgba(30,30,30,${0.55 + azar() * 0.45})`;
      s.beginPath(); s.arc(azar() * W, azar() * H, r, 0, Math.PI * 2); s.fill();
    }

    // 5. grano
    const img = s.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (azar() - 0.5) * 26;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    s.putImageData(img, 0, 0);
    return sal.toDataURL('image/jpeg', 0.72);
  }, { lineas: TEXTO_SUCIO, grados: h.grados, semillaIni: h.semilla, motas: h.motas, oscuro: h.oscuro }));

  await pag.setContent(`<style>html,body{margin:0;padding:0}img{width:210mm;height:297mm;display:block;break-after:page}</style>
${jpgs.map((j) => `<img src="${j}">`).join('')}`);
  await pag.pdf({ path: path.join(AQUI, 'sucio.pdf'), format: 'A4', margin: { top: '0', bottom: '0', left: '0', right: '0' }, printBackground: true });
  await nav.close();
  console.log('pruebas/sucio.pdf listo');
}
