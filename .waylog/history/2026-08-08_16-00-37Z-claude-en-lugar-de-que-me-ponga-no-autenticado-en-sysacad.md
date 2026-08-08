# En lugar de que me ponga No autenticado en Sysacad
_Exported on 08/08/2026 at 13:31:16 GMT-3 from Claude via WayLog_


**User**

En lugar de que me ponga No autenticado en Sysacad. yo deberia de automaticamente no ver eso y que se muestre como en el historial de asistencia: Iniciá sesión en Sysacad

Para ver tu historial de inasistencias necesitás vincular tu cuenta.

Ir a Sysacad algo de ese estilo pero mas compacto.

---


**Claude**

Now let's find where "No autenticado" appears — likely in the same asistencia page or a horarios/notas page.

---


**Claude**

Now update the render branch to show a compact link block when `needsAuth`:

---


**Claude**

Ahora agregué un manejo compacto para el caso de "no vinculado" en la tarjeta "Marcar asistencia": en lugar del mensaje crudo `"No autenticado en Sysacad."`, muestra un botón/link con ícono "Iniciá sesión en Sysacad para marcar asistencia" que lleva a `/sysacad?next=/asistencia`, consistente con el patrón compacto que ya usa el bloque de historial de inasistencias más abajo en la misma página.

---


**Claude**

Cambio aplicado en [app/asistencia/page.tsx](app/asistencia/page.tsx). No corrí el dev server para verificar visualmente — si querés lo levanto y lo chequeo en el navegador.

---
