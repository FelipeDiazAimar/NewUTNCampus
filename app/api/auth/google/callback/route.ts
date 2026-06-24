import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    return NextResponse.json({ error: "Credenciales de Google no configuradas" }, { status: 500 });

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return new NextResponse(html({ error: "Error al conectar con Google." }), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    return new NextResponse(
      html({ error: "No se obtuvo el refresh token. Revocá el acceso en Google y volvé a intentar." }),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  const res = new NextResponse(html({ refreshToken: tokens.refresh_token }), {
    headers: { "Content-Type": "text/html" },
  });
  res.cookies.set("google_refresh_token", tokens.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

function html({ refreshToken, error }: { refreshToken?: string; error?: string }) {
  if (error) {
    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Google Drive</title><style>
body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#1c1c1e;color:#fff;gap:12px}
p{font-size:14px;opacity:.6;margin:0}
</style></head>
<body><p>${error}</p></body></html>`;
  }

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Google Drive</title><style>
body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1c1c1e;color:#fff;gap:16px;padding:32px;box-sizing:border-box}
h2{margin:0;font-size:17px}
p{margin:0;font-size:13px;opacity:.6;text-align:center}
.token-box{background:#2c2c2e;border:1px solid #3a3a3c;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:12px;word-break:break-all;max-width:560px;width:100%;color:#30d158}
button{background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-size:13px;cursor:pointer;font-weight:500}
button:active{opacity:.8}
.ok{color:#30d158;font-size:13px}
</style></head>
<body>
<h2>Conectado a Google Drive</h2>
<p>La cookie ya está guardada y la app va a funcionar.<br>Para hacerlo permanente, copiá este token a tu <code>.env</code>:</p>
<div class="token-box" id="token">${refreshToken}</div>
<button onclick="navigator.clipboard.writeText(document.getElementById('token').textContent).then(()=>{this.textContent='¡Copiado!';this.style.background='#30d158'})">
  Copiar token
</button>
<p>Pegalo en tu <code>.env.local</code> así:<br><code>GOOGLE_REFRESH_TOKEN=${refreshToken}</code></p>
</body></html>`;
}
