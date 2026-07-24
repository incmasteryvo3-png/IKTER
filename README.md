# Mastery Dashboard — Meta Ads en tiempo real + análisis con Gemini y Claude

## Novedades de esta versión

- **Selector de campañas corregido**: elegir "1" ya muestra un solo selector (el bug era una condición de carrera entre la carga inicial y el clic del usuario; ahora es un efecto independiente sin ambigüedad).
- **Dos IAs**: cada sección relevante tiene un par de tarjetas — Gemini y Claude (Anthropic) — cada una con su propio botón "Generar análisis" (no se disparan solas, para no gastar cuota sin que lo pidas).
- **Conjuntos de anuncios por campaña**: debajo de cada campaña seleccionada, se listan sus conjuntos de anuncios activos en el rango de fechas elegido, comparados en el mismo formato de embudo (mismo responsive: lado a lado en escritorio, apilado en celular).
- **Evento de conversión por conjunto**: cada conjunto muestra qué evento de conversión predominó en sus datos.
- **Tabla de creativos con 8 eventos**: se quitó la columna "Resultados" y se agregaron 8 columnas de eventos específicos, más una columna "Conjunto" para diferenciar el mismo anuncio si aparece en más de un conjunto.
- **Análisis con investigación web**: Gemini usa Google Search grounding y Claude usa su herramienta de búsqueda web, para que el análisis considere tendencias y comportamiento actual del algoritmo de Meta, no solo los números crudos.

## ⚠️ Cosas que asumí y que debes verificar

Esto es lo más importante de leer antes de usarlo en serio:

1. **Nombres de los 8 eventos de conversión** (`app/page.tsx`, constante `EVENTS`): usé los nombres estándar que Meta suele usar en el arreglo `actions` (`lead`, `view_content`, `schedule`, etc.). El que con más seguridad **no va a calzar** es "Herramienta completada" — ese es un evento personalizado de Mastery y no tengo forma de adivinar su nombre exacto en Meta. Si ves esa columna en ceros, dime el nombre exacto del evento (lo ves en Meta Events Manager, o te ayudo a encontrarlo en el `raw` que ya guardamos) y cambio una línea en el código.
2. **"Conjunto activo en el rango"**: un conjunto de anuncios aparece en el dashboard si Meta devuelve datos de entrega para él en esas fechas. Es un buen proxy práctico, pero no es lo mismo que revisar la fecha de inicio/fin configurada del conjunto — si un conjunto tuvo *cero* entrega en el rango pero técnicamente seguía "activo" en Meta, no va a aparecer.
3. **"Evento de conversión" mostrado por conjunto**: lo calculé como el evento con más conteo dentro de ese conjunto (`getDominantEvent`), no el objetivo de optimización real configurado en Meta (eso requeriría otra llamada a la API, a nivel de estructura de la cuenta, no de insights). Es una aproximación razonable pero no 100% exacta.
4. **Investigación web en los análisis**: activé la búsqueda web para Gemini y Claude porque la pediste explícitamente. Esto tiene **costo adicional por búsqueda** en ambas APIs (aparte del costo normal por análisis) — si notas que se dispara el gasto, dímelo y lo desactivamos o lo dejamos solo para el análisis de creativos (el más importante de investigar).

## Cómo funciona, de punta a punta

El dashboard consulta a Meta **en vivo** (`/api/insights`) para el rango de fechas exacto que elijas — no depende de datos guardados de antemano. Por separado, un cron en GitHub Actions sincroniza cada 30 minutos hacia Supabase (`/api/sync-meta`), guardando historial para más adelante.

Cada tarjeta de IA (Gemini o Claude) analiza **exactamente los datos que esa sección está mostrando** — la comparación de campañas, un conjunto de anuncios específico, o la tabla de creativos — porque se le manda ese JSON directo desde el navegador, no se recalcula en el servidor.

## Configuración

### Variables de entorno (agrega esta a las que ya tenías en Vercel)

```
ANTHROPIC_API_KEY=sk-ant-...
```

El resto de variables (Supabase, Meta, Gemini, `CRON_SECRET`) son las mismas de antes — revisa `.env.example` para la lista completa.

### Pasos generales

1. Supabase: corre `sql/schema.sql` en el SQL editor (ya es seguro re-ejecutarlo, usa `drop policy if exists`).
2. Llena `.env.local` con las 9 variables de `.env.example`.
3. `npm install && npm run dev` para probar local.
4. Sube a GitHub, conecta con Vercel, agrega las variables de entorno, despliega.
5. En GitHub → Settings → Secrets → Actions, confirma que `CRON_SECRET` y `SITE_URL` sigan configurados (para el sync cada 30 min).

## Estructura del proyecto

```
sql/schema.sql              → tablas + RLS para Supabase
lib/meta.ts                  → llamadas a la Meta Graph API (ahora conserva campaign_id, adset_id y el arreglo actions completo)
lib/gemini.ts                 → Gemini + Google Search grounding
lib/anthropic.ts              → Claude + herramienta de busqueda web
lib/supabase.ts                → clientes de Supabase (browser + admin)
lib/syncMeta.ts                → sincronizacion historica hacia Supabase (cron)
app/api/insights/              → consulta EN VIVO a Meta (campaign + adset + ad) para cualquier rango de fechas
app/api/analyze/gemini/        → analisis con Gemini, sin estado (recibe el JSON a analizar)
app/api/analyze/claude/        → analisis con Claude, sin estado
app/api/sync-meta/             → cron historico hacia Supabase
app/api/refresh/                → boton "Actualizar ahora"
app/page.tsx                    → el dashboard: campañas -> conjuntos de anuncios -> creativos, cada uno con sus tarjetas de IA
app/globals.css                  → estilos (tema Mastery)
```
