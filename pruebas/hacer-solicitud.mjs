/* Un correo de solicitud de cotización impreso por Chrome desde Gmail:
   párrafos justificados que parten en varios renglones, y dentro de un
   mismo renglón negrita, cursiva, subrayado y enlaces de color. Es la
   forma que tienen los documentos de trabajo de verdad, y la que hacía
   fallar al editor.

   Los nombres, correos y números son inventados.
   Uso:  node pruebas/hacer-solicitud.mjs                                */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage();
await pag.setContent(`<!doctype html><meta charset="utf-8">
<body style="font-family:Arial,Helvetica,sans-serif;padding:34px;font-size:11px;color:#202124">
<div style="display:flex;justify-content:space-between;font-size:8px;color:#5f6368;border-bottom:1px solid #ddd;padding-bottom:6px">
  <span>21/9/26, 12:04 p.m.</span>
  <span>Correo - EXP.11368 // SOLICITO COTIZACION URGENTE PARA EL REQUERIMIENTO</span>
</div>
<h1 style="font-size:13px;margin:16px 0 8px">EXP.11368 // SOLICITO COTIZACION URGENTE PARA EL REQUERIMIENTO DE
  DETERGENTE GRANULADO INDUSTRIAL DE 15KG</h1>
<p style="font-size:9px;margin:0 0 2px"><b>Area de Logistica</b> &lt;logistica@ejemplo.com&gt;
  <span style="float:right">18 de septiembre de 2026 a las 4:05 p.m.</span></p>
<p style="font-size:8px;color:#333;margin:0 0 14px">CC: compras1@ejemplo.com, compras2@ejemplo.com,
  ventas@proveedoruno.com, contacto@proveedordos.com, info@proveedortres.com</p>
<p style="margin:0 0 10px">Adjuntar el anexo firmado.</p>
<p style="margin:0 0 10px">Señores:</p>
<p style="margin:0 0 14px">Proveedores</p>
<p style="text-align:justify;margin:0 0 12px">Sirva la presente para saludarlos e informarle que la Entidad
  solicita la cotización <u><b>URGENTE</b></u> Para: <span style="color:#1155cc;font-style:italic;font-weight:bold">“ADQ.
  DE DETERGENTE GRANULADO INDUSTRIAL DE 15KG”</span>. La cual deberá considerar todos los conceptos que sean
  aplicables, conforme al mercado específico de la adquisición.</p>
<p style="margin:0 0 10px">1. Para presentar su cotización deberá tener en cuenta los siguientes requisitos:</p>
<p style="text-align:justify;margin:0 0 10px">1.1. Remitir su <u>oferta técnico - económica</u> (incluyendo los
  impuestos de ley y cualquier otro concepto que incide en el precio), indicando: (i) Plazo de entrega,
  (ii) Garantía, (iii) Forma de pago, (iv) Indicar que cumple con las <span style="color:#1155cc">EE.TT</span>.</p>
<p style="text-align:justify;margin:0 0 10px">1.2. La Cotización deberá ser dirigida a la Entidad con atención
  a la Oficina de Logística</p>
<p style="margin:0 0 10px">1.3. El plazo máximo de envío de su cotización es hasta el día
  <u style="color:#1155cc"><b>LUNES 21-09-2026, hasta las 16:00 horas.</b></u></p>
<p style="margin:0 0 10px">1.4. Se debe adjuntar la cotización de las <span style="color:#1155cc">EE.TT</span>. solicitadas.</p>
<p style="margin:0 0 10px"><b>1.5. Cumplir con Plazo de entrega y Garantía según las
  <span style="color:#1155cc">EE.TT</span>.</b></p>
<p style="margin:0 0 10px"><b>1.6. Adjuntar BPA, BPM, REGISTRO SANITARIO, ETC. (DE CORRESPONDER)</b></p>
<p style="margin:0 0 10px">2. Para formalizar la Contratación deberá tener en cuenta las siguientes recomendaciones:</p>
<p style="text-align:justify;margin:0 0 10px">2.1. Una vez que la Entidad le comunique que su representada ha sido
  favorecida con la contratación, por este medio deberá remitir <u>la documentación que acredite que cumple con el
  perfil mínimo establecido en los Términos de Referencia o Especificaciones Técnicas, según corresponda</u></p>
<p style="text-align:justify;margin:0 0 10px">2.2. Contar con inscripción vigente en el Registro Nacional de
  Proveedores – RNP emitido por el OECE (Este requisito deberá ser cumplido cuando la contratación supere una UIT)</p>
<p style="margin:0 0 10px">2.3. Contar con Código de Cuenta Interbancaria – CCI, el cual debe estar vinculado con el RUC.</p>
<p style="margin:0 0 10px">2.4. Plazo de entrega — máximo 10 días • penalidad según contrato…</p>
<p style="margin:0 0 10px">Adjuntar el anexo firmado.</p>
<p style="margin:0 0 10px;font-style:italic">Agradeciendo su atención, quedamos a la espera de su respuesta.</p>
<p style="margin:0;font-family:'Courier New',monospace;font-size:9px">EXP-11368-2026 · OFICINA DE LOGISTICA</p>
</body>`);
await pag.pdf({ path: path.join(AQUI, 'solicitud.pdf'), format: 'A4', printBackground: true });
await nav.close();
console.log('solicitud.pdf listo');
