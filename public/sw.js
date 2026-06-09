self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Campus UTN", body: event.data?.text() };
  }

  const title = payload.title || "¡La asistencia está abierta!";
  const options = {
    body: payload.body || "Entrá al Campus UTN para marcar tu asistencia.",
    icon: payload.icon || "/UTN.png",
    badge: payload.badge || "/UTN.png",
    tag: payload.tag || "asistencia-abierta",
    renotify: true,
    data: {
      url: payload.url || "/asistencia",
    },
    actions: [
      {
        action: "open",
        title: "Abrir asistencia",
      },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/asistencia";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const target = new URL(url, self.location.origin).href;
      const existing = clients.find((client) => client.url === target);

      if (existing) {
        return existing.focus();
      }

      return self.clients.openWindow(target);
    })
  );
});
