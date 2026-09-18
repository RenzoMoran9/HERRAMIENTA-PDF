/* Servidor mínimo para trabajar en el editor sin empaquetarlo.
   Uso:  node servidor.mjs        (o PUERTO=8080 node servidor.mjs)   */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const aqui = path.dirname(new URL(import.meta.url).pathname);
const PUERTO = Number(process.env.PUERTO || 8123);
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
};

http.createServer((pet, res) => {
  const limpia = decodeURIComponent(pet.url.split('?')[0]);
  const rel = limpia === '/' ? 'index.html' : limpia.replace(/^\/+/, '');
  const archivo = path.join(aqui, rel);
  if (!archivo.startsWith(aqui)) { res.writeHead(403); res.end('no'); return; }
  let cuerpo = null;
  try { cuerpo = fs.readFileSync(archivo); } catch (e) {}
  if (!cuerpo) { res.writeHead(404); res.end('No está: ' + rel); return; }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
  res.end(cuerpo);
}).listen(PUERTO, () => console.log('Editor en http://localhost:' + PUERTO));
