#!/bin/sh
# Abre el editor en el navegador. Si no está construido, lo construye.
cd "$(dirname "$0")" || exit 1
[ -f GrapaEditor.html ] || node construir.mjs || exit 1
(xdg-open GrapaEditor.html 2>/dev/null || open GrapaEditor.html 2>/dev/null) &
