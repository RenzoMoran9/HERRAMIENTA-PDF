/* Un PDF impreso por Chrome, como los que salen de Gmail: tipografías
   incrustadas en subconjunto, con el prefijo de seis letras. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage();
await pag.setContent(`<!doctype html><meta charset="utf-8">
<body style="font-family:Arial,Helvetica,sans-serif;padding:40px">
<p style="font-size:10px;color:#555">14/9/26, 11:04 a.m.</p>
<h1 style="font-size:16px">SOLICITO ACTUALIZACION DE COTIZACION - EXP. 10009</h1>
<p style="font-size:12px"><b>DISTRIBUIDORA EJEMPLO SAC</b> &lt;ventas3@ejemplo.com&gt;</p>
<p style="font-size:12px">Buen dia Sr. Juan Perez.</p>
<p style="font-size:12px">Adjunto COTIZACION ACTUALIZADA.</p>
<p style="font-size:12px;font-style:italic">Monto total: S/ 8,400.00</p>
<p style="font-family:'Times New Roman',serif;font-size:12px">Atentamente, el area de ventas.</p>
<p style="font-family:'Courier New',monospace;font-size:11px">EXP-10009-2026</p>
</body>`);
await pag.pdf({ path: process.argv[2], format: 'A4', printBackground: true });
await nav.close();
