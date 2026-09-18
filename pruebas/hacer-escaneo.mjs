/* Un "escaneo": la hoja pintada como imagen y metida en un PDF, que es
   exactamente lo que sale de un escáner. Sin datos de nadie. */
import * as mupdf from '/tmp/claude-0/-home-user-PRUEBAS/c817bb0b-706b-5ee2-a31a-ebc8dc4c33ff/scratchpad/grapa-editor/lib/mupdf.js';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const doc = mupdf.PDFDocument.openDocument(new Uint8Array(fs.readFileSync(process.argv[2])), 'application/pdf');
const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
const b64 = Buffer.from(pix.asPNG()).toString('base64');
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage();
await pag.setContent(`<style>html,body{margin:0;padding:0}img{width:210mm;height:297mm;object-fit:contain;display:block}</style>
<img src="data:image/png;base64,${b64}">`);
await pag.pdf({ path: process.argv[3], format: 'A4', margin: { top:'0', bottom:'0', left:'0', right:'0' }, printBackground: true });
await nav.close();
