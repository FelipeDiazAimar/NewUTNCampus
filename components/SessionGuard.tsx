"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Mantiene vivas las sesiones (Campus + Sysacad scraping) con keep-alive mientras
 * la pestaña está abierta, detecta cuándo se cierran (401), avisa en el header con
 * una cuenta regresiva y, al cerrarse, redirige al login correspondiente.
 *
 * Ambas sesiones expiran por INACTIVIDAD del lado del servidor (Moodle ~config,
 * ASP de Sysacad ~20 min) y se "deslizan" con cada request, así que el ping las
 * mantiene vivas. El WS (Basic legajo:DNI) no expira → no se vigila acá.
 *
 * Vercel no afecta esto: el keep-alive lo dispara el navegador. Cuando esto sea
 * una app nativa, un background task podría reemplazar al intervalo del cliente.
 */

type Key = "campus" | "scrape";

const CFG: Record<
  Key,
  { cookie: string; ping: string; del: string; interval: number; timeout: number; label: string; login: string; autoRedirect: boolean }
> = {
  campus: {
    cookie: "moodle_user",
    ping: "/api/auth",
    del: "/api/auth",
    interval: 4 * 60_000, // ping cada 4 min
    timeout: 28 * 60_000, // se asume cierre por inactividad ~28 min
    label: "del Campus",
    login: "/",
    autoRedirect: true, // el campus lo necesita toda la app → redirige solo
  },
  scrape: {
    cookie: "sysacad_user",
    ping: "/api/sysacad/ping",
    del: "/api/sysacad",
    interval: 8 * 60_000, // ASP ~20 min → ping cada 8 min
    timeout: 19 * 60_000,
    label: "de Sysacad",
    login: "/sysacad/login",
    autoRedirect: false, // solo las secciones de Sysacad la necesitan
  },
};

const WARN_MS = 120_000; // avisa en los últimos 2 minutos

function hasCookie(name: string): boolean {
  return typeof document !== "undefined" && document.cookie.includes(`${name}=`);
}

export default function SessionGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const [expires, setExpires] = useState<Record<Key, number | null>>({ campus: null, scrape: null });
  const [closed, setClosed] = useState<Record<Key, boolean>>({ campus: false, scrape: false });
  const [now, setNow] = useState(() => Date.now());
  const redirecting = useRef<Record<Key, boolean>>({ campus: false, scrape: false });

  const ping = useCallback(async (k: Key) => {
    if (document.visibilityState !== "visible" || !hasCookie(CFG[k].cookie)) return;
    try {
      const res = await fetch(CFG[k].ping, { method: "GET", cache: "no-store" });
      if (res.status === 401) {
        setClosed((c) => ({ ...c, [k]: true }));
      } else if (res.ok) {
        setExpires((e) => ({ ...e, [k]: Date.now() + CFG[k].timeout }));
        setClosed((c) => ({ ...c, [k]: false }));
      }
    } catch {
      /* error de red transitorio: no marcamos cerrada la sesión */
    }
  }, []);

  // Keep-alive: ping inicial, por intervalo y al volver a la pestaña.
  useEffect(() => {
    const keys: Key[] = ["campus", "scrape"];
    keys.forEach((k) => ping(k));
    const timers = keys.map((k) => setInterval(() => ping(k), CFG[k].interval));
    const onVisible = () => {
      if (document.visibilityState === "visible") keys.forEach((k) => ping(k));
    };
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      timers.forEach(clearInterval);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ping]);

  const goLogin = useCallback(
    async (k: Key) => {
      await fetch(CFG[k].del, { method: "DELETE" }).catch(() => {});
      router.replace(CFG[k].login);
    },
    [router]
  );

  // El cierre del Campus afecta a toda la app → redirige automáticamente al login.
  useEffect(() => {
    if (closed.campus && !redirecting.current.campus && pathname !== "/") {
      redirecting.current.campus = true;
      goLogin("campus");
    }
  }, [closed.campus, pathname, goLogin]);

  // Determina la alerta más urgente (cerrada > por vencer; campus > sysacad).
  let alert: { k: Key; type: "closed" | "warn"; remaining: number } | null = null;
  for (const k of ["campus", "scrape"] as Key[]) {
    if (!hasCookie(CFG[k].cookie)) continue;
    if (closed[k]) {
      alert = { k, type: "closed", remaining: 0 };
      break;
    }
  }
  if (!alert) {
    for (const k of ["campus", "scrape"] as Key[]) {
      if (!hasCookie(CFG[k].cookie) || closed[k]) continue;
      const exp = expires[k];
      if (exp != null) {
        const remaining = exp - now;
        if (remaining > 0 && remaining <= WARN_MS) {
          alert = { k, type: "warn", remaining };
          break;
        }
      }
    }
  }

  if (!alert) return null;

  const cfg = CFG[alert.k];
  const mmss = (() => {
    const s = Math.max(0, Math.floor(alert!.remaining / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  })();

  const isClosed = alert.type === "closed";

  return (
    <div className="max-w-[1600px] mx-auto px-4 -mt-4 mb-4">
      <div
        className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5 shadow-sm border"
        style={
          isClosed
            ? { background: "#ff3b3014", borderColor: "rgba(255,59,48,0.3)", color: "#ff3b30" }
            : { background: "#ff950014", borderColor: "rgba(255,149,0,0.3)", color: "#ff9500" }
        }
        role="alert"
      >
        <AlertTriangle className="w-[18px] h-[18px] shrink-0" />
        <span className="flex-1 text-[13px] font-medium">
          {isClosed
            ? `Tu sesión ${cfg.label} se cerró.`
            : `Tu sesión ${cfg.label} se cierra en ${mmss}.`}
        </span>
        {isClosed ? (
          <button
            type="button"
            onClick={() => goLogin(alert!.k)}
            className="shrink-0 rounded-full bg-[#ff3b30] text-white text-[12px] font-semibold px-3 py-1.5 active:opacity-80"
          >
            Reingresar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => ping(alert!.k)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[#ff9500] text-white text-[12px] font-semibold px-3 py-1.5 active:opacity-80"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Seguir conectado
          </button>
        )}
      </div>
    </div>
  );
}
