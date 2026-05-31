import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
};

async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function POST(req: NextRequest) {
  const update = (await req.json()) as TelegramUpdate;
  const text = update.message?.text ?? "";
  const chatId = update.message?.chat?.id;

  if (!text || !chatId) {
    return NextResponse.json({ ok: true });
  }

  if (!text.startsWith("/start")) {
    await sendTelegramMessage(String(chatId), "Usa /start para vincular tu cuenta.");
    return NextResponse.json({ ok: true });
  }

  const linkCode = text.split(" ")[1];
  if (!linkCode) {
    await sendTelegramMessage(
      String(chatId),
      "Falta el codigo de vinculacion. Vuelve a abrir el enlace desde la app."
    );
    return NextResponse.json({ ok: true });
  }

  const res = await supabaseFetch(
    `perfil_notificaciones?telegram_link_code=eq.${encodeURIComponent(linkCode)}&select=*`
  );
  if (!res.ok) {
    return NextResponse.json({ ok: true });
  }
  const rows = (await res.json()) as Array<{ email: string }>;
  if (!rows[0]) {
    await sendTelegramMessage(
      String(chatId),
      "Codigo invalido. Vuelve a generar el enlace desde la app."
    );
    return NextResponse.json({ ok: true });
  }

  await supabaseFetch(`perfil_notificaciones?telegram_link_code=eq.${encodeURIComponent(linkCode)}`, {
    method: "PATCH",
    body: JSON.stringify({
      telegram_chat_id: String(chatId),
      telegram_link_code: null,
    }),
  });

  await sendTelegramMessage(
    String(chatId),
    "Listo. Tu cuenta fue vinculada con Campus UTN."
  );

  return NextResponse.json({ ok: true });
}
