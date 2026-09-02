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
import type { Browser, BrowserContext, Frame, Page } from "playwright-core";

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

// Flags que sacan las señales más obvias de automatización.
const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
  "--disable-infobars",
  "--no-default-browser-check",
  "--disable-dev-shm-usage",
];
// Playwright agrega --enable-automation por defecto (delata al navegador).
const IGNORAR_ARGS = ["--enable-automation", "--disable-extensions"];

// ── Proxy (residencial) ──────────────────────────────────────────────────────
// La IP de datacenter de Vercel arrastra mala reputación con reCAPTCHA (bucle
// infinito de desafíos 4x4). El headless sale por un proxy.
//
// CAPTCHA_PROXIES (opcional, OPT-IN): lista separada por coma o salto de línea.
// Cada entrada: host:port | http://host:port | http://usuario:clave@host:port |
// socks5://host:port  (socks4 NO lo soporta Playwright).
//   - sin la variable => salida directa (comportamiento por defecto).
// Se prueban en tandas de 5 y se usa el primero que conecta (CONNECT a infra de
// Google). Pensado para una lista de proxies RESIDENCIALES de verdad; las
// listas públicas gratis probaron estar muertas/inalcanzables desde Vercel.
type ProxyCfg = { server: string; username?: string; password?: string };

const MAX_PROXY_INTENTOS = 20;

function parsearProxies(): ProxyCfg[] {
  const env = process.env.CAPTCHA_PROXIES?.trim();
  if (!env || /^(off|none|direct)$/i.test(env)) return [];
  return env
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok): ProxyCfg => {
      const conEsquema = tok.includes("://") ? tok : "http://" + tok;
      try {
        const u = new URL(conEsquema);
        const cfg: ProxyCfg = { server: `${u.protocol}//${u.host}` };
        if (u.username) cfg.username = decodeURIComponent(u.username);
        if (u.password) cfg.password = decodeURIComponent(u.password);
        return cfg;
      } catch {
        return { server: conEsquema };
      }
    })
    .slice(0, MAX_PROXY_INTENTOS);
}

const HAY_PROXY = parsearProxies().length > 0;

// CAPTCHA_HEADFUL=1 => Chrome con ventana visible (solo tiene sentido en el
// worker de escritorio: con IP residencial + navegador real la reputación con
// reCAPTCHA es casi perfecta). En Vercel se ignora (siempre headless).
const HEADFUL = process.env.CAPTCHA_HEADFUL === "1" && process.platform !== "linux";

// En Vercel: @sparticuz/chromium (binario Linux para serverless, se descomprime
// en /tmp). En dev local / worker (no-Linux): cae al playwright completo.
async function lanzarChromium() {
  // Si hay proxies, se lanza con un proxy "per-context" ficticio para poder
  // fijar el proxy real (y rotarlo) a nivel de contexto sin relanzar Chromium.
  const proxy = HAY_PROXY ? { server: "http://per-context" } : undefined;
  const { chromium } = await import("playwright-core");
  if (process.platform === "linux") {
    const core = await import("@sparticuz/chromium");
    const chromiumPkg = core.default ?? core;
    const executablePath = await chromiumPkg.executablePath();
    return chromium.launch({
      args: [...(chromiumPkg.args ?? []), ...STEALTH_ARGS],
      ignoreDefaultArgs: IGNORAR_ARGS,
      executablePath,
      headless: true,
      proxy,
    });
  }
  const full = await import("playwright");
  return full.chromium.launch({
    ignoreDefaultArgs: IGNORAR_ARGS,
    headless: !HEADFUL,
    args: [...STEALTH_ARGS, "--window-size=1280,800"],
    proxy,
  });
}

