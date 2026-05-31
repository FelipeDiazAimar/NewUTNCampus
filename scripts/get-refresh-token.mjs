/**
 * Corre: node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
 * Abre el navegador, autorizá con felipediazaimar@gmail.com,
 * y el refresh token aparece en la consola.
 */
import { google } from "googleapis";
import { createServer } from "http";

const [, , CLIENT_ID, CLIENT_SECRET] = process.argv;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Uso: node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>");
  process.exit(1);
}

const REDIRECT = "http://localhost:3001";
const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);

const url = oauth2.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/drive"],
  prompt: "consent",
});

console.log("\n── Abrí este URL en el navegador y autorizá con felipediazaimar@gmail.com ──\n");
console.log(url);
console.log("\n── Esperando callback en http://localhost:3001 ──\n");

const server = createServer(async (req, res) => {
  try {
    const code = new URL(req.url, REDIRECT).searchParams.get("code");
    if (!code) { res.end("Sin código de autorización."); return; }

    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>✅ Autorización exitosa. Podés cerrar esta pestaña.</h2>");
    server.close();

    console.log("\n✅ Pegá estas líneas en tu .env.local:\n");
    console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("");
  } catch (err) {
    res.writeHead(500);
    res.end("Error: " + err.message);
    server.close();
    console.error("Error al obtener tokens:", err.message);
  }
});

server.listen(3001);
