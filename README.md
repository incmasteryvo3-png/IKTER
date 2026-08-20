# Mastery Dashboard — Meta Ads en tiempo real + análisis con Gemini y Claude

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

El dashboard consulta a Meta **en vivo** (`/api/insights`) para el rango de fechas exacto que elijas — no depende de datos guardados de antemano. Por separado, un cron en GitHub Actions sincroniza cada 30 minutos hacia Supabase (`/api/sync-meta`), guardando historial para más adelante.

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
5. En GitHub → Settings → Secrets → Actions, confirma que `CRON_SECRET` y `SITE_URL` sigan configurados (ahora sincronizan Meta **y** GA4 cada 30 min, cada uno con su propio workflow).

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
app/page.tsx                    → el dashboard: Meta (campañas -> conjuntos de anuncios -> creativos) primero, GA4 (sitio web) al final, cada seccion con sus tarjetas de IA
app/globals.css                  → estilos (tema Mastery, incluye el modo nocturno)

../ga4-meta-bridge/            → (fuera de este repo) replica eventos de conversion de Meta hacia GA4
```
