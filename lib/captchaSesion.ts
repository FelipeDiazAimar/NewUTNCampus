// Sesión de captcha remoto: Chromium headless cargando la página ORIGINAL de
// turnos (dominio correcto => el widget reCAPTCHA renderiza nativo) y control
// remoto del widget vía Playwright.
//
// Port de scripts/captcha-remoto/server.mjs (prototipo funcional y probado).
// Las constantes de selectores y el comportamiento se validaron contra el
// widget real entre el 30 y el 31/08/2026.
//
// Detección de cambios: 100% por evento. Un MutationObserver inyectado en los
// iframes del reCAPTCHA (anchor + bframe) llama a un binding expuesto por
// Playwright (`window.__captchaEvento`) cada vez que el DOM del widget muta.
// Node coalesce la ráfaga con un debounce corto, re-serializa la grilla y
// emite solo si la firma cambió. No hay polling por intervalo ni fallback de
// screenshot: el espejo es lectura DOM pura.

import fs from "node:fs";
import path from "node:path";
import type { Browser, Frame, Page } from "playwright-core";

const BASE = "https://turnos.frsfco.utn.edu.ar:4443";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

// Ventana de coalescing: agrupa una ráfaga de mutaciones (Google anima el
// widget) en una sola lectura. No corre ningún timer mientras el DOM está
// quieto, así que sigue siendo estrictamente por evento.
const DEBOUNCE_MS = 120;
// Tope: si las mutaciones no paran (animaciones encadenadas), forzamos una
// lectura igual para no quedarnos sin espejo mientras el widget "respira".
const DEBOUNCE_MAX_MS = 1200;

export const MAX_SESIONES_CAPTCHA = 2;
let sesionesActivas = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// En Vercel: @sparticuz/chromium (binario Linux para serverless, se descomprime
// en /tmp). En dev local (no-Linux): cae al playwright completo si está.
async function lanzarChromium() {
  const { chromium } = await import("playwright-core");
  if (process.platform === "linux") {
    const core = await import("@sparticuz/chromium");
    const chromiumPkg = core.default ?? core;
    const executablePath = await chromiumPkg.executablePath();
    return chromium.launch({
      args: [...(chromiumPkg.args ?? []), "--disable-blink-features=AutomationControlled"],
      executablePath,
      headless: true,
    });
  }
  const full = await import("playwright");
  return full.chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--window-size=1280,800"],
  });
}

type EnviarFn = (obj: Record<string, unknown>) => void;

export class SesionCaptcha {
  private send: EnviarFn;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private _token: string | null = null;
  private abortado = false;
  private leyendo = false;
  private domFirma: string | null = null;
  private ultimoError: string | null = null;
  private ultimoMotivoDom = "(inicial)";
  private mousePos: { x: number; y: number } | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private debounceDesde = 0;

  constructor(send: EnviarFn) {
    this.send = send;
  }

  static get cupoDisponible(): boolean {
    return sesionesActivas < MAX_SESIONES_CAPTCHA;
  }

  private emitir(fase: string, extra: Record<string, unknown> = {}) {
    this.send({ type: "estado", fase, ...extra });
  }

