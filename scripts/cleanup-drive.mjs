import { google } from "googleapis";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dir, "../.env.local"), "utf-8");
const b64 = env.match(/GOOGLE_SERVICE_ACCOUNT_JSON=(.+)/)?.[1]?.trim();
if (!b64) { console.error("No se encontró GOOGLE_SERVICE_ACCOUNT_JSON en .env.local"); process.exit(1); }

const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive"] });
const drive = google.drive({ version: "v3", auth });

const list = await drive.files.list({ fields: "files(id,name,mimeType)", pageSize: 100 });
const files = list.data.files ?? [];
console.log(`Archivos encontrados: ${files.length}`);
files.forEach(f => console.log(` - ${f.id}  ${f.name}  (${f.mimeType})`));

if (files.length === 0) { console.log("Drive limpio."); process.exit(0); }

for (const f of files) {
  await drive.files.delete({ fileId: f.id });
  console.log(`Eliminado: ${f.id} "${f.name}"`);
}
console.log("Limpieza completa.");
