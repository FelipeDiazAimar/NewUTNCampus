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

  const options = {
    body,
    icon:      payload.icon   || "/LOGOUTNB.png",
    badge:     payload.badge  || "/LOGOUTNB.png",
    tag:       payload.tag    || "campus-notif",
    renotify:  true,
    data: { url: payload.url || (isChat ? "/chat" : "/asistencia") },
    // Solo las notificaciones de asistencia muestran botón de acción.
    ...(!isChat && {
      actions: [{ action: "open", title: "Abrir asistencia" }],
    }),
  };

  event.waitUntil(self.registration.showNotification(title, options));
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
