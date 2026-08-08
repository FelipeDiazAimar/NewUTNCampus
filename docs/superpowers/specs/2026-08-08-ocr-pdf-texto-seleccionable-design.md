# Texto seleccionable en PDFs (nativo + OCR) — design

## Contexto

`components/CampusPDFViewer.tsx` (basado en `react-pdf`) renderiza cada página de PDF solo como `<canvas>` (`renderTextLayer={false}`, `renderAnnotationLayer={false}`). El comentario en el código (líneas 68-73) explica por qué: la capa de texto propia de `react-pdf` tira un crash síncrono (`Cannot read properties of null (reading 'childNodes')`) en algunos PDFs cuando el componente se remonta mientras esa capa sigue renderizando de forma async, y ese crash tumba todo el visor. Se optó por sacrificar la selección de texto para que el visor nunca quede en blanco.

El resultado: hoy **ningún** PDF permite seleccionar texto, ni siquiera los que tienen texto real embebido (la mayoría — son documentos exportados desde Word/PowerPoint por los profesores). Un subconjunto menor son escaneos/fotos de apuntes sin texto embebido, donde ni arreglando el bug de `react-pdf` se podría seleccionar nada porque no hay texto que extraer.

## Alcance

- Capa de texto propia (no la de `react-pdf`) montada encima de cada `<canvas>` de página en `CampusPDFViewer`, que nunca puede tumbar el visor.
- Para páginas con texto nativo: se usa `pdfjs-dist` directamente (`page.getTextContent()`), evitando por completo el componente `TextLayer` de `react-pdf` que causa el crash.
- Para páginas sin texto nativo (escaneadas): fallback automático a OCR client-side con Tesseract.js (`spa+eng`), corriendo 100% en el navegador.
- Cache del resultado de OCR en IndexedDB del navegador, para no repetir el reconocimiento en visitas futuras al mismo archivo.
- Indicador visual sutil mientras el OCR de una página está en curso.

Fuera de alcance: OCR de imágenes sueltas (no-PDF) en el sistema de archivos, OCR server-side, edición/corrección manual del texto reconocido, exportar un PDF nuevo con el texto OCR incrustado (el texto solo vive como overlay seleccionable en el visor, no se persiste en el archivo).

## Arquitectura

```
CampusPDFViewer
  └─ PagesList (ya existe, memoized)
       └─ por cada página:
            <Page ...canvas-only, igual que hoy... />
            <PageTextOverlay page={pdfPageProxy} scale={scale} fileKey={fileKey} />
```

`PageTextOverlay` es el único componente nuevo montado en el árbol de render. Recibe el `PDFPageProxy` (pdfjs-dist) de esa página — ya disponible porque `Document`/`Page` de `react-pdf` exponen la promesa de la página vía `pdfDocRef.current.getPage(n)`, que `CampusPDFViewer` ya usa para `onAspectRatio`.

Flujo por página, en un `useEffect` de `PageTextOverlay`:

1. `const textContent = await page.getTextContent()`.
2. Si `textContent.items` tiene contenido real (suma de longitud de texto > umbral chico, p.ej. 3 caracteres) → construir spans desde esos items (tienen `str`, `transform`, `width`, `height` — se convierten a `left/top/fontSize` con la matriz de transformación y el `scale` actual, igual que hace el `TextLayer` estándar de pdf.js). Listo, no hace falta OCR.
3. Si no hay texto nativo → buscar en la cache de IndexedDB por clave `${fileHash}:${pageNumber}`.
   - Si está cacheado → usar esas palabras+bboxes directamente.
   - Si no está cacheado → tomar el canvas ya renderizado de esa página (el mismo que ya pintó `<Page>`, vía `querySelector` sobre el contenedor de la página o un `ref` pasado desde `PagesList`), exportarlo como `dataURL`/`ImageData`, pasarlo al worker de Tesseract.js, y con las palabras (`data.words`, cada una con `text` y `bbox` en píxeles de esa imagen) construir los mismos spans. Guardar el resultado en IndexedDB antes de renderizar.
4. Cualquier error en los pasos 1-3 (getTextContent falla, worker de Tesseract falla, etc.) se atrapa y esa página simplemente no monta overlay — se ve exactamente igual que hoy, nunca rompe el visor completo. Esto es lo que evita el bug original.