// Parche de fingerprint que corre en TODOS los frames antes de sus scripts:
// borra navigator.webdriver, rellena languages/plugins/chrome y falsea el
// vendor de WebGL — las señales que reCAPTCHA usa para marcar "headless".
const STEALTH_INIT = `
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en'] });
  } catch (e) {}
  try {
    const mk = (name) => ({ name, filename: name, description: '', length: 1 });
    const plugins = [mk('Chrome PDF Plugin'), mk('Chrome PDF Viewer'), mk('Native Client')];
    Object.defineProperty(navigator, 'plugins', { get: () => plugins });
    Object.defineProperty(navigator, 'mimeTypes', { get: () => [{ type: 'application/pdf' }] });
  } catch (e) {}
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  } catch (e) {}
  try {
    const q = navigator.permissions && navigator.permissions.query;
    if (q) {
      navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission, onchange: null })
          : q(p);
    }
  } catch (e) {}
  try {
    const gp = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (n) {
      if (n === 37445) return 'Intel Inc.';
      if (n === 37446) return 'Intel Iris OpenGL Engine';
      return gp.call(this, n);
    };
  } catch (e) {}
})();
`;

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
  private eventos = 0;

  constructor(send: EnviarFn) {
    this.send = send;
  }

  static get cupoDisponible(): boolean {
    return sesionesActivas < MAX_SESIONES_CAPTCHA;
  }

  private emitir(fase: string, extra: Record<string, unknown> = {}) {
    this.send({ type: "estado", fase, ...extra });
  }

  // Traza de diagnóstico: va a los Runtime Logs de Vercel Y al cliente (panel
  // colapsable del widget), para ver en qué paso falla sin abrir el dashboard.
  private diag(paso: string, detalle?: unknown) {
    let d: unknown = detalle;
    try {
      d = detalle === undefined ? undefined : JSON.parse(JSON.stringify(detalle));
    } catch {
      d = String(detalle);
    }
    console.log("[captcha:diag]", paso, d ?? "");
    this.send({ type: "diag", paso, detalle: d, t: Date.now() });
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
      this.diag("iniciar:lanzando-chromium");
      this.browser = await lanzarChromium();
      this.diag("iniciar:chromium-ok");
    } catch (e) {
      sesionesActivas--;
      this.diag("iniciar:chromium-ERROR", String((e as Error).message || e));
      throw e;
    }
    const opcsContext = {
      userAgent: UA,
      viewport: { width: 1280, height: 800 },
      locale: "es-AR",
      timezoneId: "America/Argentina/Cordoba",
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      colorScheme: "light" as const,
      extraHTTPHeaders: { "Accept-Language": "es-AR,es;q=0.9,en;q=0.8" },
    };

    const proxies = parsearProxies();
    let context: BrowserContext | null = null;
    if (proxies.length === 0) {
      context = await this.browser.newContext(opcsContext);
      this.diag("proxy:directo", "CAPTCHA_PROXIES=off");
    } else {
      this.diag("proxy:probando-lista", { candidatos: proxies.length });
      context = await this.elegirProxy(proxies, opcsContext);
      if (!context) {
        this.diag("proxy:TODOS-FALLARON", `${proxies.length} proxies sin conexión`);
        throw new Error(
          `Ninguno de los ${proxies.length} proxies respondió. Probá otra lista en CAPTCHA_PROXIES, o CAPTCHA_PROXIES=off para salir directo.`
        );
      }
    }

    // Parche de fingerprint antes de cualquier script de la página.
    await context.addInitScript(STEALTH_INIT);
    this.page = await context.newPage();
    this.diag("iniciar:context-ok");

    // Binding disponible en window de TODOS los frames (incluidos los iframes
    // cross-origin del reCAPTCHA y los que se creen después, como el bframe del
    // desafío). Se registra una sola vez, antes de navegar.
    await this.page.exposeFunction("__captchaEvento", () => this.onMutacion());
    this.diag("iniciar:binding-expuesto");

    // Reinyecta el observer cuando el bframe se crea / re-navega (nueva ronda,
    // recarga del desafío).
    this.page.on("frameattached", (f) => void this.instalarObserver(f));
    this.page.on("framenavigated", (f) => void this.instalarObserver(f));

    try {
      // 90s: por el túnel residencial la página del legacy + embeds cargan lento.
      await this.page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
      this.diag("iniciar:goto-ok", `${BASE}/`);
    } catch (e) {
      this.diag("iniciar:goto-ERROR", String((e as Error).message || e));
      throw e;
    }
    try {
      await this.page.waitForFunction(
        () =>
          typeof (globalThis as { grecaptcha?: unknown }).grecaptcha !== "undefined" &&
          !!document.querySelector(".g-recaptcha iframe"),
        { timeout: 20000 }
      );
      this.diag("iniciar:grecaptcha-listo");
    } catch (e) {
      this.diag(
        "iniciar:grecaptcha-TIMEOUT",
        "no apareció grecaptcha/.g-recaptcha iframe en 20s — ¿cambió la página del legacy?"
      );
      throw e;
    }

    // Observers en el frame principal + los que ya existan (anchor).
    await this.instalarObserver(this.page.mainFrame());
    for (const f of this.page.frames()) await this.instalarObserver(f);
    this.diag("iniciar:observers-instalados", {
      frames: this.page.frames().map((f) => f.url().slice(0, 80)),
    });

    // Warm-up: un rato de "actividad humana" (mouse paseando, scroll suave)
    // antes de que el usuario tilde el checkbox. reCAPTCHA puntúa el
    // comportamiento previo, no solo el clic.
    await this.warmup();

    this.emitir("listo");
    // Lectura inicial por si el widget ya trae estado.
    this.onMutacion();
  }

  // Prueba proxies en tandas paralelas (5 a la vez) con un CONNECT a infra de
  // Google. Devuelve el contexto del primero que conecta y cierra el resto.
  private async elegirProxy(
    proxies: ProxyCfg[],
    opcs: Parameters<Browser["newContext"]>[0]
  ): Promise<BrowserContext | null> {
    if (!this.browser) return null;
    const TANDA = 3;
    // Muy generoso: por un túnel público (bore.pub) el primer request en frío
    // puede tardar decenas de segundos.
    const TIMEOUT = 60000;
    for (let base = 0; base < proxies.length && !this.abortado; base += TANDA) {
      const grupo = proxies.slice(base, base + TANDA);
      const pruebas = grupo.map(async (px) => {
        let ctx: BrowserContext | null = null;
        try {
          ctx = await this.browser!.newContext({ ...opcs, proxy: px });
          const p = await ctx.newPage();
          // robots.txt: 200 con cuerpo (un 204 rompe la navegación top-level),
          // en infra de Google => valida también que Google es alcanzable.
          // waitUntil "commit": alcanza con que llegue la respuesta.
          await p.goto("https://www.google.com/robots.txt", {
            timeout: TIMEOUT,
            waitUntil: "commit",
          });
          await p.close();
          return { ok: true as const, ctx, server: px.server };
        } catch (e) {
          try {
            await ctx?.close();
          } catch {
            /* nada */
          }
          return { ok: false as const, server: px.server, error: String((e as Error).message || e) };
        }
      });
      const resultados = await Promise.all(pruebas);
      const ganador = resultados.find((r) => r.ok);
      for (const r of resultados) {
        if (r === ganador) continue;
        if (r.ok) {
          try {
            await r.ctx.close();
          } catch {
            /* nada */
          }
        } else {
          this.diag("proxy:fallo", { server: r.server, error: r.error.slice(0, 60) });
        }
      }
      if (ganador && ganador.ok) {
        this.diag("proxy:ok", { server: ganador.server, intento: base + 1 });
        return ganador.ctx;
      }
      // Si el navegador se cayó durante la tanda, no tiene sentido seguir.
      const muerto =
        !this.browser.isConnected() ||
        resultados.some((r) => !r.ok && /has been closed|Target (page|closed)|browserContext/i.test(r.error));
      if (muerto) {
        this.diag("proxy:navegador-caido", "el sondeo tumbó a Chromium; corto acá");
        return null;
      }
    }
    return null;
  }

  private async warmup(): Promise<void> {
    if (!this.page) return;
    try {
      const puntos: Array<[number, number]> = [
        [200 + Math.random() * 300, 200 + Math.random() * 200],
        [500 + Math.random() * 400, 300 + Math.random() * 250],
        [300 + Math.random() * 500, 450 + Math.random() * 200],
      ];
      for (const [x, y] of puntos) {
        await this.page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 10) });
        await sleep(120 + Math.random() * 260);
      }
      await this.page.mouse.wheel(0, 120 + Math.random() * 160);
      await sleep(300 + Math.random() * 500);
      await this.page.mouse.wheel(0, -(80 + Math.random() * 120));
      await sleep(400 + Math.random() * 700);
      this.diag("iniciar:warmup-ok");
    } catch (e) {
      this.diag("iniciar:warmup-error", String((e as Error).message || e).slice(0, 80));
    }
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
    const cual = url.includes("anchor") ? "anchor" : url.includes("bframe") ? "bframe" : "main";
    const res = await frame
      .evaluate(() => {
        const w = window as unknown as { __obsCaptcha?: MutationObserver; __captchaEvento?: () => void };
        if (typeof w.__captchaEvento !== "function") return "sin-binding";
        if (w.__obsCaptcha) return "ya-instalado";
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
        return "instalado";
      })
      .catch((e: Error) => "error: " + String(e.message || e).slice(0, 80));
    if (res !== "ya-instalado") this.diag("observer:" + cual, res);
  }

  // Disparador de evento: coalesce la ráfaga de mutaciones y procesa una vez.
  private onMutacion(): void {
    if (this.abortado) return;
    this.eventos++;
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
        // 3x3/4x4 inicial; las celdas la recortan por geometría). Se re-apunta
        // a la tabla entrante más abajo, ya calculada `tabla`.
        let imgGrande =
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
          // Redondeo a entero: el sub-pixel de getBoundingClientRect fluctúa
          // entre lecturas y haría cambiar la firma del DOM en cada evento
          // (re-emisiones fantasma => la grilla "parpadea" y nunca avanza).
          const sizeX = Math.round((IW / CW) * 100);
          const sizeY = Math.round((IH / CH) * 100);
          const posX = IW > CW ? Math.round(((cr.left - ir.left) / (IW - CW)) * 100) : 50;
          const posY = IH > CH ? Math.round(((cr.top - ir.top) / (IH - CH)) * 100) : 50;
          return {
            pos: `${posX}% ${posY}%`,
            size: `${sizeX}% ${sizeY}%`,
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
                  : `${Math.round((parseFloat(v) / base) * 100)}%`;
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

        // Durante la transición entre desafíos reCAPTCHA deja DOS tablas en el
        // DOM (la saliente + la entrante) => leer todos los <td> daba grillas
        // fantasma de 32 celdas / 8 filas. Nos quedamos con la última tabla
        // visible (la entrante).
        const tablas = Array.from(target.querySelectorAll("table")).filter(
          (t) => (t as HTMLElement).offsetHeight > 0 && (t as HTMLElement).getClientRects().length > 0
        );
        const tabla: Element = tablas[tablas.length - 1] || target;
        imgGrande =
          (tabla.querySelector(
            "img[class*='rc-image-tile'], img[src*='payload'], img[src*='recaptcha']"
          ) as HTMLImageElement | null) ||
          (tabla.querySelector("img") as HTMLImageElement | null) ||
          imgGrande;

        // Unidades de celda: los td mantienen la alineación de la grilla
        // (un td sin tile => celda null/consumida, no se salta).
        const tds = tabla.querySelectorAll("td");
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

        const trs = tabla.querySelectorAll("tr").length;
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
        const g = (globalThis as { grecaptcha?: { getResponse: (id?: number) => string } }).grecaptcha;
        if (!g) return "__no-grecaptcha__";
        try {
          return g.getResponse() || "";
        } catch {
          return "";
        }
      });
      if (token === "__no-grecaptcha__") {
        this.diag("procesar:sin-grecaptcha", "window.grecaptcha no existe en el frame principal");
      } else if (token) {
        this._token = token;
        this.diag("procesar:RESUELTO", { tokenLen: token.length });
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
          this.diag("procesar:desafio", {
            evento: this.eventos,
            celdas: dom.celdas.length,
            nulas: dom.celdas.filter((c) => c === null).length,
            imgs: dom.imgs.length,
            filas: dom.filas,
            texto: dom.texto.slice(0, 60),
          });
          this.emitir("desafio", {
            texto: dom.texto,
            filas: dom.filas,
            imgs: dom.imgs,
            celdas: dom.celdas,
          });
        }
      } else {
        this.domFirma = null;
        const activo = await this.desafioActivo();
        this.diag("procesar:sin-desafio-legible", {
          motivoDom: this.ultimoMotivoDom,
          desafioVisible: activo,
        });
        // Sin fallback de screenshot: si el desafío está visible pero no se
        // pudo leer, es un problema (probable cambio de markup de Google).
        if (activo) {
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
      if (errWidget) this.diag("procesar:error-anchor", errWidget);

      const err = errWidget || problemaLectura;
      if (err) {
        if (err !== this.ultimoError) {
          this.ultimoError = err;
          this.emitir("error-widget", { mensaje: err });
        }
      } else {
        this.ultimoError = null;
      }
    } catch (e) {
      this.diag("procesar:EXCEPCION", String((e as Error).message || e).slice(0, 160));
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
    if (!frame || !this.page) {
      this.diag("clic-checkbox:SIN-FRAME-ANCHOR");
      return;
    }
    const border =
      (await frame.$(".recaptcha-checkbox-border").catch(() => null)) ||
      (await frame.$(".recaptcha-checkbox").catch(() => null));
    if (!border) {
      this.diag("clic-checkbox:SIN-CHECKBOX", "no se encontró .recaptcha-checkbox-border");
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
      this.diag("clic-checkbox:humano", { x: Math.round(destino.x), y: Math.round(destino.y) });
      await this.clicHumano(destino.x + destino.width / 2, destino.y + destino.height / 2);
    } else {
      this.diag("clic-checkbox:nativo", { box: destino, motivo: "fuera de viewport" });
      await border.click().catch((e) => this.diag("clic-checkbox:click-ERROR", String(e)));
    }
    this.emitir("verificando");
    // El resultado (desafío / resuelto / error) llega por el MutationObserver.
  }

  async clicEnDesafio(nx: number, ny: number): Promise<void> {
    const frame = this.frameDesafio();
    if (!frame || !this.page) {
      this.diag("clic-tile:SIN-FRAME-BFRAME");
      return;
    }
    const target = await this.elementoDesafio();
    if (!target) {
      this.diag("clic-tile:SIN-TARGET");
      return;
    }
    await this.scrollAlWidget("recaptcha/api2/bframe");
    const box = await target.boundingBox();
    if (!box) {
      this.diag("clic-tile:SIN-BOX");
      return;
    }
    const x = box.x + nx * box.width;
    const y = box.y + ny * box.height;

    // Diagnóstico de mapeo de coordenadas: comparo el rect del target usado
    // contra el de la tabla real y reporto qué elemento cae en el punto
    // normalizado (dentro del bframe). Si "enPunto" no es una tile, el mapeo
    // está mal.
    const geo = await frame
      .evaluate((n: { nx: number; ny: number }) => {
        const t =
          document.querySelector("#rc-imageselect-target") ||
          document.querySelector(".rc-imageselect-target");
        const tabla = document.querySelector("table");
        const r = (el: Element | null) =>
          el ? (({ x, y, w, h }) => ({ x, y, w, h }))({
            x: Math.round(el.getBoundingClientRect().left),
            y: Math.round(el.getBoundingClientRect().top),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
          }) : null;
        const tr = (t || tabla)?.getBoundingClientRect();
        let enPunto = "";
        if (tr) {
          const el = document.elementFromPoint(tr.left + n.nx * tr.width, tr.top + n.ny * tr.height);
          enPunto = el ? `${el.tagName}.${(el.className || "").toString().slice(0, 40)}` : "null";
        }
        return { target: r(t), tabla: r(tabla), enPunto };
      }, { nx, ny })
      .catch((e: Error) => ({ error: String(e.message || e) }));
    this.diag("clic-tile", { nx: +nx.toFixed(3), ny: +ny.toFixed(3), abs: { x: Math.round(x), y: Math.round(y) }, geo });

    await this.clicHumano(x, y);
    // El reemplazo dinámico de la tile lo capta el MutationObserver.
  }

  async verificar(): Promise<void> {
    const frame = this.frameDesafio();
    if (!frame) {
      this.diag("verificar:SIN-FRAME-BFRAME");
      return;
    }
    const btn = await frame.$("#recaptcha-verify-button");
    if (!btn) {
      this.diag("verificar:SIN-BOTON", "no se encontró #recaptcha-verify-button");
      return;
    }
    const info = await btn
      .evaluate((b) => ({
        texto: (b as HTMLElement).innerText.trim(),
        disabled: (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true",
      }))
      .catch(() => null);
    this.diag("verificar:click", info);
    await btn.click().catch((e) => this.diag("verificar:click-ERROR", String(e)));
    // La ronda siguiente / el ✔ / el error llegan por el MutationObserver.
  }

  async recargar(): Promise<void> {
    const frame = this.frameDesafio();
    if (!frame) {
      this.diag("recargar:SIN-FRAME-BFRAME");
      return;
    }
    const btn = await frame.$("#recaptcha-reload-button");
    if (!btn) {
      this.diag("recargar:SIN-BOTON");
      return;
    }
    this.diag("recargar:click");
    await btn.click().catch((e) => this.diag("recargar:click-ERROR", String(e)));
    this.ultimoError = null;
    // El nuevo desafío llega por el MutationObserver.
  }
}
