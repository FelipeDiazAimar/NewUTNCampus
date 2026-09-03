#!/usr/bin/env node
// Daemon de asistencia — corre en una PC de casa (o del autor).
//
// Loguea al "Control de Asistencias" legacy con una cuenta-bot, pollea
// apply-leave.php cada ~2 min y, si hay materia(s) habilitada(s), llama a
// /api/webhooks/asistencia (que hace el broadcast idempotente por día/materia).
// Manda un heartbeat con métricas cada 10s a /api/asistencia/worker/heartbeat.
//
// Se corre con el TypeScript nativo de Node 22.6+/24 (node daemon.mts).
// Lo orquesta supervisor.mts (que lo reinicia y atiende comandos).
//
// Reemplaza al viejo agent.js de la raíz.

import os from "node:os";
import axios from "axios";
import * as cheerio from "cheerio";
import { CookieJar } from "tough-cookie";
import { metricas } from "./metricas.mts";

const CONFIG = {
  baseUrl: process.env.ASISTENCIA_BASE_URL || "https://asistencia.frsfco.utn.edu.ar:4443",
  appUrl: (process.env.CAMPUS_APP_URL || "https://campus-utn.vercel.app").replace(/\/$/, ""),
  secret: process.env.NOTIFICATIONS_WEBHOOK_SECRET || "",
  staticCookie: process.env.ASISTENCIA_COOKIE || "",
  username: process.env.ASISTENCIA_USER || "",
  password: process.env.ASISTENCIA_PASSWORD || "",
  usernameField: process.env.ASISTENCIA_USER_FIELD || "username",
  passwordField: process.env.ASISTENCIA_PASSWORD_FIELD || "password",
  loginPath: process.env.ASISTENCIA_LOGIN_PATH || "/index.php",
  pollMs: Number(process.env.ASISTENCIA_POLL_MS || 120000),
  workerId: (process.env.ASISTENCIA_WORKER_NAME || os.hostname() || "asistencia-daemon").slice(0, 80),
};

