# Mastery Dashboard — Meta Ads en tiempo real + análisis con Gemini y Claude

## Novedad v0.6 — seguridad, historial liviano, análisis guardados, correo semanal y GA4 por cuenta

### Qué cambió
1. **Rutas `/api` protegidas.** Sin sesión iniciada responden 401. Siguen funcionando sin sesión solo: las llamadas con `Authorization: Bearer <CRON_SECRET>` (cron de Vercel, workflows de GitHub, backfill de GHL y diagnósticos con Postman) y el webhook de GHL (`/api/webhooks/*`, que valida su propia clave). Se borró `/api/debug/env` (mostraba parte de la clave de Claude). `/api/debug/adset` se dejó, ahora con sesión.
2. **Next.js 14.2.5 → 14.2.35** (corrige la vulnerabilidad que avisaba npm).
3. **Una sola foto por día** en `insight_snapshots` y en las tablas de GA4: cada sincronización reemplaza la foto de hoy (hora de Colombia) y borra lo que tenga más de 90 días (`SNAPSHOT_RETENTION_DAYS` para cambiarlo). Nota: los workflows de GitHub están en modo manual, así que la sincronización la disparan "Actualizar ahora" y el workflow a mano.
4. **Análisis de IA guardados** (tabla `ai_summaries`). Cada análisis queda guardado por sección (cuenta + qué gráfica/tabla). Si vuelves a la misma vista con los mismos datos, se muestra el guardado sin volver a pagarle a la IA ("mismos datos, no se volvió a cobrar"), y debajo de cada tarjeta aparece **"Análisis anteriores de esta sección"** para comparar.
5. **Resumen semanal por correo** a todos los usuarios registrados en Supabase, **los lunes a las 8:00 a. m. (Colombia)**: por cada cuenta, totales de la semana pasada contra la anterior, anuncios que conviene escalar, que subieron su costo por resultado o dejaron de convertir, con señales de fatiga, y que gastan sin resultados, más un párrafo de Gemini en tono de profesor.
6. **GA4 por cuenta.** Cada cuenta publicitaria puede tener su propia propiedad de GA4; la sección GA4 del Dashboard cambia con el selector de cuenta.

### Pasos para desplegar v0.6 (en este orden)

**A. Supabase → SQL Editor → New query** → pega y corre **`sql/migracion_v06.sql`** (una sola vez; se puede repetir sin problema). Agrega las columnas para guardar los análisis y limpia el historial repetido que ya existe.

