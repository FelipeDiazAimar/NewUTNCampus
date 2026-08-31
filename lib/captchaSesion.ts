// Sesión de captcha remoto: Chromium headless cargando la página ORIGINAL de
// turnos (dominio correcto => el widget reCAPTCHA renderiza nativo) y control
// remoto del widget vía Playwright.
//
// Port de scripts/captcha-remoto/server.mjs (prototipo funcional y probado).
// Las constantes de selectores y el comportamiento se validaron contra el
// widget real entre el 30 y el 31/08/2026.

import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright-core";

const BASE = "https://turnos.frsfco.utn.edu.ar:4443";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

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
  private polling: ReturnType<typeof setInterval> | null = null;
  private leyendo = false;
  private domFirma: string | null = null;
  // Fallback screenshot (si la lectura DOM falla)
  private ultimaImagenActiva = false;
  private ultimoHash: string | null = null;
  private refrescarHasta = 0;
  private hashDesde = 0;
  private imgPendiente: string | null = null;
  private textoPendiente = "";
  private filasPendiente = 3;
  private ultimoError: string | null = null;
  private mousePos: { x: number; y: number } | null = null;

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
    await this.page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.page.waitForFunction(
      () =>
        typeof (globalThis as { grecaptcha?: unknown }).grecaptcha !== "undefined" &&
        !!document.querySelector(".g-recaptcha iframe"),
      { timeout: 20000 }
    );
    this.emitir("listo");
    this.arrancarPolling();
  }

  async cerrar(): Promise<void> {
    this.abortado = true;
    if (this.polling) clearInterval(this.polling);
    this.polling = null;
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
  // Serializa la grilla real celda por celda. Las imágenes viajan como
  // data-URLs (únicas, dedupeadas): las tiles a veces son data-URLs y a veces
  // URLs a google.com/recaptcha/api2/payload, que el navegador del usuario NO
  // puede cargar (CORP: Cross-Origin-Resource-Policy same-origin) — por eso se
  // hace fetch same-origin desde el propio iframe y se convierte a data-URL.
  // Cada celda lleva pos/size del background porque puede tratarse de un
  // sprite único cortado con background-position.
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
        if (!inst || !target || (target as HTMLElement).offsetHeight === 0) return null;

        const tds = target.querySelectorAll("td");
        if (!tds.length) return null;

        const aDataUrl = async (url: string): Promise<string> => {
          if (!url || url.startsWith("data:")) return url;
          try {
            const blob = await fetch(url, { credentials: "include", cache: "no-store" }).then((r) => r.blob());
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

        const imgs: string[] = [];
        const mapa = new Map<string, number>(); // url original -> índice en imgs
        const celdas: { i: number; pos: string; size: string }[] = [];
        let vacias = 0;

        for (const td of tds) {
          const tileEl =
            td.querySelector<HTMLElement>(".rc-image-tile") ||
            td.querySelector<HTMLElement>('[style*="background-image"]');
          if (!tileEl) {
            celdas.push(null as unknown as { i: number; pos: string; size: string });
            vacias++;
            continue;
          }
          const cs = getComputedStyle(tileEl);
          const m = cs.backgroundImage && cs.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
          const urlOriginal = m ? m[1] : td.querySelector("img")?.src || "";
          if (!urlOriginal) {
            celdas.push(null as unknown as { i: number; pos: string; size: string });
            vacias++;
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

        // Si ninguna celda tiene imagen utilizable, el markup cambió: que el
        // llamador caiga al modo screenshot.
        if (vacias === celdas.length) return null;

        return {
          texto: (inst as HTMLElement).innerText.trim(),
          filas: target.querySelectorAll("tr").length || 3,
          imgs,
          celdas,
        };
      })
      .catch(() => null);
    if (!leido) return null;
    // data-URLs vacías por fallo de fetch => marcamos la celda como vacía
    const celdas = leido.celdas.map((c) =>
      c && leido.imgs[c.i] === "" ? null : c
    );
    return { texto: leido.texto, filas: leido.filas, imgs: leido.imgs, celdas };
  }

  private arrancarPolling() {
    this.polling = setInterval(() => this.pollTick(), 500);
  }

  // Re-lectura inmediata después de una acción: los desafíos dinámicos
  // reemplazan la imagen de la tile al seleccionarla, sin apretar VERIFICAR.
  private programarRelectura() {
    setTimeout(() => this.pollTick(), 250);
  }

  private async pollTick(): Promise<void> {
    if (this.abortado || !this.page || this.leyendo) return;
    this.leyendo = true;
    try {
      // ¿token?
      const token = await this.page.evaluate(() => {
        const g = (globalThis as { grecaptcha?: { getResponse: () => string } }).grecaptcha;
        return g ? g.getResponse() : "";
      });
      if (token) {
        this._token = token;
        if (this.polling) clearInterval(this.polling);
        this.polling = null;
        this.emitir("resuelto", { token });
        return;
      }

      // ¿desafío de imágenes? — modo DOM (espejo estructurado)
      const dom = await this.leerDesafioDOM();
      if (dom) {
        const firma = JSON.stringify(dom);
        if (firma !== this.domFirma) {
          this.domFirma = firma;
          this.emitir("desafio", {
            modo: "dom",
            texto: dom.texto,
            filas: dom.filas,
            imgs: dom.imgs,
            celdas: dom.celdas,
          });
        }
      } else {
        // Fallback: lectura por screenshot (comportamiento probado de Fase 1)
        this.domFirma = null;
        await this.pollTickScreenshot();
      }

      // ¿error visible del widget? (no colgarse en "Verificando")
      const anchor = this.frameCheckbox();
      if (anchor) {
        const err = await anchor
          .evaluate(() => {
            const el = document.querySelector(".rc-anchor-error-message");
            return el && getComputedStyle(el).display !== "none" ? (el as HTMLElement).innerText.trim() : null;
          })
          .catch(() => null);
        if (err && err !== this.ultimoError) {
          this.ultimoError = err;
          this.emitir("error-widget", { mensaje: err });
        } else if (!err) {
          this.ultimoError = null;
        }
      }
    } catch {
      /* la página puede estar navegando; ignorar el tick */
    } finally {
      this.leyendo = false;
    }
  }

  // Modo screenshot: solo si la lectura DOM no devuelve nada pero el desafío
  // sigue activo (markup de Google cambiado, etc).
  private async pollTickScreenshot(): Promise<void> {
    const desafio = this.frameDesafio();
    if (!desafio) return;
    const activo = await desafio
      .evaluate(() => {
        const inst = document.querySelector(".rc-imageselect-instructions");
        const target =
          document.querySelector("#rc-imageselect-target") ||
          document.querySelector(".rc-imageselect-target") ||
          document.querySelector("table");
        return inst && target && (target as HTMLElement).offsetHeight > 0
          ? { texto: (inst as HTMLElement).innerText.trim() }
          : null;
      })
      .catch(() => null);
    if (!activo) {
      this.ultimaImagenActiva = false;
      this.ultimoHash = null;
      this.imgPendiente = null;
      return;
    }
    const target = await this.elementoDesafio();
    if (!target) return;
    const enVentana = Date.now() < this.refrescarHasta;
    if (!this.ultimaImagenActiva || enVentana) {
      const img = await target.screenshot({ type: "jpeg", quality: 55 });
      const hash = img.toString("base64");
      if (hash !== this.ultimoHash) {
        this.ultimoHash = hash;
        this.hashDesde = Date.now();
        this.imgPendiente = img.toString("base64");
        this.textoPendiente = activo.texto;
        this.filasPendiente = await desafio
          .evaluate(() => document.querySelectorAll(".rc-imageselect-target tr").length || 3)
          .catch(() => 3);
      } else if (this.imgPendiente && Date.now() - this.hashDesde >= 500) {
        this.ultimaImagenActiva = true;
        this.refrescarHasta = 0;
        this.emitir("desafio", {
          modo: "screenshot",
          texto: this.textoPendiente,
          filas: this.filasPendiente,
          imagen: this.imgPendiente,
        });
        this.imgPendiente = null;
      }
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
    this.programarRelectura();
  }

  async clicEnDesafio(nx: number, ny: number): Promise<void> {
    const target = await this.elementoDesafio();
    if (!target || !this.page) return;
    await this.scrollAlWidget("recaptcha/api2/bframe");
    const box = await target.boundingBox();
    if (!box) return;
    await this.clicHumano(box.x + nx * box.width, box.y + ny * box.height);
    this.programarRelectura();
  }

  async verificar(): Promise<void> {
    const frame = this.frameDesafio();
    if (!frame) return;
    const btn = await frame.$("#recaptcha-verify-button");
    if (btn) await btn.click();
    this.ultimaImagenActiva = false;
    this.ultimoHash = null;
    this.imgPendiente = null;
    this.refrescarHasta = Date.now() + 15000;
    this.programarRelectura();
  }

  async recargar(): Promise<void> {
    const frame = this.frameDesafio();
    if (!frame) return;
    const btn = await frame.$("#recaptcha-reload-button");
    if (btn) await btn.click();
    this.ultimaImagenActiva = false;
    this.ultimoHash = null;
    this.imgPendiente = null;
    this.refrescarHasta = Date.now() + 15000;
    this.programarRelectura();
  }
}
