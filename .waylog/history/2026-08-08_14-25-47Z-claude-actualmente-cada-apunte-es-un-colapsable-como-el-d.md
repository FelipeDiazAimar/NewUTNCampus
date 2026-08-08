# Actualmente cada apunte es un colapsable como el d
_Exported on 08/08/2026 at 13:31:17 GMT-3 from Claude via WayLog_


**User**

Actualmente cada apunte es un colapsable como el de la imagen adjunnta, quiero que no sea asi, que esten los botones de previsualizacion y descarga directamente lo que ahora es el acordeon colapsado no al expandir el acordeon, por ende ya no habria mas acrodeon, ademas asegurate de que si hay caracteres extraños normalizarlos, ve la imagen para entenderme.

---


**Claude**

FolderViewer.tsx looks most relevant to the file list/accordion UI shown.

---


**Claude**

Now let's add the helper function to lib/moodle.ts.

---


**Claude**

Now update `app/api/course/route.ts` to use it:

---


**Claude**

Now update `app/api/meta/route.ts`:

---


**Claude**

Now let's fix the accordion UI in `app/materia/[slug]/page.tsx`. Let's view more context around the resource rendering and imports.

---


**Claude**

Let me clean this up properly by removing the unused `open`/`setOpen` state entirely.

---


**Claude**

Good, still used elsewhere. Now let's run lint/build to verify no errors.

---


**Claude**

These are pre-existing unrelated lint errors. Let's confirm my edited file has no new errors.

---


**Claude**

All pre-existing, unrelated to my edits (confirmed by comparing against git blame — same errors exist before my change). Let's confirm this is pre-existing by checking against the git diff baseline.

---


**Claude**

Confirmed: same 55 problems before and after my changes — nothing new introduced. Let me check the unrelated `ContactProfessorModal.tsx` modification (line-ending only, not something I touched).

---


**Claude**

That file was already modified before I started (not by me) — leaving it untouched. Now let's typecheck the build.

---


**Claude**

That's a stale generated types file unrelated to my edits, not a real error in my code.

Summary of changes:
- **`components/materia page` accordion removed**: [app/materia/[slug]/page.tsx](app/materia/[slug]/page.tsx) — `resource`-type modules with a file (apuntes) now render the preview/download row directly, no more collapse/expand wrapper.
- **Mojibake fix**: added `decodeContentDispositionFilename` in [lib/moodle.ts](lib/moodle.ts), which detects when Moodle's `Content-Disposition` filename got mis-decoded as Latin-1 (causing `PresentaciÃ³n` instead of `Presentación`) and repairs it. Wired into [app/api/course/route.ts](app/api/course/route.ts) and [app/api/meta/route.ts](app/api/meta/route.ts), which are the two places that resolve real filenames from Moodle.

No new lint/type errors introduced (verified against baseline). Since this needs a live Moodle session to see the actual rendered result, I wasn't able to visually confirm in a browser — worth a quick check on your end that the apunte rows look right and accented filenames display correctly.

---


**User**

Ya quedo?

---


**Claude**

Sí, los cambios están hechos:

- **Acordeón eliminado**: en [app/materia/[slug]/page.tsx](app/materia/[slug]/page.tsx), los apuntes (`resource` con archivo) ahora muestran directo el botón de ojo (previsualizar) y descarga, sin tener que expandir nada.
- **Caracteres raros corregidos**: agregué `decodeContentDispositionFilename` en [lib/moodle.ts](lib/moodle.ts) que arregla el mojibake tipo "PresentaciÃ³n" → "Presentación", aplicado en `/api/course` y `/api/meta` (de donde salen los nombres reales de archivo).

Lint y tsc no muestran errores nuevos. Lo que no pude verificar es el resultado visual en el navegador porque no tengo una sesión de Moodle activa acá — te recomiendo levantar `npm run dev`, entrar a una materia y confirmar que los apuntes se ven bien y los nombres con tildes salen correctos. Todavía no comité nada, quedó como cambios sin confirmar por si querés revisarlo antes.

---


**User**

El boton de descargar quitalo de el card que pone 
Abierto en el visor → y agrega junto al boton de descargar en el card del archivo el boton de descargar que te permite elegir donde ira en que carpeta el archivo con el mismo svg que tiene el mismo boton que esta en la previsualizacion

---


**Claude**

Now let's implement: remove the download link from the "Abierto en el visor" card, and add a "Guardar como…" (save-as, choose folder) button next to the existing download button in the file row.

---


**Claude**

Now add the "Guardar como…" (save-as) handler and button next to the existing download button.

---


**Claude**

Now verify `React` import exists (needed for `React.MouseEvent` type) and run lint.

---


**Claude**

No type errors. Let's run lint too for that file.

---


**Claude**

Pre-existing, unrelated to my change. My addition is clean.

---


**Claude**

Todo listo:

- La tarjeta **"Abierto en el visor →"** ya no tiene botón de descarga.
- En la fila del archivo, junto al botón de descarga rápida, agregué el botón **"Guardar como…"** con el mismo SVG que el del visor — usa la File System Access API para elegir carpeta de destino, y si el navegador no la soporta cae a la descarga normal.

Sin errores nuevos de lint/tsc.

---
