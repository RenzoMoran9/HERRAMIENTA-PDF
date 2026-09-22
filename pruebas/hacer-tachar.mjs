/* El documento de la prueba de tachar: una hoja con texto de verdad y la
   misma hoja escaneada, con un nombre, un DNI y una cuenta INVENTADOS.

     node pruebas/hacer-tachar.mjs      → pruebas/tachar.pdf

   Sale igual cada vez: fechas fijas y sin nada al azar. */
import * as mupdf from '../lib/mupdf.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require('../../grapa/lib/pdf-lib.min.js');
const FECHA = new Date('2026-01-01T12:00:00Z');

async function carta() {
  const d = await PDFDocument.create();
  d.setCreationDate(FECHA); d.setModificationDate(FECHA);
  const f = await d.embedFont(StandardFonts.Helvetica);
  const fb = await d.embedFont(StandardFonts.HelveticaBold);
  const p = d.addPage([595, 842]);
  const t = (s, y, o = {}) => p.drawText(s, { x: 72, y, size: o.t || 16, font: o.b ? fb : f, color: rgb(0.05, 0.05, 0.08) });
  t('DECLARACION JURADA DE EJEMPLO', 760, { t: 20, b: true });
  t('Nombre: Juana Perez Quispe', 700);
  t('DNI 45678912', 660);
  t('Cuenta 191-2345678-0-12', 620);
  t('Monto: S/ 1,250.00', 580);
  t('Otra linea que no se toca', 540);
  return d;
}

const texto = await carta();
const bytesTexto = await texto.save();

// la misma hoja «escaneada»: su foto en JPEG, sin texto dentro
const m = mupdf.PDFDocument.openDocument(bytesTexto, 'application/pdf');
const pix = m.loadPage(0).toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
const jpg = pix.asJPEG(88).slice();
const salida = await PDFDocument.load(bytesTexto);
salida.setCreationDate(FECHA); salida.setModificationDate(FECHA);
const img = await salida.embedJpg(jpg);
const hoja = salida.addPage([595, 842]);
hoja.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
const bytes = await salida.save();
fs.writeFileSync(path.join(AQUI, 'tachar.pdf'), bytes);
console.log('tachar.pdf', Math.round(bytes.length / 1024), 'KB');
