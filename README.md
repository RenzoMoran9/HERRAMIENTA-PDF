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
2. Escribe el texto nuevo **sobre la propia hoja**: el campo tiene la letra, el
   tamaño y el color del renglón, y el papel de debajo, así que se ve ya como
   va a quedar.
3. `Enter` para aplicar, `Esc` para dejarlo como estaba.

Cada cambio queda anotado en la columna de la izquierda, y `Ctrl+Z` deshace.

### Mover lo que corriges

Mientras escribes, a la izquierda del campo hay un **asa** (⠇): arrástrala y el
texto se va con ella. Para ajustar fino, `Alt` + flechas lo corre medio punto,
y `Alt` + `Shift` + flechas, dos. Con `Enter` queda donde lo dejaste.

Sirve también para mover un renglón **sin cambiarle el texto**, o uno que ya
corregiste: pulsa sobre él, muévelo y `Enter`. En una hoja escaneada, lo viejo
sigue tapado en su sitio y el texto nuevo va donde lo pongas.

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

### Tachar un DNI, una cuenta o un nombre

**Tachar** en la barra y arrastra sobre lo que hay que quitar; puedes marcar
varias zonas, en varias hojas, y quitar una con su **×**. O escribe el dato en
**Buscar** y pulsa **Tachar todas las coincidencias**: las marca todas, también
en las hojas escaneadas ya reconocidas. Nada cambia hasta que pulsas **Tachar
N zonas**, y entonces se hace todo de una vez: un solo **Deshacer** lo devuelve.

No es un rectángulo negro puesto encima, que se levanta copiando y pegando.
Tachar **quita del archivo** lo que hay debajo:

- las **letras** que caen en la zona desaparecen del PDF;
- en un **escaneo**, los píxeles de la foto en esa zona se borran de la imagen
  misma, no se tapan;
- el archivo se guarda **limpio**: sin eso, el trozo viejo de la hoja se queda
  escondido dentro del PDF y cualquiera lo puede leer con otro programa;
- en una hoja **reconocida**, lo tachado también sale del texto reconocido que
  guarda la hoja, y no vuelve aunque después corrijas otro renglón;
- donde estaba queda un recuadro negro, para que se vea que ahí había algo.

La lista de cambios dice «2 zonas tachadas», pero no guarda qué se tachó: esa
lista se guarda en el equipo con tu trabajo, y ahí tampoco debe quedar el dato.

Qué no hace todavía:

- **Tachar todas las coincidencias** busca el dato tal como lo escribes. Si en
  el PDF va partido de otra manera («45 678 912» en vez de «45678912»), búscalo
  así o márcalo a mano.
- En un escaneo **sin reconocer** no hay texto que buscar: la zona se marca a
  mano, arrastrando.
- Solo quita lo que se ve en la hoja. Si el dato también va en el **nombre del
  archivo**, en sus **propiedades** (título, autor) o en un **comentario**
  pegado al PDF, eso no lo toca.
- **Deshacer** devuelve lo tachado mientras el editor sigue abierto. Una vez
  descargado o devuelto a Grapa, el archivo ya sale sin el dato.

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
- Los renglones que mezclan tipografías también se cambian: lo que no cambia
  conserva su letra (ver más abajo). Si alguno falla por otro motivo, se dice
  cuántos y por qué, y quedan marcados en la lista.

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

### Comillas, rayas y demás letra de imprenta

El texto se escribe en WinAnsi, que es lo que entienden las catorce tipografías
de serie. Casi todo lo que hace falta cabe, pero **no por su número de
Unicode**: las comillas tipográficas (« “ ” »), la raya (–), la raya larga (—),
el punto de lista (•), los puntos suspensivos (…) y el euro (€) están en
WinAnsi en otro sitio. Sin esa traducción salían como interrogantes, la
comprobación veía que lo escrito no era lo pedido y **rechazaba el cambio
entero**: un renglón con una sola raya no había manera de corregirlo, y un
correo pegado de Gmail está lleno de ellas.

Lo que no existe en WinAnsi de ninguna manera (una flecha, un emoji) se escribe
como `?` y **se dice cuál era**, en vez de dejarlo en silencio.

### Se escribe con la letra del propio documento

La tipografía buena ya viaja dentro del PDF, incrustada. El editor la usa: lee
su `/ToUnicode` —la tabla con la que el lector copia y pega— para saber con qué
número se pide cada letra, y sus anchos para medirla. Así el renglón corregido
no solo está en el mismo sitio y del mismo tamaño: **es la misma letra**.

Un PDF incrusta solo las letras que usó, así que a veces falta alguna. Cuando
pasa se dice cuál y se escribe ese trozo con la equivalente de serie, que es lo
que se hacía siempre. Una misma hoja puede traer varios subconjuntos del mismo
tipo de letra —Chrome los parte—, y entre todos suelen tener lo que hace falta.

### No se pierde lo que el renglón lleva dentro

Un párrafo puede llevar una palabra en negrita, un trozo subrayado y un enlace
en azul. Antes, corregir una cifra reescribía el renglón entero con la letra de
su primera letra y **se llevaba todo eso por delante**.

