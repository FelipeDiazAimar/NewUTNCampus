// Proxy HTTP con autenticación básica — solo builtins de Node, cero deps.
//
// El captcha remoto (Chromium headless en Vercel) sale por acá: así Google ve
// la IP RESIDENCIAL de esta PC en vez de la IP de datacenter de Vercel (que
// está marcada y mete el bucle infinito de desafíos 4x4).
//
// Escucha SOLO en 127.0.0.1: se llega desde afuera únicamente por el túnel
// (bore) que abre start.ps1. Maneja peticiones HTTP normales y, sobre todo,
// CONNECT (el tunneling HTTPS que usa el navegador para llegar a Google/turnos).
//
// Uso directo:  PROXY_PORT=8787 PROXY_USER=x PROXY_PASS=y node proxy.mjs
// (start.ps1 hace todo esto solo)

import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PROXY_PORT || process.argv[2] || 8787);
const USER = process.env.PROXY_USER || "";
const PASS = process.env.PROXY_PASS || "";

function autorizado(req) {
  if (!USER && !PASS) return true;
  const h = req.headers["proxy-authorization"] || "";
  const m = h.match(/^Basic (.+)$/i);
  if (!m) return false;
  const [u, p] = Buffer.from(m[1], "base64").toString().split(":");
  return u === USER && p === PASS;
}

const server = http.createServer((req, res) => {
  if (!autorizado(req)) {
    res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="proxy"' });
    return res.end("Proxy auth required");
  }
  let target;
  try {
    target = new URL(req.url);
  } catch {
    res.writeHead(400);
    return res.end("bad request URI");
  }
  const headers = { ...req.headers };
  delete headers["proxy-authorization"];
  const up = http.request(
    {
      host: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: target.pathname + target.search,
      headers,
    },
    (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    }
  );
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("upstream error");
  });
  req.pipe(up);
});

// CONNECT = tunneling HTTPS. Es lo que usa el captcha para llegar a
// www.gstatic.com / www.google.com / turnos.frsfco.utn.edu.ar por 443.
server.on("connect", (req, clientSocket, head) => {
  if (!autorizado(req)) {
    clientSocket.write(
      'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="proxy"\r\n\r\n'
    );
    return clientSocket.end();
  }
  const [host, puerto] = req.url.split(":");
  const upstream = net.connect(Number(puerto) || 443, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => clientSocket.end());
  clientSocket.on("error", () => upstream.destroy());
});

server.on("clientError", (_e, sock) => {
  try {
    sock.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch {
    /* nada */
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[proxy] 127.0.0.1:${PORT}  auth=${USER ? "sí (" + USER + ")" : "NO"}`);
});
