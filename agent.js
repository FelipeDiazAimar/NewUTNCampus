#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const axios = require("axios").default;
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");

const CONFIG = {
  baseUrl: process.env.ASISTENCIA_BASE_URL || "https://asistencia.frsfco.utn.edu.ar:4443",
  appUrl: process.env.CAMPUS_APP_URL || "https://campus-utn.vercel.app",
  secret: process.env.NOTIFICATIONS_WEBHOOK_SECRET || "",
  staticCookie: process.env.ASISTENCIA_COOKIE || "",
  username: process.env.ASISTENCIA_USER || "",
  password: process.env.ASISTENCIA_PASSWORD || "",
  usernameField: process.env.ASISTENCIA_USER_FIELD || "username",
  passwordField: process.env.ASISTENCIA_PASSWORD_FIELD || "password",
  loginPath: process.env.ASISTENCIA_LOGIN_PATH || "/index.php",
  pollMs: Number(process.env.ASISTENCIA_POLL_MS || 120000),
};

const jar = new CookieJar();
const client = axios.create({
  baseURL: CONFIG.baseUrl,
  timeout: 20000,
  maxRedirects: 5,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 13; Motorola) AppleWebKit/537.36 CampusUTN-Agent/1.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

let stoppedUntil = null;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function withCookies(config) {
  const url = new URL(config.url || "", config.baseURL || CONFIG.baseUrl).toString();
  const cookie = await jar.getCookieString(url);
  config.headers = { ...config.headers };

  if (cookie) {
    config.headers.Cookie = cookie;
  }

  if (CONFIG.staticCookie) {
    config.headers.Cookie = [config.headers.Cookie, CONFIG.staticCookie].filter(Boolean).join("; ");
  }

  return config;
}

async function saveCookies(response) {
  const setCookie = response.headers["set-cookie"] || [];
  const url = response.config.url
    ? new URL(response.config.url, response.config.baseURL || CONFIG.baseUrl).toString()
    : CONFIG.baseUrl;

  await Promise.all(setCookie.map((cookie) => jar.setCookie(cookie, url)));
  return response;
}

client.interceptors.request.use(withCookies);
client.interceptors.response.use(saveCookies);

function formParamsFromHtml(html, extra) {
  const $ = cheerio.load(html);
  const params = new URLSearchParams();

  $("form input").each((_, input) => {
    const name = $(input).attr("name");
    if (!name) return;
    params.set(name, $(input).attr("value") || "");
  });

  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }

  return params;
}

async function loginIfNeeded() {
  if (CONFIG.staticCookie || !CONFIG.username || !CONFIG.password) return;

  const loginPage = await client.get(CONFIG.loginPath);
  const params = formParamsFromHtml(loginPage.data, {
    [CONFIG.usernameField]: CONFIG.username,
    [CONFIG.passwordField]: CONFIG.password,
  });

  await client.post(CONFIG.loginPath, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

function parseActiveAttendance(html) {
  const $ = cheerio.load(html);
  const submit = $('button[type="submit"][name="signin"], #signin');
  const form = $('form[name="signin"], form:has(select[name="id_materia"])');
  const activeOptions = [];

  $('select[name="id_materia"] option').each((_, option) => {
    const el = $(option);
    const id = el.attr("value") || "";
    const name = el.text().replace(/\s+/g, " ").trim();
    const habilitada = (el.attr("data-habilitada") || "").toUpperCase();
    const disabled = el.is("[disabled]");

    if (id && name && !disabled && habilitada === "S") {
      activeOptions.push({ id, name });
    }
  });

  return {
    isOpen: form.length > 0 && submit.length > 0 && activeOptions.length > 0,
    activeOptions,
    hasForm: form.length > 0,
  };
}

async function heartbeat(status, payload = {}) {
  if (!CONFIG.secret) return;

  await axios.post(
    `${CONFIG.appUrl}/api/asistencia/agent`,
    { status, ...payload },
    {
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": CONFIG.secret,
      },
    }
  );
}

async function notifyVercel(result) {
  if (!CONFIG.secret) {
    throw new Error("Falta NOTIFICATIONS_WEBHOOK_SECRET para avisar a Vercel");
  }

  await axios.post(
    `${CONFIG.appUrl}/api/webhooks/asistencia`,
    {
      source: "termux-motorola",
      materia: result.activeOptions[0]?.name,
      activeOptions: result.activeOptions,
    },
    {
      timeout: 20000,
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": CONFIG.secret,
      },
    }
  );
}

async function poll() {
  if (stoppedUntil === todayKey()) {
    return;
  }

  try {
    await loginIfNeeded();
    const response = await client.get("/apply-leave.php");
    const result = parseActiveAttendance(response.data);

    await heartbeat("listening", {
      activeOptions: result.activeOptions,
      hasForm: result.hasForm,
      checkedAt: new Date().toISOString(),
    });

    if (result.isOpen) {
      await notifyVercel(result);
      stoppedUntil = todayKey();
      await heartbeat("detected", {
        stoppedUntil,
        activeOptions: result.activeOptions,
      });
      console.log(`[${new Date().toISOString()}] Asistencia abierta. Notificacion enviada.`);
      return;
    }

    console.log(`[${new Date().toISOString()}] Escuchando. Sin asistencia habilitada.`);
  } catch (error) {
    const message = error.response?.status
      ? `HTTP ${error.response.status}`
      : error.message || "Error desconocido";
    console.error(`[${new Date().toISOString()}] ${message}`);
  }
}

console.log(`Campus UTN agent iniciado. Poll cada ${Math.round(CONFIG.pollMs / 1000)}s.`);
poll();
setInterval(poll, CONFIG.pollMs);