El `fileHash` para la clave de cache es un hash chico (no criptográfico, tipo `fnv1a` o similar) del `fileKey` que `CampusPDFViewer` ya calcula (string de la URL, o "buffer" + tamaño en bytes si es un Blob/ArrayBuffer sin URL estable). Si dos archivos distintos sin URL estable colisionaran en la cache, el peor caso es mostrar texto OCR incorrecto para esa página — no es crítico y es un caso raro (adjuntos de tareas suelen tener URL propia).

## Componentes nuevos

**`lib/ocrCache.ts`**
```ts
export async function getCachedPage(key: string): Promise<OcrWord[] | null>
export async function setCachedPage(key: string, words: OcrWord[]): Promise<void>
```
Wrapper chico sobre IndexedDB (una sola object store `ocr_pages`, key = string, value = array de palabras). Sin librería externa — IndexedDB nativo alcanza para este uso (get/set por clave, sin queries).

**`lib/ocrWorker.ts`**
```ts
export async function recognizePage(canvas: HTMLCanvasElement): Promise<OcrWord[]>
```
Inicializa un worker de Tesseract.js singleton (lazy, primera vez que se necesita — no en el bundle inicial ni al abrir un PDF con texto nativo) con `spa+eng`, lo reutiliza entre páginas y documentos durante la sesión. `OcrWord = { text: string; x: number; y: number; width: number; height: number }` en coordenadas relativas a la página (0-1 o píxeles del canvas fuente, normalizado luego por `PageTextOverlay` al `scale` real).

**`components/PageTextOverlay.tsx`**
Props: `{ page: PDFPageProxy; pageEl: HTMLDivElement | null; scale: number; cacheKeyPrefix: string }`. Renderiza un `<div>` absolutamente posicionado sobre la página (mismo patrón que el `TextLayer` estándar: `position: absolute; inset: 0; pointer-events: auto`) con un `<span>` por palabra/item, `color: transparent`, `user-select: text`, posicionado con `position: absolute; left/top/font-size` calculados. No tiene estilos visibles — solo existe para que el navegador tenga texto real debajo del canvas para seleccionar/copiar.

## Cambios en `CampusPDFViewer.tsx` / `PagesList`

- `PagesList` necesita exponer, por página, un `ref` a su contenedor (para que `PageTextOverlay` pueda ubicarse encima y leer el canvas ya pintado). Se envuelve cada `<Page>` en un `<div style={{position: "relative"}}>` que ya sirve de ancla para el overlay absoluto.
- El montaje del overlay se dispara solo después de `onRenderSuccess` de esa página (no antes — necesita el canvas pintado para el camino de OCR, y evita trabajo mientras la página ni siquiera es visible).
- `cacheKeyPrefix` se calcula una vez por documento (hash del `fileKey`) y se pasa a cada `PageTextOverlay`.

## Indicador de progreso

Mientras el `useEffect` de una página está en el paso de OCR (no en el de texto nativo, que es prácticamente instantáneo), se muestra un ícono chico tipo spinner en la esquina superior derecha de esa página («Reconociendo texto…» como `title`), superpuesto sin bloquear la lectura — la imagen de la página ya está visible desde antes. Desaparece al terminar (con o sin éxito).

## Testing

No hay suite de tests en el proyecto. Verificación manual:
1. Abrir un PDF de texto real (apunte exportado de Word) → seleccionar/copiar un párrafo, confirmar que el texto copiado coincide con lo visible, y que no aparece ningún spinner de OCR (debe resolverse por el camino nativo).
2. Abrir un PDF que hoy causa el crash de `react-pdf` (buscar uno de los reportados) → confirmar que el visor no se rompe y que, si tiene texto nativo, ahora es seleccionable.
3. Abrir un PDF escaneado (imagen pura, sin texto nativo) → confirmar que aparece el indicador de OCR por página, que luego de unos segundos el texto reconocido es seleccionable, y que la precisión es razonable en texto impreso limpio.
4. Volver a abrir el mismo PDF escaneado → confirmar que no vuelve a tardar (usa la cache de IndexedDB) y el texto aparece ~inmediatamente.
5. Cambiar de zoom (`scale`) en un documento con overlay activo → confirmar que los spans se reposicionan correctamente y siguen alineados con el canvas.
6. Confirmar que documentos con muchas páginas no traban la UI — el OCR de páginas fuera de vista no debería competir por CPU con las visibles (ver nota de posible mejora abajo, no es alcance de esta primera versión pero vale dejarlo anotado).
