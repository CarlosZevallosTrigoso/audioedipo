# audioedipo

Reproductor de los capítulos del ensayo de lectura de *El Anti-Edipo*, para escuchar con índice, páginas del libro, citas y transcripción sincronizada.

Página: https://carloszevallostrigoso.github.io/audioedipo/

## Cómo llega el audio

El audio no está en este repo. La primera vez la app ofrece dos caminos:

- **Descargar de Drive**: entra con tu cuenta de Google y baja el archivo por su ID (`drive.fileId` en el JSON del capítulo). Usa las mismas credenciales que AudioGuía (`js/config.js`).
- **Abrir desde el equipo**: eliges el MP3 completo desde el computador o el teléfono.

En los dos casos el audio queda guardado en el navegador de ese dispositivo y ya no se vuelve a pedir. «Quitar», arriba a la derecha, lo borra. La posición y la velocidad también se recuerdan.

## Agregar un capítulo

1. Corta el audio en piezas (si hace falta para transcribirlo) y transcribe cada una. Cada `.txt` tiene bloques que empiezan con una marca `[mm:ss]`.
2. Saca la duración exacta de cada pieza:
   ```bash
   for f in carpeta/*.mp3; do ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"; done
   ```
3. Crea `capitulos/capN/` con `transcripcion/000.txt`, `001.txt`… y un `fuente.json` como el de `cap1`: ID de Drive, duraciones de las piezas y el índice. Cada entrada del índice tiene un `ancla`, un fragmento literal de la transcripción **original** donde empieza ese tramo.
4. Construye el JSON y pruébalo:
   ```bash
   python3 tools/construir.py capitulos/capN
   node tests/nucleo.test.js
   ```
5. Agrega el capítulo a `capitulos/index.json`. Para abrir uno que no sea el primero: `?cap=capN`.

`tools/correcciones.py` corrige los nombres propios que la transcripción automática deforma (Deleuze, Guattari, Dosse, Artaud…). Si un capítulo nuevo trae errores nuevos, se agregan ahí.

## Archivos

- `index.html`, `css/app.css`, `js/`: la app, sin dependencias ni paso de compilación. Solo carga desde fuera el script de inicio de sesión de Google.
- `js/nucleo.js`: lógica pura (tiempos, índice, búsqueda), probada en `tests/`.
- `js/drive.js`: autenticación y descarga, adaptado de AudioGuía.
- `capitulos/capN/capN.json`: lo que lee la app. Se genera, no se edita a mano.
- `fonts/`: Fira Code (licencia OFL).