Ahora se mira hasta dónde coinciden el texto viejo y el nuevo por delante y por
detrás, y se vuelve a escribir letra por letra: lo que no ha cambiado, con su
misma tipografía, su mismo color y su misma coordenada; y solo lo de en medio
como texto nuevo. Si lo nuevo es más ancho que el hueco que deja lo viejo, se
aprieta hasta un 70 % para que lo de detrás no se mueva; si aun así no cabe, se
corre lo de detrás.

Todo va en **un solo bloque de texto**, para que el PDF lo siga leyendo como un
renglón: partido en trozos sueltos, buscar «12:30» en el documento ya no
encontraría nada.

**Lo que todavía no**

- **Devolver un escaneo corregido a su estado original.** La capa se puede
  volver a escribir, pero el editor no guarda el texto que había antes de la
  primera corrección. Dentro de la misma sesión, `Ctrl+Z`.
- **Reproducir una tipografía manuscrita o poco corriente** al corregir un
  escaneo: se escribe con la equivalente estándar, normal o negrita.
- Cambiar el **tamaño, el color o la negrita** de un renglón a mano: se
  conservan los del original, pero no se pueden elegir.

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

Desde Grapa, **Hacer buscables** (en «Buscar») manda todas las hojas
escaneadas del expediente de una vez: el editor las lee seguidas, con la
cuenta de «Hoja 3 de 12» y un botón **Detener**, se las devuelve a Grapa y
se cierra solo. Las hojas que ya tienen texto o ya se reconocieron no se
vuelven a leer.

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

**Dentro de un cuadro** hay dos cosas más que cuidar, y son las que se
llevaban por delante una cotización con su tabla de precios:

- El recuadro que da el reconocimiento a una celda **se pasa**: por abajo
  alcanza la raya del cuadro y las cabezas del renglón siguiente. Midiendo «de
  lo más alto a lo más bajo», un renglón de seis puntos se medía de dieciséis
  y el corregido salía **al doble de tamaño**. Ahora se busca la *banda* con
  tinta —las filas se parten en bandas y se elige la que más tinta tiene— y esa
  es el renglón.
- El parche se estiraba hasta encontrar papel limpio y **se tragaba la raya**,
  así que al taparla desaparecía el borde de la celda. Ahora una raya no cuenta
  como suciedad: el parche se para antes.
- El papel del parche se copiaba de una sola fila, y si esa fila llevaba el
  borde difuminado de las letras quedaban **rayas verticales** donde estaba el
  texto viejo. Ahora se toma la mediana de varias filas limpias.
- Y el borde de la celda, que entra en el recorte, se contaba como tinta: el
  texto nuevo salía **pegado al borde** en vez de donde estaba. Ahora los
  grupos de tinta finos y alejados del resto —eso es una raya, no una letra— se
  descartan.

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

Los trozos que el reconocimiento parte se vuelven a juntar **por el hueco**:
dentro de una celda, de una palabra a la siguiente hay un espacio pequeño; de
una celda a la de al lado hay el borde y su margen, que es bastante más. Así
una celda entera se corrige de una vez, en lugar de palabra por palabra.

El reconocimiento se equivoca a veces —confunde `I` con `l`, `S/` con `si`—, así
que conviene mirarlo antes de fiarse. El editor dice con qué confianza leyó, y
lo que importa es lo que escribas tú: lo leído solo es el punto de partida.

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
node pruebas/hacer-cuadro.mjs # rehace la cotización escaneada con cuadro
node pruebas/cuadro.mjs       # corregir un precio dentro de una celda: que
                              # salga del tamaño de la letra y que no se coma
                              # el borde del cuadro
node pruebas/hacer-solicitud.mjs # rehace el correo de Gmail de prueba
node pruebas/tipografia.mjs   # que el renglón corregido conserve la letra
                              # del documento y lo que llevara dentro
node pruebas/solicitud.mjs    # un correo de trabajo entero: que se dejen
                              # corregir TODOS sus renglones, y que las
                              # comillas y las rayas salgan tal cual
node pruebas/hacer-firmado.mjs # rehace el PDF con firma digital
node pruebas/firmado.mjs      # que avise de la firma antes de tocar nada
node pruebas/hacer-girado.mjs # rehace los archivos de hojas giradas
node pruebas/girado.mjs       # corregir, borrar e insertar en hojas con
                              # /Rotate 90, 180 y 270, y en un escaneo girado
node pruebas/guardado.mjs     # guardar el trabajo y recuperarlo al volver,
                              # por la web y desde el archivo suelto
node pruebas/pasos.mjs        # los botones «−» y «+» del tamaño
node pruebas/hacer-tachar.mjs # rehace la declaración inventada de tachar.pdf
node pruebas/natural.mjs      # corregir sobre la hoja con su letra y su papel,
                              # mover lo corregido, y que en un escaneo salga
                              # del tamaño del original y sin negrita falsa
node pruebas/tachar.mjs       # tachar de verdad: el DNI fuera del texto, de
                              # dentro del archivo y de la foto, también en
                              # escaneos reconocidos y en hojas giradas
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
