/* Prepara los archivos de prueba con hojas GIRADAS.

   Una hoja girada de verdad no es una hoja puesta de lado: es una hoja que
   por dentro está de lado y lleva la orden de enderezarse al mostrarse. Es
   lo que sale de meter el papel torcido en el escáner y corregirlo después,
   y por eso llega tan a menudo.

   Así que aquí se gira el CONTENIDO noventa grados, se pone el MediaBox
   tumbado y se añade el /Rotate que lo devuelve a su sitio: la hoja se
   sigue viendo exactamente igual que la de partida, pero por dentro está
   girada.

   Uso:  node pruebas/hacer-girado.mjs                                   */
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from '../lib/mupdf.js';

const AQUI = path.dirname(new URL(import.meta.url).pathname);

/** Envuelve el contenido en un giro y ajusta la caja y el /Rotate. */
function girar(doc, pagina, grados) {
  const obj = pagina.getObject();
  const mb = obj.get('MediaBox');
  const v = [0, 1, 2, 3].map((i) => mb.get(i).asNumber());
  const W = Math.abs(v[2] - v[0]), H = Math.abs(v[3] - v[1]);

  // el giro del contenido y la caja que le corresponde
  const matriz = { 90: `0 -1 1 0 0 ${W}`, 180: `-1 0 0 -1 ${W} ${H}`, 270: `0 1 -1 0 ${H} 0` }[grados];
  const caja = grados === 180 ? [0, 0, W, H] : [0, 0, H, W];

  const abre = new mupdf.Buffer(); abre.writeLine('q ' + matriz + ' cm');
  const cierra = new mupdf.Buffer(); cierra.writeLine('Q');
  const arr = doc.newArray();
  arr.push(doc.addStream(abre, {}));
  const cont = obj.get('Contents');
  if (cont.isArray()) { for (let i = 0; i < cont.length; i++) arr.push(cont.get(i)); }
  else arr.push(cont);
  arr.push(doc.addStream(cierra, {}));
  obj.put('Contents', arr);

  const nueva = doc.newArray();
  caja.forEach((n) => nueva.push(doc.newReal(n)));
  obj.put('MediaBox', nueva);
  // el giro que la devuelve a como se veía
  obj.put('Rotate', doc.newInteger((360 - grados) % 360));
}

function hacer(origen, destino, giros) {
  const d = mupdf.PDFDocument.openDocument(fs.readFileSync(path.join(AQUI, origen)), 'application/pdf');
  for (let i = 0; i < d.countPages(); i++) girar(d, d.loadPage(i), giros[i % giros.length]);
  const buf = d.saveToBuffer('');
  fs.writeFileSync(path.join(AQUI, destino), Buffer.from(buf.asUint8Array()));
  console.log(destino, '·', d.countPages(), 'hojas · giradas', giros.join('/') + '°');
}

hacer('postores.pdf', 'girado.pdf', [90, 180, 270, 90, 180]);
hacer('escaneo.pdf', 'escaneo-girado.pdf', [90]);
