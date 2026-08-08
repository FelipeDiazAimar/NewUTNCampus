# En https://campusutn.dpdns.org/biblioteca hay vari
_Exported on 08/08/2026 at 15:54:56 GMT-3 from Claude via WayLog_


**User**

En https://campusutn.dpdns.org/biblioteca hay varios errores de ortografia o tipeo creeria yo en el select de motivo/tematica, mira la imagen y dime porque pasa

---


**Claude**

Encontré la causa en [route.ts:25](app/api/biblioteca/tematicas/route.ts#L25):

```ts
res.setEncoding("latin1");
```

El servidor de turnos (`turnos.frsfco.utn.edu.ar`) devuelve el HTML en **UTF-8**, pero el código fuerza a leer la respuesta como **latin1** (ISO-8859-1). Cuando un byte UTF-8 multibyte (como `í` = `0xC3 0xAD`) se interpreta como dos caracteres latin1 separados, se obtiene el patrón clásico de mojibake que ves: `í` → `Ã­`, `é` → `Ã©`, etc. Por eso "Bibliografía" se muestra como "BibliografÃ­a" y "Préstamos" como "PrÃ©stamos".

Esos textos (labels de las opciones) vienen directamente del HTML scrapeado en la línea 57 (`match[2].trim()`) sin ninguna reconversión, así que el error viaja intacto hasta el `<select>` en el frontend.

**La solución** sería no forzar `latin1` — leer el body como Buffer y decodificarlo como UTF-8 (o detectar el charset real que envía el servidor, ya que a veces estos sistemas viejos de PHP sí usan latin1 real para partes y UTF-8 para otras, conviene confirmarlo).

¿Querés que lo arregle?

---


**User**

Esttas opciones no podemos traerlas directamente desde la biblioteca legacy para no harcodearlas y sumar el arreglo?

---


**Claude**

Good — the "motivo/temática" options already come dynamically from the legacy site via `/api/biblioteca/tematicas` (not hardcoded); only the `AREAS_BIBLIOTECA` list (2 entries) is hardcoded, which is unrelated to this bug. So no extra work needed there — I'll just fix the encoding bug in the two routes that scrape the legacy server.

---


**Claude**

Let me verify the legacy server actually responds with UTF-8 bytes before trusting this fix.

---


**Claude**

Confirmed: the server declares `charset=utf-8` and the raw bytes are proper UTF-8 (`M-CM-!` = 0xC3 0x81... in `cat -v` notation is the two-byte UTF-8 sequence for accented chars). Reading with `latin1` was corrupting them. My fix (decode as UTF-8) is correct.

---


**Claude**

Good — the areas come from a `<select id="resp">` on the legacy site's index page, using HTML entities (`&aacute;`) rather than raw UTF-8. Now I'll add an `/api/biblioteca/areas` route that scrapes it dynamically, matching the `tematicas` pattern.

---


**Claude**

Now update `page.tsx` to load areas dynamically instead of the hardcoded constant.

---


**Claude**

Now update the state and mount logic.

---


**Claude**

Now update the mount effect to fetch areas first, and all call sites of `loadTematicas` / `AREAS_BIBLIOTECA`.

---


**Claude**

Now update `handleAreaChange` (calls `loadTematicas`) and the DropdownSelect usage for area.

---


**Claude**

Now the render usage of `AREA_OPTIONS`:

---


**Claude**

Now let's check DropdownSelect actually supports these props, then typecheck/lint the whole file.

---


**Claude**

Good, props match. Now typecheck and lint the changed files.

---


**Claude**

No type errors. Now let's lint.

---


**Claude**

Confirmed pre-existing (same `setMounted`/`loadHorarios` pattern existed before my edits) and consistent with 52 other errors of that kind across the codebase — not something I introduced. Changes complete.

**Resumen de cambios:**
1. [app/api/biblioteca/tematicas/route.ts](app/api/biblioteca/tematicas/route.ts) y [app/api/biblioteca/horarios/route.ts](app/api/biblioteca/horarios/route.ts): arreglé la decodificación `latin1`→`utf8` (confirmé con `curl` que el servidor legacy declara y envía `charset=utf-8`).
2. [app/api/biblioteca/areas/route.ts](app/api/biblioteca/areas/route.ts): nuevo endpoint que scrapea el `<select id="resp">` de la página principal del sistema de turnos, decodificando las entidades HTML (`&aacute;`, etc.).
3. [app/biblioteca/page.tsx](app/biblioteca/page.tsx): reemplacé el array hardcodeado `AREAS_BIBLIOTECA` por estado (`areas`/`areasLoading`) cargado desde `/api/biblioteca/areas`, con estado de carga en el dropdown igual que ya se hacía para temáticas/horarios.

`tsc --noEmit` pasa sin errores. Lint no introduce errores nuevos (los 2 que aparecen en `biblioteca/page.tsx` ya existían antes de mis cambios, mismo patrón que hay en otros ~50 casos del repo).

---
