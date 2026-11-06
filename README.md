# Manuel Rueda · Un universo propio

Web de Manuel Rueda Ródenas, pintor de Utiel: retrato en fotomosaico, galería 3D de 126 cuadros, casa-estudio y archivo familiar.

## Publicación

GitHub Pages publica la carpeta `docs/` de la rama `main`. La web es estática y no necesita claves ni servicios de backend.

## Actualizar

El código fuente está en `src/` y los recursos web en `public/`.

```sh
npm ci
npm run build:pages
```

Subir los cambios de código y de `docs/` a `main`. Las rutas funcionan dentro de la subcarpeta del repositorio de GitHub Pages. No se incluyen los documentos originales de trabajo ni rutas del ordenador familiar.

## Créditos

Obras: Manuel Rueda Ródenas. Fotografías de la casa-museo: Antonio Sánchez Campillos. Material: archivo familiar. Base 3D: Infinite Canvas de Edoardo Lunardi, con licencia MIT conservada. El generador del fotomosaico adapta codebox/mosaic, de Rob Dawson. GSAP y las fuentes conservan sus avisos en `public/licenses/` y `public/assets/`. Las obras y fotografías conservan la autoría indicada; la licencia del código no cambia sus derechos.
