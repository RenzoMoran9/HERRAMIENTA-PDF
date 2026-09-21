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

### Borrar un renglón

Pulsa el renglón, **déjalo vacío** y `Enter`. No se tapa con blanco: en una hoja
de texto se quita del archivo, y en una escaneada se cubre con el papel de las
filas de al lado, como al corregir.

### Escribir donde no hay nada

**Insertar** (`Ctrl+I`) y después pulsa el sitio. Se escribe con la
**tipografía, el tamaño y el color del renglón más cercano** de esa hoja —te lo
dice antes de escribir— para que no cante al lado de lo que ya estaba. Donde
pulsas es la línea base, y el texto queda ahí con menos de 2 pt de desvío.

En una hoja escaneada sin reconocer no hay dónde insertar: primero **Reconocer
el texto**, o usa **Sello y marcas** en Grapa, que escribe encima sin tocar el
escaneo.

### Hojas giradas

Una hoja girada no es una hoja puesta de lado: es una hoja que por dentro está
de lado y lleva la orden de enderezarse al mostrarse. Es lo que sale de meter
el papel torcido en el escáner, y por eso llega tan a menudo. Antes el editor
avisaba y no tocaba nada; ahora escribe en ella igual que en cualquier otra,
con los giros de 90, 180 y 270°.

### PDF firmados digitalmente

Si el PDF lleva una firma digital puesta, se dice nada más abrirlo: **cualquier
cambio la invalida** y el documento deja de estar firmado. No se impide editarlo
—a veces se corrige a sabiendas, para volver a firmar— pero no se hace a ciegas.
Un hueco de firma sin firmar no cuenta como firma y no avisa.

### No se pierde el trabajo

Tras cada cambio, el documento y su lista de cambios quedan guardados **en el
navegador de este equipo**. Si se cierra la pestaña sin querer, al volver a
abrir el editor te ofrece **recuperar** lo que llevabas, diciéndote qué era y
de cuándo. Funciona igual desde la web que desde el archivo suelto.

Se guarda aquí y en ningún otro sitio —no hay servidor al que mandarlo—, pero
queda en el equipo hasta que se descarte. Por eso está a la vista y se puede
apagar: **Guardar mi trabajo en este equipo**, abajo en la columna izquierda.
Apagarlo borra en el acto lo que hubiera guardado, que en un ordenador
compartido no es cosa menor.

Y si intentas cerrar con cambios que no has descargado ni devuelto a Grapa, el
navegador pregunta antes.

### Buscar y reemplazar

`Ctrl+F` lleva a la caja de búsqueda. Se busca en **todas las hojas** a la vez
—también en las escaneadas que ya se reconocieron— y los resultados salen en la
columna de la izquierda con lo encontrado resaltado; al pulsar uno se abre su
hoja y se marca el renglón. `Enter` repetido va saltando de uno a otro.

Escribiendo también el texto nuevo, **Todas** los cambia de una vez. Es el caso
para el que se hizo: un número de expediente o una fecha mal puestos que se
repiten en doce hojas.

Dos cosas que conviene saber:

- Los cinco, doce o veinte cambios dejan **un solo paso que deshacer**, no
  veinte: un `Ctrl+Z` los quita todos.
- Un renglón que **mezcla tipografías o tamaños** no lo toca «Todas», porque
  reescribirlo entero con la tipografía de su primera letra estropearía el
  renglón. Queda marcado en la lista para cambiarlo a mano, que es donde sale
  el aviso. Lo mismo con los que fallen por cualquier otro motivo: se dice
  cuántos y por qué.

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

- Renglones que mezclan varias tipografías o tamaños: deja escribir, pero
  advierte antes, porque el renglón se reescribe con la tipografía de su
  primera letra.
- **Devolver un escaneo corregido a su estado original.** La capa se puede
  volver a escribir, pero el editor no guarda el texto que había antes de la
  primera corrección. Dentro de la misma sesión, `Ctrl+Z`.
- **Reproducir una tipografía manuscrita o poco corriente** al corregir un
  escaneo: se escribe con la equivalente estándar, normal o negrita.
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

### Y después se puede corregir

Una vez reconocida, la hoja **sí se corrige**: pulsas un renglón, escribes, y
Grapa lo sustituye copiándole al original todo lo que se puede medir sobre la
propia imagen:

| Se mide en el renglón original | Para qué |
|---|---|
| El color del **papel**, fila a fila | Se tapa con un trozo de papel de verdad, sacado de las filas limpias de al lado y degradado entre ellas. Un rectángulo liso se adivina a la primera. |
| El **corazón del trazo**, no la media de lo oscuro | La media incluye los bordes suavizados y sale medio gris. |
| Lo que ocupa **la tinta**, no el recuadro del reconocimiento | El recuadro es algo mayor, y dejaba la letra crecida. |
| El **grosor del trazo** respecto a la altura | Dice si era negrita mucho mejor que la cantidad de tinta. |
| Lo **blando** que es el borde | Un escaneo tiene el borde difuso; el texto vectorial lo tiene limpio, y esa es la diferencia que más canta. El renglón se compone como imagen con ese mismo desenfoque, y como desenfocar aclara la tinta, se mide lo que sale y se vuelve a componer hasta que el negro coincide. |

Medido sobre una cotización escaneada de verdad, comparando el renglón
corregido con el original:

| | tinta | alto | borde blando |
|---|---|---|---|
| original | 68 | 11,0 pt | 0,234 |
| primera versión | 99 | 12,0 pt | 0,087 |
| ahora | 75 | 11,2 pt | 0,212 |

Lo importante es que cambian **las dos cosas a la vez**: lo que se ve y lo que
se busca. Si solo se tocara la capa invisible, el documento mostraría una cifra
y copiaría otra —eso no sería un documento corregido, sería uno roto—.

Todo lo que Grapa añade vive en **una sola capa**, junto con un modelo guardado
dentro de la propia hoja. La foto original nunca se modifica: lo que tapa es un
recuadro nuestro. Y como el modelo viaja en el archivo, la hoja se puede seguir
corrigiendo después de guardarla, cerrarla o pasarla por Grapa.

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
node pruebas/buscar.mjs       # buscar en las cinco hojas y reemplazar de una
                              # vez: que cambien todas, que no se pierda ningún
                              # renglón y que un Ctrl+Z lo deshaga entero
node pruebas/borrar-insertar.mjs   # borrar un renglón y escribir donde no
                              # había nada, en hoja de texto y en escaneo:
                              # en el escaneo se mide la propia foto
node pruebas/hacer-firmado.mjs # rehace el PDF con firma digital
node pruebas/firmado.mjs      # que avise de la firma antes de tocar nada
node pruebas/hacer-girado.mjs # rehace los archivos de hojas giradas
node pruebas/girado.mjs       # corregir, borrar e insertar en hojas con
                              # /Rotate 90, 180 y 270, y en un escaneo girado
node pruebas/guardado.mjs     # guardar el trabajo y recuperarlo al volver,
                              # por la web y desde el archivo suelto
node pruebas/pasos.mjs        # los botones «−» y «+» del tamaño
node pruebas/todas.mjs        # todas, una detrás de otra
node pruebas/corregir-escaneo.mjs   # corregir un renglón de una foto: comprueba
                                    # que la FOTO también cambia, volviéndola a
                                    # leer con el propio OCR
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
