# Proxy casero para el captcha remoto

reCAPTCHA mete a la sesión en un **bucle infinito de desafíos 4×4** cuando la
petición sale desde la IP de datacenter de Vercel (mala reputación). La forma
gratis de sortearlo es hacer que el Chromium headless salga por una **IP
residencial**: la de una PC en una casa.

Este directorio arma exactamente eso:

```
Vercel (headless)  ──►  bore.pub:PUERTO  ──►  esta PC (bore)  ──►  proxy.mjs (127.0.0.1:8787)  ──►  internet
                                                                                                   ▲
                                                        Google ve ESTA IP residencial ────────────┘
```

- `proxy.mjs` — proxy HTTP con auth básica, solo builtins de Node. Escucha en
  `127.0.0.1` (nadie de la LAN ni de internet lo toca directo).
- `bore` — túnel TCP (binario único, se baja solo de GitHub). Le da un puerto
  público en `bore.pub` que reenvía al proxy local. El tráfico a Google **sale
  por esta PC**, `bore.pub` es solo el camino de entrada.
- `start.ps1` — genera credenciales, baja `bore`, levanta las dos cosas e
  imprime el valor listo para `CAPTCHA_PROXIES`.

## Requisitos

- Node en el PATH (ya lo tenés, es el mismo del proyecto).
- Windows con PowerShell (`start.ps1`). Para la otra PC ver "Mover a otra PC".

## Uso

1. En esta carpeta, en PowerShell:

   ```powershell
   .\start.ps1
   ```

   Si PowerShell bloquea el script:
   `powershell -ExecutionPolicy Bypass -File .\start.ps1`

2. Copiá la línea que imprime:

   ```
   CAPTCHA_PROXIES = http://captcha:XXXXXXXX@bore.pub:NNNNN
   ```

3. En **Vercel → el proyecto → Settings → Environment Variables**:
   - Name: `CAPTCHA_PROXIES`
   - Value: lo que copiaste
   - Environment: Production (y Preview si vas a probar en preview)
   - Save.

4. **Redeploy** (Deployments → ⋯ → Redeploy, sin cache).

5. Probá el captcha. En el panel **Diagnóstico** del widget tenés que ver:

   ```
   proxy:probando-lista {"candidatos":1}
   proxy:ok {"server":"http://bore.pub:NNNNN", ...}
   ```

   Y después lo que importa: ¿el botón pasa a decir **VERIFICAR** (en vez de
   siempre "SIGUIENTE")? ¿aparece `procesar:RESUELTO`? Eso confirma que la IP
   residencial destraba el captcha.

6. **Dejá la ventana de `start.ps1` abierta.** Si la cerrás, se cae el túnel y
   el captcha vuelve a fallar (con `proxy:TODOS-FALLARON`).

## Cosas a saber

- **El puerto de `bore.pub` cambia en cada arranque.** Si reiniciás `start.ps1`,
  actualizá `CAPTCHA_PROXIES` en Vercel con el puerto nuevo y redeployá.
- `credentials.txt` y `bin/` están gitignoreados (credenciales y binario local).
- `bore.pub` es un servidor público compartido (del autor de bore). Para algo
  más serio: self-hostear `bore server` en un VPS baratito y usar
  `--to TU_HOST`, o hacer port-forwarding en el router (ver abajo).
- Seguridad: el proxy pide usuario/clave (las de `credentials.txt`), así que
  aunque alguien adivine el `bore.pub:PUERTO` no lo puede usar de proxy abierto.

## Alternativa sin túnel: port-forwarding

Si tu conexión tiene **IP pública** (no CGNAT) y podés tocar el router:

1. Reenviá un puerto (ej. `8787` TCP) del router a esta PC.
2. Editá `proxy.mjs`: `server.listen(PORT, "0.0.0.0", ...)` (en vez de
   `127.0.0.1`) para que acepte desde afuera.
3. `CAPTCHA_PROXIES = http://captcha:CLAVE@TU_IP_PUBLICA:8787`

Más robusto (no dependés de `bore.pub`), pero la IP residencial suele ser
dinámica: si cambia, hay que actualizar la env var. Un DDNS lo resuelve.

## Mover a otra PC (la que vas a dejar prendida)

- **Windows:** copiar este directorio, tener Node, correr `start.ps1`. Para que
  arranque sola al prender: Task Scheduler → nueva tarea "Al iniciar sesión" →
  `powershell -ExecutionPolicy Bypass -File C:\ruta\start.ps1`.
- **Linux:** correr el proxy con `PROXY_PORT=8787 PROXY_USER=captcha
  PROXY_PASS=... node proxy.mjs` y el túnel con `bore local 8787 --to bore.pub`
  (bajar el binario de linux de github.com/ekzhang/bore/releases). Un par de
  unidades `systemd` y queda permanente.
- En los dos casos: actualizar `CAPTCHA_PROXIES` en Vercel con el
  `bore.pub:PUERTO` que imprima esa PC.

## Volver a salida directa

Borrar `CAPTCHA_PROXIES` en Vercel (o ponerla en `off`) y redeploy. El captcha
sale directo por Vercel de nuevo (funciona pero puede entrar en el bucle 4×4).