const jar = new CookieJar();
const client = axios.create({
  baseURL: CONFIG.baseUrl,
  timeout: 20000,
  maxRedirects: 5,
  headers: {
    "User-Agent": "Mozilla/5.0 CampusUTN-AsistenciaDaemon/1.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

client.interceptors.request.use(async (cfg) => {
  const url = new URL(cfg.url || "", cfg.baseURL || CONFIG.baseUrl).toString();
  const cookie = await jar.getCookieString(url);
  cfg.headers = cfg.headers ?? {};
  if (cookie) cfg.headers.Cookie = cookie;
  if (CONFIG.staticCookie) {
    cfg.headers.Cookie = [cfg.headers.Cookie, CONFIG.staticCookie].filter(Boolean).join("; ");
  }
  return cfg;
});
client.interceptors.response.use(async (res) => {
  const setCookie = (res.headers["set-cookie"] as string[] | undefined) || [];
  const url = res.config.url
    ? new URL(res.config.url, res.config.baseURL || CONFIG.baseUrl).toString()
    : CONFIG.baseUrl;
  await Promise.all(setCookie.map((c) => jar.setCookie(c, url)));
  return res;
});

function ts(): string {
  return new Date().toISOString();
}

function formParamsFromHtml(html: string, extra: Record<string, string>): URLSearchParams {
  const $ = cheerio.load(html);
  const params = new URLSearchParams();
  $("form input").each((_, input) => {
    const name = $(input).attr("name");
    if (!name) return;
    params.set(name, $(input).attr("value") || "");
  });
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return params;
}

async function loginIfNeeded(): Promise<void> {
  if (CONFIG.staticCookie || !CONFIG.username || !CONFIG.password) {
    metricas.setLoginOk(!!CONFIG.staticCookie);
    return;
  }
  const page = await client.get(CONFIG.loginPath);
  const params = formParamsFromHtml(page.data, {
    [CONFIG.usernameField]: CONFIG.username,
    [CONFIG.passwordField]: CONFIG.password,
  });
  await client.post(CONFIG.loginPath, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  metricas.setLoginOk(true);
}

type Opcion = { id: string; name: string };

function parseActiveAttendance(html: string): { isOpen: boolean; activeOptions: Opcion[] } {
  const $ = cheerio.load(html);
  const activeOptions: Opcion[] = [];
  $('select[name="id_materia"] option').each((_, option) => {
    const el = $(option);
    const id = el.attr("value") || "";
    const name = el.text().replace(/\s+/g, " ").trim();
    const habilitada = (el.attr("data-habilitada") || "").toUpperCase();
    if (id && name && !el.is("[disabled]") && habilitada === "S") {
      activeOptions.push({ id, name });
    }
  });
  return { isOpen: activeOptions.length > 0, activeOptions };
}

async function avisarWebhook(activeOptions: Opcion[]): Promise<void> {
  const res = await axios.post(
    `${CONFIG.appUrl}/api/webhooks/asistencia`,
    { source: "asistencia-daemon", activeOptions },
    {
      timeout: 20000,
      headers: { "Content-Type": "application/json", "x-agent-secret": CONFIG.secret },
    }
  );
  const materias = (res.data?.materias ?? []) as {
    materia: string;
    enviado: boolean;
    sent?: number;
  }[];
  for (const m of materias) {
    metricas.agregarMateria(m.materia);
    if (m.enviado && m.sent) metricas.sumarPushes(m.sent);
  }
  const enviadas = materias.filter((m) => m.enviado).length;
  console.log(`[${ts()}] webhook: ${materias.length} materia(s), ${enviadas} aviso(s) nuevo(s)`);
}

async function enviarHeartbeat(extra: Record<string, unknown> = {}): Promise<void> {
  if (!CONFIG.appUrl || !CONFIG.secret) return;
  try {
    await axios.post(
      `${CONFIG.appUrl}/api/asistencia/worker/heartbeat`,
      { id: CONFIG.workerId, estado: "activo", ...metricas.snapshot(), ...extra },
      {
        timeout: 10000,
        headers: { "Content-Type": "application/json", "x-worker-secret": CONFIG.secret },
      }
    );
  } catch (e) {
    console.warn(`[${ts()}] heartbeat error: ${String((e as Error).message).slice(0, 100)}`);
  }
}

async function poll(): Promise<void> {
  try {
    await loginIfNeeded();
    const t0 = Date.now();
    const res = await client.get("/apply-leave.php");
    metricas.registrarRt(Date.now() - t0);
    metricas.registrarPoll();

    const { isOpen, activeOptions } = parseActiveAttendance(res.data);
    if (isOpen) {
      await avisarWebhook(activeOptions);
    } else {
      console.log(`[${ts()}] sin asistencia habilitada`);
    }
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    const msg = status ? `HTTP ${status}` : (error as Error).message || "error desconocido";
    metricas.registrarError(msg);
    metricas.setLoginOk(false);
    console.error(`[${ts()}] ${msg}`);
  }
}

console.log(
  `[${ts()}] daemon '${CONFIG.workerId}' -> ${CONFIG.appUrl}  poll cada ${Math.round(CONFIG.pollMs / 1000)}s`
);

void poll();
const pollTimer = setInterval(() => void poll(), CONFIG.pollMs);
const hbTimer = setInterval(() => void enviarHeartbeat(), 10000);
void enviarHeartbeat();

async function cerrar(signal: string): Promise<void> {
  clearInterval(pollTimer);
  clearInterval(hbTimer);
  console.log(`[${ts()}] cerrando (${signal})`);
  await enviarHeartbeat({ estado: "apagado", motivo: "cierre manual" });
  process.exit(0);
}
process.on("SIGINT", () => void cerrar("SIGINT"));
process.on("SIGTERM", () => void cerrar("SIGTERM"));
