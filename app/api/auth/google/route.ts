import { NextRequest, NextResponse } from "next/server";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId)
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID no configurado" }, { status: 500 });

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
}
