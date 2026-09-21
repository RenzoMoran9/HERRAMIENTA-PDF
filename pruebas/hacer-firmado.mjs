/* Prepara un PDF con firma digital para las pruebas.

   La firma no es válida —no hay certificado ni resumen de nada— y no
   pretende serlo: lo que se comprueba es que el editor la VE y avisa antes
   de que alguien la invalide sin querer. Para eso basta con que el campo
   esté donde tiene que estar.

   Uso:  node pruebas/hacer-firmado.mjs                                  */
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from '../lib/mupdf.js';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const crudo = fs.readFileSync(path.join(AQUI, 'postores.pdf'));

/** Un hueco para firmar, sin firmar todavía: campo de firma SIN valor. Eso
 *  no es una firma puesta y no tiene que avisar de nada. */
function hueco() {
  const d = mupdf.PDFDocument.openDocument(crudo, 'application/pdf');
  const rect = d.newArray();
  [400, 60, 560, 110].forEach((n) => rect.push(d.newReal(n)));
  const campo = d.newDictionary();
  campo.put('FT', d.newName('Sig'));
  campo.put('T', d.newString('FirmaPendiente'));
  campo.put('Type', d.newName('Annot'));
  campo.put('Subtype', d.newName('Widget'));
  campo.put('Rect', rect);
  campo.put('F', d.newInteger(4));
  const ref = d.addObject(campo);
  const campos = d.newArray();
  campos.push(ref);
  const acro = d.newDictionary();
  acro.put('Fields', campos);
  acro.put('SigFlags', d.newInteger(3));
  d.getTrailer().get('Root').put('AcroForm', d.addObject(acro));
  fs.writeFileSync(path.join(AQUI, 'firma-vacia.pdf'), Buffer.from(d.saveToBuffer('').asUint8Array()));
  console.log('firma-vacia.pdf listo · un hueco para firmar, sin firmar');
}

const d = mupdf.PDFDocument.openDocument(crudo, 'application/pdf');

const valor = d.newDictionary();
valor.put('Type', d.newName('Sig'));
valor.put('Filter', d.newName('Adobe.PPKLite'));
valor.put('SubFilter', d.newName('adbe.pkcs7.detached'));
valor.put('Name', d.newString('Juan Perez'));
valor.put('M', d.newString('D:20260101120000Z'));

const rect = d.newArray();
[400, 60, 560, 110].forEach((n) => rect.push(d.newReal(n)));

const campo = d.newDictionary();
campo.put('FT', d.newName('Sig'));
campo.put('T', d.newString('Firma1'));
campo.put('V', d.addObject(valor));
campo.put('Type', d.newName('Annot'));
campo.put('Subtype', d.newName('Widget'));
campo.put('Rect', rect);
campo.put('F', d.newInteger(4));
const ref = d.addObject(campo);

const hoja = d.loadPage(0).getObject();
const anots = d.newArray();
const tenia = hoja.get('Annots');
if (tenia && tenia.isArray()) for (let i = 0; i < tenia.length; i++) anots.push(tenia.get(i));
anots.push(ref);
hoja.put('Annots', anots);

const campos = d.newArray();
campos.push(ref);
const acro = d.newDictionary();
acro.put('Fields', campos);
acro.put('SigFlags', d.newInteger(3));
d.getTrailer().get('Root').put('AcroForm', d.addObject(acro));

const buf = d.saveToBuffer('');
fs.writeFileSync(path.join(AQUI, 'firmado.pdf'), Buffer.from(buf.asUint8Array()));
console.log('firmado.pdf listo ·', d.countPages(), 'hojas · 1 firma');
hueco();