**B. Resend (para el correo semanal)**
1. Crea una cuenta gratis en [resend.com](https://resend.com) (3.000 correos/mes).
2. **Domains → Add Domain** → tu dominio (ej. `incmastery.com`) → agrega en tu proveedor de DNS los registros que te muestra (TXT/MX/DKIM) → espera a que diga **Verified**. Sin dominio verificado, Resend solo deja enviar a tu propio correo de registro.
3. **API Keys → Create API Key** (permiso "Sending access") → cópiala.

**C. Vercel → Settings → Environment Variables** (Production) → agrega:

| Variable | Valor | ¿Obligatoria? |
|---|---|---|
| `RESEND_API_KEY` | la clave de Resend (`re_...`) | Sí, para el correo |
| `EMAIL_FROM` | `IKTER <reportes@incmastery.com>` (un correo de tu dominio verificado) | Sí, para el correo |
| `SITE_URL` | `https://tu-ikter.vercel.app` (para el botón "Abrir IKTER" del correo) | Recomendada |
| `GA4_PROPERTY_IDS` | `act_1167371012372393:NUMERO_PROPIEDAD_AESTHETICS` (solo si Aesthetics tiene otro sitio) | Opcional |
| `WEEKLY_REPORT_EXCLUDE` | correos que NO deben recibir el resumen, separados por coma | Opcional |
| `WEEKLY_REPORT_TO` | si la defines, el resumen va SOLO a estos correos (en vez de a todos los usuarios) | Opcional |
| `WEEKLY_REPORT_AI` | `off` para mandar el correo sin el párrafo de Gemini | Opcional |
| `SNAPSHOT_RETENTION_DAYS` | días de historial a conservar (por defecto 90) | Opcional |

`CRON_SECRET` **debe existir** en Vercel (ya la tienes): Vercel la usa para firmar la llamada del lunes.

**D. Push a GitHub** → Vercel despliega solo. El horario del correo está en `vercel.json` (`0 13 * * 1` = lunes 13:00 UTC = 8:00 a. m. Colombia); después del deploy lo ves en **Vercel → Settings → Cron Jobs** (funciona en el plan gratis; Vercel puede dispararlo dentro de esa hora, no al minuto exacto).

**E. Probar el correo sin esperar al lunes** (con sesión iniciada en IKTER, en el mismo navegador):
- `https://tu-ikter.vercel.app/api/weekly-report` → vista previa del correo en el navegador (no envía nada).
- `https://tu-ikter.vercel.app/api/weekly-report?enviar=yo` → te lo envía **solo a ti**. Un usuario con sesión nunca puede disparar el envío a todos; eso solo lo hace el cron.

**GA4 de Aesthetics** (solo si tiene su propio sitio): en GA4 → Admin → Acceso a la propiedad, agrega como **Lector** el mismo correo de la cuenta de servicio (`GA4_SERVICE_ACCOUNT_EMAIL`), copia el **ID de la propiedad** (número) y ponlo en `GA4_PROPERTY_IDS`. Las cuentas que no estén en esa lista siguen usando `GA4_PROPERTY_ID`.

**Si algo llama a la API desde fuera** (Postman, scripts): ahora necesita `Authorization: Bearer <CRON_SECRET>`; los endpoints de backfill y diagnósticos ya lo pedían.

## Novedad v0.5 — selector de cuenta publicitaria (Mastery TikTok / Mastery Aesthetics)

Arriba, debajo de los botones del header, aparece **"Cuenta publicitaria"** (solo si hay 2 o más cuentas configuradas). Al cambiar de cuenta se recargan las campañas con el mismo rango de fechas, se limpian las campañas elegidas (eran de la otra cuenta) y la pestaña Diagnóstico sigue a la cuenta y a las campañas elegidas. El navegador recuerda la última cuenta usada. Las IAs reciben el nombre de la cuenta como contexto.

### Qué hacer para activarlo

**1. Meta (Business Manager)** — el MISMO usuario del sistema cuyo token está en `META_SYSTEM_USER_TOKEN` debe tener acceso a las dos cuentas:
Business Settings → Usuarios → Usuarios del sistema → (tu usuario) → **Asignar activos** → Cuentas publicitarias → marca las dos → permiso al menos de **ver rendimiento**. No hace falta generar un token nuevo: el actual pasa a ver la cuenta recién asignada.

**2. Vercel** — Project → **Settings → Environment Variables** → **Add New**:
```
Key:   META_AD_ACCOUNTS
Value: act_111111111:Mastery TikTok,act_222222222:Mastery Aesthetics
```
(los números reales los ves en Ads Manager, arriba a la izquierda en el selector de cuentas, o en la URL: `act=111111111`). Marca los entornos Production (y Preview si lo usas) → Save. Luego **Deployments → … → Redeploy** (o simplemente haz el push de esta versión, que ya dispara un deploy con la variable).
- La primera cuenta de la lista es la que se abre por defecto.
- `META_AD_ACCOUNT_ID` puedes dejarla: solo se usa si `META_AD_ACCOUNTS` no existe.

**3. Supabase — nada.** La tabla `ad_accounts` ya admite varias cuentas: "Actualizar ahora" (y el workflow manual de GitHub) sincroniza **todas** las cuentas de la lista, cada una en su fila, en paralelo; si una falla, la otra se guarda igual. No hay SQL que correr.

**4. GitHub Actions — nada.** Los mismos secretos `SITE_URL` y `CRON_SECRET`.

**Lo que sigue siendo una sola configuración para ambas cuentas:** GA4 (una propiedad, `GA4_PROPERTY_ID`) y GHL (una location). Las citas de GHL igual se ven bien en las dos cuentas porque se cruzan por el ID del anuncio. Si Aesthetics usa otro sitio/propiedad de GA4, avísame y se separa por cuenta.

## Novedad v0.3 — pestaña "Diagnóstico" (gráficas diarias + IA por gráfica)

Arriba, debajo de los botones del header, ahora hay dos pestañas: **Dashboard** (todo lo que ya existía, sin ningún cambio) y **Diagnóstico** (nuevo).

**Qué muestra Diagnóstico** — el mismo visual del "Panel de diagnóstico de anuncios", pero en vivo desde Meta, y **con los mismos parámetros del Dashboard**: solo los **anuncios de las 1 a 3 campañas que elegiste en el Dashboard**, en el **mismo rango de fechas**. Las campañas se eligen solo en el Dashboard; Diagnóstico se actualiza solo cuando cambias esa selección (y las fechas son las mismas en ambas pestañas; si las cambias, presiona "Consultar").

- Una tarjeta por anuncio, agrupadas por campaña seleccionada, con sus 9 métricas **día por día**, indexadas 0-100 en el mismo eje para leerlas unas contra otras. El tooltip muestra el valor real. Costo por resultado brilla más (mirar primero), luego CTR (eficiencia), luego contexto.
- Cada gráfica se recorta a la ventana real en que esa entidad tuvo entrega; los días sin ninguna fila de Meta dentro de esa ventana se marcan con una franja (posible pausa).
- Retención de video (tabla + curva 25/50/75/100%), línea de tiempo de cuándo estuvo activo cada uno y frecuencia alineada en el calendario.
- **Debajo de cada gráfica**, un par VISION (Gemini) + ATALAYA (Claude) con botón "Analizar gráfica". Usan un prompt propio para leer relaciones entre métricas (ej. CPM sube + CTR baja = fatiga), no el prompt general del Dashboard. Igual que antes, no se disparan solos.
- **Modo profesor**: arriba hay un glosario con qué indica cada métrica y cómo leerla, y una guía de combinaciones típicas (ej. CPM sube + CTR baja = fatiga del creativo). VISION y ATALAYA reciben ese mismo glosario, explican en lenguaje simple qué mide cada métrica y por qué una combinación indica lo que dicen, y cierran con "Lo que te enseña esta gráfica". Los textos están en `METRICS` y `COMBOS` al inicio de `components/DiagnosticoPanel.tsx`.
- Si un mismo nombre de anuncio se repite en varios conjuntos (el caso "daniela"), sale un aviso y cada tarjeta muestra su conjunto — con la API cada anuncio ya viene separado por su ID real, así que no se mezclan.

**Para desplegar: solo `git push`.**
- **No hay que correr ningún SQL.** Diagnóstico consulta a Meta en vivo (igual que el Dashboard) y no guarda nada en Supabase; las tablas actuales no cambian.
- **No hay variables de entorno nuevas.** Usa las mismas `META_SYSTEM_USER_TOKEN`, `META_AD_ACCOUNT_ID`, `GEMINI_API_KEY` y `ANTHROPIC_API_KEY`.
- Hay **una dependencia nueva** (`chart.js`) en `package.json`; Vercel la instala sola al desplegar. En local: `npm install`.

**Límites a saber:**
- Rango máximo de 93 días por consulta en Diagnóstico (es serie diaria; más días = más filas y Vercel corta a los 60 s).
- La retención de video es el agregado del período (Meta no la reporta de forma confiable día por día).
- Cada "Analizar gráfica" es una llamada a la API (con búsqueda web, como el resto). Con muchos anuncios, analiza solo los que te interesen.

**Archivos nuevos / tocados en esta versión:**
```
components/DiagnosticoPanel.tsx   → NUEVO: toda la pestaña Diagnóstico (gráficas + tarjetas de IA)
lib/metaDaily.ts                  → NUEVO: consulta diaria a Meta (time_increment=1) + retención de video
app/api/insights/daily/route.ts   → NUEVO: GET /api/insights/daily?since=&until=&level=ad&campaign_ids=ID1,ID2 (filtra en Meta por las campañas elegidas)
app/page.tsx                      → solo se agregaron las 2 pestañas y el envoltorio para mostrar/ocultar; el Dashboard no cambió
app/globals.css                   → solo se AGREGARON estilos al final (prefijo .dg- y .view-tabs)
lib/meta.ts                       → solo se agregó "export" a extractResults (para leer resultados igual que el Dashboard)
package.json                      → + chart.js
```

## Login (nuevo)

El dashboard ahora exige iniciar sesión — nadie puede entrar sin cuenta. No hay pantalla de registro a propósito (es un equipo controlado, no un producto público). Para crear el primer usuario:

1. Ve a tu proyecto de Supabase → **Authentication → Users → "Add user"**.
2. Completa correo y contraseña.
3. **Importante**: marca la opción **"Auto Confirm User"** al crearlo (o confírmalo después manualmente) — si no, Supabase le exige confirmar el correo antes de poder entrar, y como no hay flujo de confirmación configurado en este proyecto, quedaría bloqueado.
4. Repite por cada persona de tu equipo que necesite acceso.

Para revocar el acceso de alguien, simplemente elimina o desactiva su usuario en esa misma pantalla — no requiere tocar código.

## Novedades de esta versión

- **VISION y ATALAYA**: Gemini y Claude ahora se muestran con estos nombres en la interfaz (es solo el nombre visible — por debajo siguen siendo las mismas dos IAs, mismos endpoints `/api/analyze/gemini` y `/api/analyze/claude`).
- **Modo nocturno**: botón 🌙/☀️ arriba a la derecha del header. Usa la paleta real de marca (Royal Orchid, Amber Glow, Tomato) y las tarjetas quedan semi-transparentes con desenfoque (`backdrop-filter`), para diferenciarse del fondo en vez de verse solo "oscuras".
- **Logo al doble de tamaño** en el header (88px, antes 44px), con ajuste de contraste automático en modo nocturno.
- **Orden de secciones**: ahora se ve primero el embudo de Meta (campañas → conjuntos de anuncios → creativos) y GA4 queda al final de la página, no al principio.
- **Citas de GHL bajo cada anuncio**: columna nueva "Citas (GHL)" en la tabla de creativos — ver la sección "GHL" más abajo para la configuración.
- **Barras verticales en Creativos**: cada celda de métrica (alcance, reproducciones, tiempos, eventos) vuelve a mostrar su barra proporcional, comparando contra el máximo de esa columna.
- **Selector de campañas corregido**: elegir "1" ya muestra un solo selector (el bug era una condición de carrera entre la carga inicial y el clic del usuario; ahora es un efecto independiente sin ambigüedad).
- **Dos IAs**: cada sección relevante tiene un par de tarjetas — VISION y ATALAYA — cada una con su propio botón "Generar análisis" (no se disparan solas, para no gastar cuota sin que lo pidas).
- **Conjuntos de anuncios por campaña**: debajo de cada campaña seleccionada, se listan sus conjuntos de anuncios activos en el rango de fechas elegido, comparados en el mismo formato de embudo (mismo responsive: lado a lado en escritorio, apilado en celular).
- **Evento de conversión por conjunto**: cada conjunto muestra qué evento de conversión predominó en sus datos.
- **Tabla de creativos con 8 eventos**: se quitó la columna "Resultados" y se agregaron 8 columnas de eventos específicos.
- **Análisis con investigación web**: VISION usa Google Search grounding y ATALAYA usa su herramienta de búsqueda web, para que el análisis considere tendencias y comportamiento actual del algoritmo de Meta, no solo los números crudos.

## ⚠️ Cosas que asumí y que debes verificar

Esto es lo más importante de leer antes de usarlo en serio:

1. **Nombres de los 8 eventos de conversión** (`app/page.tsx`, constante `EVENTS`): usé los nombres estándar que Meta suele usar en el arreglo `actions` (`lead`, `view_content`, `schedule`, etc.). El que con más seguridad **no va a calzar** es "Herramienta completada" — ese es un evento personalizado de Mastery y no tengo forma de adivinar su nombre exacto en Meta. Si ves esa columna en ceros, dime el nombre exacto del evento (lo ves en Meta Events Manager, o te ayudo a encontrarlo en el `raw` que ya guardamos) y cambio una línea en el código.
2. **"Conjunto activo en el rango"**: un conjunto de anuncios aparece en el dashboard si Meta devuelve datos de entrega para él en esas fechas. Es un buen proxy práctico, pero no es lo mismo que revisar la fecha de inicio/fin configurada del conjunto — si un conjunto tuvo *cero* entrega en el rango pero técnicamente seguía "activo" en Meta, no va a aparecer.
3. **"Evento de conversión" mostrado por conjunto**: lo calculé como el evento con más conteo dentro de ese conjunto (`getDominantEvent`), no el objetivo de optimización real configurado en Meta (eso requeriría otra llamada a la API, a nivel de estructura de la cuenta, no de insights). Es una aproximación razonable pero no 100% exacta.
4. **Investigación web en los análisis**: activé la búsqueda web para Gemini y Claude porque la pediste explícitamente. Esto tiene **costo adicional por búsqueda** en ambas APIs (aparte del costo normal por análisis) — si notas que se dispara el gasto, dímelo y lo desactivamos o lo dejamos solo para el análisis de creativos (el más importante de investigar).

## Cómo funciona, de punta a punta

El dashboard consulta a Meta **en vivo** (`/api/insights`) para el rango de fechas exacto que elijas — no depende de datos guardados de antemano. Por separado, "Actualizar ahora" (o el workflow manual de GitHub Actions) sincroniza hacia Supabase (`/api/sync-meta`), guardando una foto por día como historial.

Cada tarjeta de IA (VISION o ATALAYA — Gemini y Claude por debajo) analiza **exactamente los datos que esa sección está mostrando** — la comparación de campañas, un conjunto de anuncios específico, o la tabla de creativos — porque se le manda ese JSON directo desde el navegador, no se recalcula en el servidor.

## Configuración

### Variables de entorno (agrega estas a las que ya tenías en Vercel)

```
ANTHROPIC_API_KEY=sk-ant-...

# GA4 — desempeño del sitio web
GA4_PROPERTY_ID=123456789
GA4_SERVICE_ACCOUNT_EMAIL=nombre@proyecto.iam.gserviceaccount.com
GA4_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

El resto de variables (Supabase, Meta, Gemini, `CRON_SECRET`) son las mismas de antes — revisa `.env.example` para la lista completa.

### Pasos generales

1. Supabase: corre `sql/schema.sql` y luego `sql/schema_ga4.sql` en el SQL editor (ambos son seguros de re-ejecutar, usan `drop policy if exists`).
2. Llena `.env.local` con las variables de `.env.example` + las 3 de GA4 de arriba.
3. `npm install && npm run dev` para probar local.
4. Sube a GitHub, conecta con Vercel, agrega las variables de entorno, despliega.
5. En GitHub → Settings → Secrets → Actions, confirma que `CRON_SECRET` y `SITE_URL` sigan configurados (los workflows de Meta y GA4 están en modo manual; se disparan desde GitHub → Actions).

### Configurar el acceso a GA4

Ya tienes una cuenta de servicio con acceso a Google Cloud, así que solo falta darle acceso a **esta** propiedad de GA4 específicamente:

1. En [Google Cloud Console](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com), confirma que la **Google Analytics Data API** esté habilitada en el proyecto de esa cuenta de servicio.
2. En GA4 → Admin → **Administración de acceso a la propiedad**, agrega el email de la cuenta de servicio (termina en `.iam.gserviceaccount.com`) como **Viewer** (Lector).
3. Copia el **Property ID** (Admin → Configuración de la propiedad — es un número, no el Measurement ID que empieza con "G-").
4. Genera (o reusa) una clave JSON de esa cuenta de servicio y saca de ahí el `client_email` y el `private_key` para las variables de entorno de arriba.

### Meta → GA4 (eventos de conversión)

Esto vive **fuera** de este repositorio, en `ga4-meta-bridge/` (carpeta hermana a `IKTER-main/`) — son los mismos eventos de conversión (leads, compras) que hoy le mandas a Meta, replicados hacia GA4. Revisa el README de esa carpeta para la configuración y las decisiones pendientes antes de instalarlo (sobre todo la parte de `client_id`, que es la que determina si el evento queda bien conectado a la sesión real en GA4).

### GHL — citas agendadas bajo cada anuncio

Las citas llegan por **webhook en tiempo real** (no se le pregunta a la API de GHL en cada refresh) — se cruzan con el anuncio real de Meta usando `utm_content` (ad_id), `utm_term` (adset_id) y `utm_campaign` (campaign_id), que GHL ya captura automáticamente en las landings planas.

**1. Variables de entorno** (agrégalas a las de arriba):
```
GHL_API_TOKEN=...          # Private Integration Token de tu cuenta de GHL
GHL_LOCATION_ID=...        # el ID de tu location (se ve en la URL de GHL: .../location/ESTE_ID/...)
GHL_WEBHOOK_SECRET=...     # invéntate un texto largo y random, es solo para verificar que el webhook viene de GHL
```

**2. Antes de confiar en el backfill histórico**, verifica los nombres reales de los campos de atribución en tu cuenta:
```
GET /api/diagnostics/ghl?contactId=ALGUN_CONTACTO_REAL
Header: Authorization: Bearer <CRON_SECRET>
```
Compara el JSON que devuelve contra lo que `lib/ghl.ts` intenta leer (`attributionSource`, `customFields`) — si algo no calza, se ajusta en ese único archivo.

**3. Configura el Workflow en GHL** (trigger "Appointment Booked" → acción "Webhook"):
- URL: `https://tu-dominio.com/api/webhooks/ghl-appointment`
- Header personalizado: `X-Webhook-Secret: <el mismo valor de GHL_WEBHOOK_SECRET>`
- Cuerpo (JSON), usando el selector de variables `{}` del editor de GHL para cada campo — la forma exacta está documentada como comentario al inicio de `app/api/webhooks/ghl-appointment/route.ts`.

**4. Corre el backfill histórico una sola vez** (trae las citas de antes de activar el webhook):
```
POST /api/backfill-ghl?since=2026-01-01&until=2026-08-13
Header: Authorization: Bearer <CRON_SECRET>
```
Es seguro volver a correrlo — no duplica citas ya guardadas.

**5.** Corre `sql/schema_ghl.sql` en Supabase (después de `schema.sql` y `schema_ga4.sql`).

## Estructura del proyecto

```
sql/schema.sql              → tablas + RLS para Supabase (Meta)
sql/schema_ga4.sql            → tablas + RLS para Supabase (GA4) — correr despues de schema.sql
sql/schema_ghl.sql              → tabla + RLS para las citas de GHL — correr despues de schema_ga4.sql
lib/meta.ts                  → llamadas a la Meta Graph API (campaign_id, adset_id, landing_url real por anuncio, actions completo)
lib/ga4.ts                    → llamadas a la GA4 Data API (overview, canales, origenes, landing pages)
lib/ghl.ts                     → cliente de la API de GHL (solo para el backfill historico)
lib/gemini.ts                 → Gemini (mostrado como "VISION") + Google Search grounding
lib/anthropic.ts              → Claude (mostrado como "ATALAYA") + herramienta de busqueda web
lib/supabase.ts                → clientes de Supabase (browser + admin)
lib/syncMeta.ts                → sincronizacion historica hacia Supabase (cron, Meta)
lib/syncGa4.ts                  → sincronizacion historica hacia Supabase (cron, GA4)
app/api/insights/              → consulta EN VIVO a Meta (campaign + adset + ad) para cualquier rango de fechas
app/api/insights/ga4/           → consulta EN VIVO a GA4 para el mismo rango de fechas
app/api/citas/                   → lee las citas de GHL ya guardadas en Supabase (no consulta la API de GHL)
app/api/webhooks/ghl-appointment/ → recibe cada cita en tiempo real desde un Workflow de GHL
app/api/backfill-ghl/             → carga historica de citas, se corre a mano una vez
app/api/diagnostics/ghl/          → verifica los nombres de campo reales de tu cuenta de GHL
app/api/analyze/gemini/        → analisis con Gemini ("VISION"), sin estado (recibe el JSON a analizar)
app/api/analyze/claude/        → analisis con Claude ("ATALAYA"), sin estado
app/api/sync-meta/             → cron historico hacia Supabase (Meta)
app/api/sync-ga4/                → cron historico hacia Supabase (GA4)
app/api/refresh/                → boton "Actualizar ahora" (sincroniza Meta y GA4 en paralelo; las citas de GHL se leen de Supabase, no se re-consultan)
app/api/weekly-report/           → resumen semanal por correo (cron lunes 8am, vista previa, prueba a ti)
app/api/analyze/saved/           → análisis de IA guardados (historial por sección)
lib/weeklyReport.ts               → cálculo + HTML + envío (Resend) del resumen semanal
lib/aiStore.ts                   → guardar/leer análisis en ai_summaries
lib/retention.ts                 → una foto por día + limpieza automática del historial
lib/authServer.ts                → usuario con sesión dentro de las rutas /api
sql/migracion_v06.sql            → migración v0.6 (correr una vez)
app/api/accounts/                → lista de cuentas para el selector (de META_AD_ACCOUNTS)
lib/accounts.ts                  → lee META_AD_ACCOUNTS y valida la cuenta pedida
app/api/insights/daily/          → serie DIARIA en vivo desde Meta para la pestaña Diagnóstico
components/DiagnosticoPanel.tsx  → pestaña Diagnóstico (graficas + IA por grafica)
app/page.tsx                    → el dashboard (con las pestañas Dashboard | Diagnóstico): Meta (campañas -> conjuntos de anuncios -> creativos) primero, GA4 (sitio web) al final, cada seccion con sus tarjetas de IA
app/globals.css                  → estilos (tema Mastery, incluye el modo nocturno)

../ga4-meta-bridge/            → (fuera de este repo) replica eventos de conversion de Meta hacia GA4
```
