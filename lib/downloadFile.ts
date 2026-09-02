import { isPwaStandalone } from "@/lib/pwa";

/**
 * Descarga fiable en todas las plataformas — incluida la PWA instalada en móvil.
 *
 * Por qué existe: en una PWA instalada (display-mode: standalone), un
 * `<a href download>` que apunta a `/api/files?...` NO descarga nada. iOS (y
 * varios WebView de Android) ignoran el atributo `download` y el header
 * `Content-Disposition: attachment`, y en su lugar navegan el propio WebView al
 * recurso: se abre el visor nativo del teléfono dentro de la PWA, sin botón de
 * descarga y —para un .zip— sin forma de volver atrás.
 *
 * Estrategia:
 *  1. Traer el recurso como Blob (con fallback al caché offline si hay offlineKey).
 *  2. Móvil / PWA standalone → Web Share API con archivos ("Guardar en Archivos"
 *     en iOS, hoja de compartir en Android). Es la única vía que en iOS deja
 *     guardar de verdad.
 *  3. Resto (escritorio, navegador normal) → `blob:` URL + click en un
 *     `<a download>` sintético. Nunca navega el documento actual.
 */
export async function downloadFile(
  url: string,
  filename: string,
  opts: { offlineKey?: string } = {},
): Promise<void> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch (networkErr) {
    if (opts.offlineKey) {
      const { getFile } = await import("@/lib/offlineFileCache");
      const offline = await getFile(opts.offlineKey);
      if (!offline) throw networkErr;
      blob = offline.blob;
    } else {
      throw networkErr;
    }
  }

  const type = blob.type || "application/octet-stream";

  // 2. Web Share con archivos — mejor (y en iOS, única) opción en móvil/PWA.
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData & { files?: File[] }) => boolean;
  };
  if (
    isPwaStandalone() &&
    typeof navigator.share === "function" &&
    typeof nav.canShare === "function"
  ) {
    const file = new File([blob], filename, { type });
    if (nav.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        // El usuario canceló la hoja de compartir: no es un error, no seguimos.
        if ((err as Error).name === "AbortError") return;
        // Cualquier otro fallo → caemos al método del blob.
      }
    }
  }

  // 3. blob: URL + <a download> sintético. No navega el documento actual, así
  //    que no puede abrir el visor nativo ni dejar al usuario atrapado.
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
