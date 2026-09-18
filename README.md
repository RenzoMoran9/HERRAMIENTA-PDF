# Grapa · Editor de texto

Corrige el texto de un PDF **dentro del propio archivo**: no tapa la palabra vieja
con un recuadro blanco, la quita de verdad y escribe la nueva en la misma línea
base, con la misma tipografía, el mismo tamaño y el mismo color.

Es el compañero de [Grapa](https://github.com/RenzoMoran9/GRAPA). Grapa arma el
expediente; el Editor arregla una palabra suelta cuando hace falta.

---

## Cómo se usa

**En el trabajo, sin instalar nada:** descarga `GrapaEditor.html`, guárdalo
**al lado de `Grapa.html`** y ábrelo con doble clic. Es un solo archivo: funciona
sin internet y sin servidor.

Desde Grapa, el botón **Editar texto** lo abre y le pasa el documento; al
terminar, **Devolver a Grapa** lo manda de vuelta corregido. El documento viaja
de una pestaña a otra, en memoria: no se sube a ningún sitio.

También sirve suelto: arrastra un PDF encima y listo.

### Editar un renglón

1. Haz clic sobre el renglón que quieras corregir.
2. Escribe el texto nuevo.
3. `Enter` para aplicar, `Esc` para dejarlo como estaba.

Cada cambio queda anotado en la columna de la izquierda, y `Ctrl+Z` deshace.

---

## Lo que hace y lo que todavía no

**Lo que hace bien**

- Quita el texto viejo del archivo de verdad (no lo tapa): si alguien copia y
  pega del PDF, sale el texto nuevo.
- Respeta posición, tipografía, tamaño y color del original.
- Si el texto nuevo es más largo, lo aprieta hasta el ancho que ocupaba el
  viejo (nunca por debajo del 75 %) para que no invada lo que tiene al lado, y
  te dice a cuánto lo apretó.
- **Comprueba cada cambio antes de darlo por bueno**: vuelve a abrir el archivo
  resultante, mide dónde quedó el texto y verifica que no se haya llevado por
  delante ningún renglón vecino. Si algo no cuadra, deshace solo y te lo dice.

**Lo que todavía no**

- Hojas giradas (`/Rotate` distinto de cero): te avisa y no toca nada.
- Renglones que mezclan varias tipografías o tamaños: deja escribir, pero
  advierte antes, porque el renglón se reescribe con la tipografía de su
  primera letra.
- **Corregir lo que dice un escaneo.** Habría que borrar píxeles y dibujar
  encima, y el resultado ya no sería copia fiel del papel que se escaneó. En
  un expediente de contratación eso importa, así que el editor no lo hace.
  Para escribir *encima* —una nota, un «COPIA FIEL», un sello— está
  **Sello y marcas** en Grapa, que añade el texto sin tocar el escaneo.
- Borrar un renglón entero.
- La tipografía que se escribe es la equivalente estándar (las catorce que
  todo lector de PDF trae de serie), no la copia incrustada del original.
  Se elige respetando **negrita, cursiva, gracias y monoespaciado**, y
  cuando hay sustitución se dice cuál se usó en la lista de cambios. En
  documentos corrientes —Arial, Calibri, Times— no se nota; en una
  tipografía con personalidad, sí.

---

## Escaneos: reconocer el texto

Una hoja escaneada es una fotografía del papel: por dentro no tiene letras,
solo píxeles. El editor lo dice al abrirla y ofrece **Reconocer el texto**.

Lo que hace es leer la foto y dejar lo leído en una **capa de texto invisible**,
palabra por palabra y cada una en su sitio. La foto **no se toca** —la prueba
lo comprueba píxel a píxel—, pero el PDF pasa a poder **buscarse y copiarse**,
también fuera de aquí: en Acrobat, en el gestor documental, donde sea.

Va en español, tarda un par de segundos por hoja, y funciona **sin internet**:
el motor y el idioma viajan dentro del propio archivo.

Una hoja ya reconocida queda marcada y **no se vuelve corregible**. No es una
manera de decir que no: si se corrigiera esa capa, la foto seguiría diciendo lo
de antes y el documento mostraría una cifra y copiaría otra. Eso no es un
documento corregido, es un documento roto.

El reconocimiento se equivoca a veces —confunde `I` con `l`, sobre todo—, así
que conviene mirarlo antes de fiarse. El editor dice con qué confianza leyó.

---

## Para desarrollar

```bash
node servidor.mjs             # http://localhost:8123
node construir.mjs            # genera GrapaEditor.html, el archivo suelto
node pruebas/editar.mjs       # edita y comprueba el resultado, servido
node pruebas/suelto.mjs       # lo mismo con el archivo suelto, sin red
node pruebas/subconjunto.mjs  # un PDF impreso por Chrome, con tipografías
                              # en subconjunto: negrita, cursiva, Times y Courier
node pruebas/escaneo.mjs      # una hoja escaneada: que se explique, no que
                              # se quede muda
node pruebas/reconocer.mjs    # reconocer un escaneo: texto buscable donde no
                              # había nada, y la foto intacta píxel a píxel
node pruebas/suelto-ocr.mjs   # lo mismo desde el disco, con el navegador sin red
node pruebas/hacer-escaneo.mjs pruebas/postores.pdf pruebas/escaneo.pdf
node pruebas/hacer-correo.mjs pruebas/correo.pdf   # rehace ese PDF de prueba
```

---

## Licencia

Este programa es **software libre bajo la [AGPL-3.0-or-later](LICENSE)**, porque
usa [MuPDF](https://mupdf.com) de Artifex Software, que se distribuye con esa
licencia. El reconocimiento de texto usa
[Tesseract](https://github.com/naptha/tesseract.js), que es Apache-2.0 y por
tanto compatible; sus avisos están en [`lib/ocr/AVISOS.txt`](lib/ocr/AVISOS.txt).

En corto: puedes usarlo, copiarlo y modificarlo libremente. Si repartes una
versión modificada —o la pones en una web para que otros la usen— tienes que
publicar también tu código, bajo la misma licencia.

El texto completo está en [`LICENSE`](LICENSE); el aviso original de MuPDF, en
[`lib/LICENCIA-MUPDF`](lib/LICENCIA-MUPDF).

> **La licencia cubre este programa, no tus documentos.** Los expedientes que
> abras aquí son tuyos y no salen de tu equipo: el editor no tiene servidor, no
> envía nada y funciona sin internet.

Grapa, en cambio, no lleva MuPDF dentro: solo abre este editor en otra pestaña.
Por eso Grapa sigue siendo un programa aparte y no queda sujeto a esta licencia.
