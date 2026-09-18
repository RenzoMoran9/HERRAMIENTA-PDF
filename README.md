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
- Texto dentro de imágenes o de escaneos: ahí no hay letras que editar, hay
  una foto. Para eso haría falta reconocimiento de caracteres.
- Borrar un renglón entero.
- La tipografía que se escribe es la equivalente estándar (las catorce que
  todo lector de PDF trae de serie), no la copia incrustada del original.
  Se elige respetando **negrita, cursiva, gracias y monoespaciado**, y
  cuando hay sustitución se dice cuál se usó en la lista de cambios. En
  documentos corrientes —Arial, Calibri, Times— no se nota; en una
  tipografía con personalidad, sí.

---

## Para desarrollar

```bash
node servidor.mjs             # http://localhost:8123
node construir.mjs            # genera GrapaEditor.html, el archivo suelto
node pruebas/editar.mjs       # edita y comprueba el resultado, servido
node pruebas/suelto.mjs       # lo mismo con el archivo suelto, sin red
node pruebas/subconjunto.mjs  # un PDF impreso por Chrome, con tipografías
                              # en subconjunto: negrita, cursiva, Times y Courier
node pruebas/hacer-correo.mjs pruebas/correo.pdf   # rehace ese PDF de prueba
```

---

## Licencia

Este programa es **software libre bajo la [AGPL-3.0-or-later](LICENSE)**, porque
usa [MuPDF](https://mupdf.com) de Artifex Software, que se distribuye con esa
licencia.

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
