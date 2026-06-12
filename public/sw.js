self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Campus UTN", body: event.data?.text() };
  }

  const isChat = payload.tag === "chat-message";

  const title = payload.title || (isChat ? "Nuevo mensaje" : "¡La asistencia está abierta!");
  const body  = payload.body  || (isChat ? "Tenés un mensaje nuevo en Campus UTN." : "Entrá al Campus UTN para marcar tu asistencia.");

  // iOS Safari no soporta `actions` ni `badge` — incluirlos hace que
  // showNotification() rechace la promesa y la notificación no aparezca.
  const options = {
    body,
    icon: payload.icon || "/logo.png",
    tag:  payload.tag  || "campus-notif",
    renotify: true,
    data: { url: payload.url || (isChat ? "/chat" : "/asistencia") },
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch((err) => {
      console.error("[SW] showNotification falló:", err);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const target = new URL(url, self.location.origin).href;
        const existing = clients.find((c) => c.url === target);
        if (existing) return existing.focus();
        return self.clients.openWindow(target);
      })
  );
});
