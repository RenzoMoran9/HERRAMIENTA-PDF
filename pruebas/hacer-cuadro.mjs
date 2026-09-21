/* Un escaneo de una cotización CON CUADRO: cabecera de color, rayas, y un
   precio metido en su celda. Es la forma que tienen las cotizaciones de
   verdad y donde el editor se rompía: el recuadro que da el reconocimiento
   se lleva por delante la raya de abajo y las cabezas del renglón
   siguiente, y con eso el renglón corregido salía al doble de tamaño y el
   parche se comía el borde de la celda.

   Los nombres y los números son inventados.
   Uso:  node pruebas/hacer-cuadro.mjs                                   */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import * as mupdf from '../lib/mupdf.js';
import fs from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage();
await pag.setContent(`<!doctype html><meta charset="utf-8">
<body style="font-family:Arial,Helvetica,sans-serif;padding:40px;font-size:12px;color:#111">
<p style="margin:0 0 4px"><b>SEÑORES</b></p>
<p style="margin:0 0 4px">ATENCION: OFICINA DE LOGISTICA</p>
<p style="margin:0 0 18px">Presente.-</p>
<p style="margin:0 0 22px">Es grato dirigirme a usted para hacer de su conocimiento que, de acuerdo con los
documentos del procedimiento, mi oferta es la siguiente:</p>
<table style="border-collapse:collapse;width:100%;font-size:12px">
  <tr style="background:#9ccb3b">
    <th style="border:1.5px solid #222;padding:6px 4px;width:36px">N°</th>
    <th style="border:1.5px solid #222;padding:6px 4px">DESCRIPCION</th>
    <th style="border:1.5px solid #222;padding:6px 4px;width:96px">CANTIDAD</th>
    <th style="border:1.5px solid #222;padding:6px 4px;width:104px">PRECIO<br>(S/)</th>
    <th style="border:1.5px solid #222;padding:6px 4px;width:124px">IMPORTE</th>
  </tr>
  <tr>
    <td style="border:1.5px solid #222;padding:10px 4px;text-align:center"><b>1</b></td>
    <td style="border:1.5px solid #222;padding:10px 8px"><b>FILETE ENTERO DE POLLO</b></td>
    <td style="border:1.5px solid #222;padding:10px 4px;text-align:center"><b>800 kg</b></td>
    <td style="border:1.5px solid #222;padding:10px 4px;text-align:center"><b>S/ 27.00</b></td>
    <td style="border:1.5px solid #222;padding:10px 4px;text-align:center"><b>S/ 21,600.00</b></td>
  </tr>
  <tr>
    <td colspan="3" style="border:none"></td>
    <td style="border:1.5px solid #222;padding:8px 4px;text-align:center"><b>TOTAL</b></td>
    <td style="border:1.5px solid #222;padding:8px 4px;text-align:center"><b>S/ 21,600.00</b></td>
  </tr>
</table>
<p style="margin:22px 0 4px">Plazo de Entrega: Según las especificaciones técnicas</p>
<p style="margin:0 0 4px">Garantía: Según vida útil del producto</p>
<p style="margin:0 0 18px">Marca: Ejemplo</p>
<p style="margin:0">Lima, 15 de setiembre del 2026</p>
</body>`);
const temporal = path.join(AQUI, 'cuadro-limpio.pdf');
await pag.pdf({ path: temporal, format: 'A4', printBackground: true });

/* y ahora se convierte en «escaneo»: la hoja pintada como imagen */
const doc = mupdf.PDFDocument.openDocument(new Uint8Array(fs.readFileSync(temporal)), 'application/pdf');
const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
const b64 = Buffer.from(pix.asPNG()).toString('base64');
await pag.setContent(`<style>html,body{margin:0;padding:0}img{width:210mm;height:297mm;object-fit:contain;display:block}</style>
<img src="data:image/png;base64,${b64}">`);
await pag.pdf({ path: path.join(AQUI, 'cuadro.pdf'), format: 'A4',
  margin: { top: '0', bottom: '0', left: '0', right: '0' }, printBackground: true });
await nav.close();
console.log('cuadro.pdf listo · cotización escaneada con cuadro');