  async iniciar(): Promise<void> {
    if (!SesionCaptcha.cupoDisponible) {
      throw new Error("Hay demasiadas sesiones de captcha activas. Probá en unos minutos.");
    }
    sesionesActivas++;
    // Diagnóstico del tracing: si nft volvió a podar browsers.json, este log
    // lo dice antes de que el import de playwright-core reviente.
    try {
      const pwRoot = path.join(process.cwd(), "node_modules", "playwright-core");
      const presente = fs.existsSync(path.join(pwRoot, "browsers.json"));
      console.log("[captcha] browsers.json presente en el bundle:", presente);
    } catch {
      /* diagnóstico best-effort */
    }
    try {
      this.browser = await lanzarChromium();
    } catch (e) {
      sesionesActivas--;
      throw e;
    }
    const context = await this.browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 800 },
      locale: "es-AR",
      timezoneId: "America/Argentina/Cordoba",
    });
    this.page = await context.newPage();

    // Binding disponible en window de TODOS los frames (incluidos los iframes
    // cross-origin del reCAPTCHA y los que se creen después, como el bframe del
    // desafío). Se registra una sola vez, antes de navegar.
    await this.page.exposeFunction("__captchaEvento", () => this.onMutacion());

    // Reinyecta el observer cuando el bframe se crea / re-navega (nueva ronda,
    // recarga del desafío).
    this.page.on("frameattached", (f) => void this.instalarObserver(f));
    this.page.on("framenavigated", (f) => void this.instalarObserver(f));

    await this.page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.page.waitForFunction(
      () =>
        typeof (globalThis as { grecaptcha?: unknown }).grecaptcha !== "undefined" &&
        !!document.querySelector(".g-recaptcha iframe"),
      { timeout: 20000 }
    );

    // Observers en el frame principal + los que ya existan (anchor).
    await this.instalarObserver(this.page.mainFrame());
    for (const f of this.page.frames()) await this.instalarObserver(f);

    this.emitir("listo");
    // Lectura inicial por si el widget ya trae estado.
    this.onMutacion();
  }

  async cerrar(): Promise<void> {
    this.abortado = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    try {
      await this.browser?.close();
    } catch {
      /* ya cerrado */
    }
    this.browser = null;
    this.page = null;
    if (sesionesActivas > 0) sesionesActivas--;
  }

  get token(): string | null {
    return this._token;
  }

  private frameCheckbox() {
    return this.page?.frames().find((f) => f.url().includes("/recaptcha/api2/anchor"));
  }
  private frameDesafio() {
    return this.page?.frames().find((f) => f.url().includes("/recaptcha/api2/bframe"));
  }

  // Instala un MutationObserver en el documento del frame que vigila los
  // cambios relevantes del widget (childList + atributos de estado) y avisa a
  // Node vía el binding. Idempotente por documento (`__obsCaptcha`).
  private async instalarObserver(frame: Frame): Promise<void> {
    if (this.abortado) return;
    const url = frame.url();
    const esRelevante =
      frame === this.page?.mainFrame() ||
      url.includes("/recaptcha/api2/anchor") ||
      url.includes("/recaptcha/api2/bframe");
    if (!esRelevante) return;
    await frame
      .evaluate(() => {
        const w = window as unknown as { __obsCaptcha?: MutationObserver; __captchaEvento?: () => void };
        if (w.__obsCaptcha || typeof w.__captchaEvento !== "function") return;
        w.__obsCaptcha = new MutationObserver(() => {
          try {
            w.__captchaEvento!();
          } catch {
            /* binding aún no disponible */
          }
        });
        w.__obsCaptcha.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "src", "aria-checked", "aria-hidden"],
        });
      })
      .catch(() => {
        /* el frame puede haberse desprendido */
      });
  }

  // Disparador de evento: coalesce la ráfaga de mutaciones y procesa una vez.
  private onMutacion(): void {
    if (this.abortado) return;
    const ahora = Date.now();
    if (this.debounce) {
      // Si la ráfaga ya lleva demasiado, dejamos que dispare en vez de reiniciar.
      if (ahora - this.debounceDesde >= DEBOUNCE_MAX_MS) return;
      clearTimeout(this.debounce);
    } else {
      this.debounceDesde = ahora;
    }
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.procesarCambio();
    }, DEBOUNCE_MS);
  }

  // El área clicable del desafío. En reCAPTCHA es un ID (#rc-imageselect-target),
  // no una clase. Fallbacks por si Google cambia la estructura.
  private async elementoDesafio() {
    const frame = this.frameDesafio();
    if (!frame || !this.page) return null;
    const selectores = [
      "#rc-imageselect-target",
      ".rc-imageselect-target",
      ".rc-imageselect-challenge",
      "table.rc-imageselect-table-33",
      "table.rc-imageselect-table-44",
      "table",
    ];
    for (const sel of selectores) {
      const el = await frame.$(sel).catch(() => null);
      if (!el) continue;
      const visible = await el.evaluate((n) => (n as HTMLElement).offsetHeight > 0).catch(() => false);
      if (visible) return el;
    }
    return null;
  }

  // ── Lectura estructurada del desafío (espejo DOM) ──────────────────────────
  // Serializa la grilla real celda por celda. La imagen del desafío se dedupea
  // y viaja como data-URL (fetch same-origin desde el propio iframe: las URLs a
  // google.com/recaptcha/api2/payload el navegador del usuario NO puede
  // cargarlas por CORP).
  //
  // El reCAPTCHA recorta cada celda de UNA imagen por geometría (un <img>
  // grande con transform/translate distinto por celda, o una copia por celda
  // dentro de un wrapper overflow:hidden). Por eso cada celda lleva un
  // background-position/-size en % — reconstruido desde los rects renderizados
  // de la celda y de la imagen — que el cliente pinta a cualquier tamaño. Si el
  // desafío usa un sprite con background-image real, se normaliza pos/size a %.
  // Si algo falla se loguea el motivo (una vez por motivo).
  private async leerDesafioDOM(): Promise<{
    texto: string;
    filas: number;
    imgs: string[];
    celdas: ({ i: number; pos: string; size: string } | null)[];
  } | null> {
    const frame = this.frameDesafio();
    if (!frame) return null;
    const leido = await frame
      .evaluate(async () => {
        const inst = document.querySelector(".rc-imageselect-instructions");
        const target =
          document.querySelector("#rc-imageselect-target") ||
          document.querySelector(".rc-imageselect-target") ||
          document.querySelector("table");
        if (!inst || !target || (target as HTMLElement).offsetHeight === 0) {
          return { motivo: "sin-target" } as const;
        }

        const aDataUrl = async (url: string): Promise<string> => {
          if (url.startsWith("data:")) return url;
          try {
            const blob = await fetch(url, { credentials: "include", cache: "no-store" }).then(
              (r) => r.blob()
            );
            return await new Promise<string>((resolve) => {
              const fr = new FileReader();
              fr.onload = () => resolve(String(fr.result));
              fr.onerror = () => resolve("");
              fr.readAsDataURL(blob);
            });
          } catch {
            return "";
          }
        };

        // La imagen "grande" del desafío (una sola para toda la grilla en el
        // 3x3/4x4 inicial; las celdas la recortan por geometría).
        const imgGrande =
          (target.querySelector(
            "img[class*='rc-image-tile'], img[src*='payload'], img[src*='recaptcha']"
          ) as HTMLImageElement | null) || (target.querySelector("img") as HTMLImageElement | null);

        // Reconstruye el recorte de una celda como background-position/-size en
        // % (independiente del tamaño al que el cliente pinte la celda) a partir
        // de los rects renderizados de la celda y de la imagen.
        const cropDesde = (cellEl: HTMLElement, imgEl: HTMLElement) => {
          const cr = cellEl.getBoundingClientRect();
          const ir = imgEl.getBoundingClientRect();
          const IW = ir.width;
          const IH = ir.height;
          const CW = cr.width;
          const CH = cr.height;
          if (!IW || !IH || !CW || !CH) return { pos: "center" as const, size: "cover" as const };
          const sizeX = (IW / CW) * 100;
          const sizeY = (IH / CH) * 100;
          const posX = IW > CW ? ((cr.left - ir.left) / (IW - CW)) * 100 : 50;
          const posY = IH > CH ? ((cr.top - ir.top) / (IH - CH)) * 100 : 50;
          return {
            pos: `${posX.toFixed(3)}% ${posY.toFixed(3)}%`,
            size: `${sizeX.toFixed(3)}% ${sizeY.toFixed(3)}%`,
          };
        };

        // Tile de una unidad de celda. Prioridad:
        //   1) <img> (propia de la celda, o la grande compartida) => crop por
        //      geometría — el caso normal del reCAPTCHA.
        //   2) background-image sprite => se normaliza pos/size a %.
        const leerCelda = async (cont: HTMLElement) => {
          // Tile consumida (ronda dinámica): la celda se atenúa o su imagen
          // propia queda vacía => null (el cliente la pinta gris con ✔).
          const sel = cont.querySelector("[class*='dynamic-selected'], [class*='tile-selected']");
          if (sel && parseFloat(getComputedStyle(sel).opacity || "1") < 0.3) return null;

          const propia = cont.querySelector("img") as HTMLImageElement | null;
          const propiaVacia = !!propia && propia.complete && propia.naturalWidth === 0;
          if (propiaVacia) return null;
          const imgEl = propia && propia.src ? propia : imgGrande;
          if (imgEl && imgEl.src) {
            const g = cropDesde(cont, imgEl);
            return { urlOriginal: imgEl.src, pos: g.pos, size: g.size };
          }

          const candidatos: HTMLElement[] = [
            ...Array.from(
              cont.querySelectorAll<HTMLElement>(
                "[class*='rc-image-tile'], [style*='background-image']"
              )
            ),
            cont,
          ];
          for (let i = candidatos.length - 1; i >= 0; i--) {
            const el = candidatos[i];
            const cs = getComputedStyle(el);
            const bg = cs.backgroundImage;
            if (bg && bg !== "none" && bg.includes("url(")) {
              const m = bg.match(/url\(["']?(.*?)["']?\)/);
              if (!m) continue;
              // px -> % relativo al propio elemento del fondo
              const br = el.getBoundingClientRect();
              const sz = cs.backgroundSize.split(" ");
              const ps = cs.backgroundPosition.split(" ");
              const aPct = (v: string, base: number) =>
                v.endsWith("%") || !v.endsWith("px") || !base
                  ? v
                  : `${(parseFloat(v) / base) * 100}%`;
              return {
                urlOriginal: m[1],
                pos: `${aPct(ps[0] || "50%", br.width)} ${aPct(ps[1] || "50%", br.height)}`,
                size:
                  sz.length === 2
                    ? `${aPct(sz[0], br.width)} ${aPct(sz[1], br.height)}`
                    : cs.backgroundSize,
              };
            }
          }
          return null;
        };

        const imgs: string[] = [];
        const mapa = new Map<string, number>();
        const celdas: ({ i: number; pos: string; size: string } | null)[] = [];

        // Unidades de celda: los td mantienen la alineación de la grilla
        // (un td sin tile => celda null/consumida, no se salta).
        const tds = target.querySelectorAll("td");
        if (tds.length) {
          for (const td of tds) {
            const r = await leerCelda(td);
            if (!r) {
              celdas.push(null);
              continue;
            }
            let idx = mapa.get(r.urlOriginal);
            if (idx === undefined) {
              const dataUrl = await aDataUrl(r.urlOriginal);
              idx = imgs.length;
              imgs.push(dataUrl);
              mapa.set(r.urlOriginal, idx);
            }
            celdas.push({ i: idx, pos: r.pos, size: r.size });
          }
        } else {
          // Sin tabla: los elementos hoja con fondo son las celdas
          const elems = Array.from(
            target.querySelectorAll<HTMLElement>(
              "[class*='rc-image-tile'], [style*='background-image']"
            )
          );
          const conBg = elems.filter((el) => {
            const bg = getComputedStyle(el).backgroundImage;
            return bg && bg !== "none" && bg.includes("url(");
          });
          const tiles = conBg.filter(
            (el) => !conBg.some((otro) => otro !== el && el.contains(otro))
          );
          for (const tileEl of tiles) {
            const cs = getComputedStyle(tileEl);
            const m = cs.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
            const urlOriginal = m ? m[1] : tileEl.querySelector("img")?.src || "";
            if (!urlOriginal) {
              celdas.push(null);
              continue;
            }
            let idx = mapa.get(urlOriginal);
            if (idx === undefined) {
              const dataUrl = await aDataUrl(urlOriginal);
              idx = imgs.length;
              imgs.push(dataUrl);
              mapa.set(urlOriginal, idx);
            }
            celdas.push({ i: idx, pos: cs.backgroundPosition, size: cs.backgroundSize });
          }
        }

        if (celdas.every((c) => c === null)) return { motivo: "todas-vacias" } as const;

        const trs = target.querySelectorAll("tr").length;
        const porCount: Record<number, number> = { 4: 2, 9: 3, 16: 4 };
        const filas =
          trs ||
          porCount[celdas.length] ||
          (Number.isInteger(Math.sqrt(celdas.length)) ? Math.sqrt(celdas.length) : 3);

        return {
          motivo: "ok" as const,
          texto: (inst as HTMLElement).innerText.trim(),
          filas,
          imgs,
          celdas,
        };
      })
      .catch((e: Error) =>
        ({ motivo: "excepcion: " + String(e.message || e).slice(0, 120) } as const)
      );

    const motivo = "motivo" in (leido ?? {}) ? (leido as { motivo: string }).motivo : "ok";
    if (motivo !== this.ultimoMotivoDom) {
      this.ultimoMotivoDom = motivo;
      console.log("[captcha] lectura DOM:", motivo);
    }
    if (!leido || !("celdas" in leido) || leido.motivo !== "ok") return null;

    // data-URLs vacías por fallo de fetch => marcamos la celda como vacía
    const celdas = leido.celdas.map((c) => (c && leido.imgs[c.i] === "" ? null : c));
    return { texto: leido.texto, filas: leido.filas, imgs: leido.imgs, celdas };
  }

  // ¿El desafío de imágenes está visible en pantalla? (instrucciones + target
  // con alto). Sirve para distinguir "no hay desafío" (benigno) de "hay
  // desafío pero no lo pude serializar" (markup cambiado => error visible).
  private async desafioActivo(): Promise<boolean> {
    const frame = this.frameDesafio();
    if (!frame) return false;
    return frame
      .evaluate(() => {
        const inst = document.querySelector(".rc-imageselect-instructions");
        const target =
          document.querySelector("#rc-imageselect-target") ||
          document.querySelector(".rc-imageselect-target") ||
          document.querySelector("table");
        return !!inst && !!target && (target as HTMLElement).offsetHeight > 0;
      })
      .catch(() => false);
  }

  // Procesa un cambio del widget (llamado tras el debounce). Hace lo mismo que
  // el viejo tick de polling menos el loop y sin fallback de screenshot.
  private async procesarCambio(): Promise<void> {
    if (this.abortado || !this.page || this.leyendo) return;
    this.leyendo = true;
    try {
      // ¿token? (resuelto)
      const token = await this.page.evaluate(() => {
        const g = (globalThis as { grecaptcha?: { getResponse: () => string } }).grecaptcha;
        return g ? g.getResponse() : "";
      });
      if (token) {
        this._token = token;
        this.emitir("resuelto", { token });
        return;
      }

      // ¿desafío de imágenes? — espejo DOM estructurado
      const dom = await this.leerDesafioDOM();
      let problemaLectura: string | null = null;
      if (dom) {
        const firma = JSON.stringify(dom);
        if (firma !== this.domFirma) {
          this.domFirma = firma;
          console.log(
            `[captcha] desafio via DOM (${dom.celdas.length} celdas, ${dom.imgs.length} imgs)`
          );
          this.emitir("desafio", {
            texto: dom.texto,
            filas: dom.filas,
            imgs: dom.imgs,
            celdas: dom.celdas,
          });
        }
      } else {
        this.domFirma = null;
        // Sin fallback de screenshot: si el desafío está visible pero no se
        // pudo leer, es un problema (probable cambio de markup de Google).
        if (await this.desafioActivo()) {
          problemaLectura =
            "No se pudo leer el desafío (posible cambio del widget). Recargá e intentá de nuevo.";
        }
      }

      // ¿error visible del widget del anchor? (no colgarse en "Verificando")
      const anchor = this.frameCheckbox();
      const errWidget = anchor
        ? await anchor
            .evaluate(() => {
              const el = document.querySelector(".rc-anchor-error-message");
              return el && getComputedStyle(el).display !== "none"
                ? (el as HTMLElement).innerText.trim()
                : null;
            })
            .catch(() => null)
        : null;

      const err = errWidget || problemaLectura;
      if (err) {
        if (err !== this.ultimoError) {
          this.ultimoError = err;
          this.emitir("error-widget", { mensaje: err });
        }
      } else {
        this.ultimoError = null;
      }
    } catch {
      /* la página puede estar navegando; ignorar el evento */
    } finally {
      this.leyendo = false;
    }
  }

  // Movimiento de mouse humanizado: curva con easing, jitter y delays. Google
  // mide trayectorias dentro del desafío; el click() directo es un teleport.
  private async clicHumano(x: number, y: number): Promise<void> {
    if (!this.page) return;
    const inicio = this.mousePos || { x: x - 180 - Math.random() * 120, y: y - 120 - Math.random() * 80 };
    const pasos = 14 + Math.floor(Math.random() * 10);
    for (let i = 1; i <= pasos; i++) {
      const t = i / pasos;
      const ease = t * t * (3 - 2 * t);
      const jx = Math.sin(t * Math.PI) * (Math.random() * 14 - 7);
      const jy = Math.cos(t * Math.PI) * (Math.random() * 14 - 7);
      await this.page.mouse.move(inicio.x + (x - inicio.x) * ease + jx, inicio.y + (y - inicio.y) * ease + jy);
      await sleep(6 + Math.random() * 22);
    }
    await this.page.mouse.move(x, y);
    await sleep(80 + Math.random() * 160);
    await this.page.mouse.down();
    await sleep(40 + Math.random() * 70);
    await this.page.mouse.up();
    this.mousePos = { x, y };
  }

  // Scroll del documento principal hasta un iframe del widget (permitido
  // cross-origin porque se hace desde el documento raíz).
  private async scrollAlWidget(srcFragment: string): Promise<void> {
    await this.page
      ?.evaluate((frag) => {
        const el = document.querySelector(`iframe[src*="${frag}"]`);
        if (el) el.scrollIntoView({ block: "center" });
      }, srcFragment)
      .catch(() => {});
    await sleep(200 + Math.random() * 300);
  }

  async clicCheckbox(): Promise<void> {
    const frame = this.frameCheckbox();
    if (!frame || !this.page) return;
    const border =
      (await frame.$(".recaptcha-checkbox-border").catch(() => null)) ||
      (await frame.$(".recaptcha-checkbox").catch(() => null));
    if (!border) {
      console.error("[captcha] WARNING: no se encontró el checkbox");
      return;
    }
    await this.scrollAlWidget("recaptcha/api2/anchor");
    const destino = await border.boundingBox();
    const enViewport =
      destino &&
      destino.y >= 0 &&
      destino.y + destino.height <= 800 &&
      destino.x >= 0 &&
      destino.x + destino.width <= 1280;
    if (enViewport && destino) {
      console.log("[captcha] clic humanizado en el checkbox");
      await this.clicHumano(destino.x + destino.width / 2, destino.y + destino.height / 2);
    } else {
      console.log("[captcha] checkbox fuera de viewport, fallback a click() nativo");
      await border.click().catch(() => {});
    }
    this.emitir("verificando");
    // El resultado (desafío / resuelto / error) llega por el MutationObserver.
  }

  async clicEnDesafio(nx: number, ny: number): Promise<void> {
    const target = await this.elementoDesafio();
    if (!target || !this.page) return;
    await this.scrollAlWidget("recaptcha/api2/bframe");
    const box = await target.boundingBox();
    if (!box) return;
    await this.clicHumano(box.x + nx * box.width, box.y + ny * box.height);
    // El reemplazo dinámico de la tile lo capta el MutationObserver.
  }

  async verificar(): Promise<void> {
    const frame = this.frameDesafio();
    if (!frame) return;
    const btn = await frame.$("#recaptcha-verify-button");
    if (btn) await btn.click();
    // La ronda siguiente / el ✔ / el error llegan por el MutationObserver.
  }

  async recargar(): Promise<void> {
    const frame = this.frameDesafio();
    if (!frame) return;
    const btn = await frame.$("#recaptcha-reload-button");
    if (btn) await btn.click();
    this.ultimoError = null;
    // El nuevo desafío llega por el MutationObserver.
  }
}
