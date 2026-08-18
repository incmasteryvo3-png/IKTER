# Puente Meta → GA4

Esto **no es parte del dashboard IKTER**. Es un módulo aparte para que los
eventos de conversión que hoy le mandas a Meta (Lead, Purchase, etc. —
vía Pixel del navegador y/o Conversions API del servidor) queden
**también** registrados en GA4, usando la GA4 Measurement Protocol.

## Por qué no es automático

No existe un conector nativo de Google que traiga esto solo. Hay que
decirle a GA4, evento por evento, "esto pasó" — igual que ya se lo dices
a Meta hoy. Este módulo es el código para hacer justo eso.

## Antes de instalarlo, necesito saber esto de tu lado

El código de ejemplo asume que puedes tocar el lugar donde hoy se
dispara el evento hacia Meta (¿es tu propio backend? ¿Google Tag
Manager (server-side)? ¿un webhook del CRM?). Sin saber eso no puedo
decirte el punto exacto donde pegar la llamada — pero la función
`sendEventToGa4` en `sendToGa4.ts` funciona igual sin importar de dónde
la llames, siempre que sea desde un entorno Node/servidor (o una Cloud
Function, o un Vercel Function, etc.).

## Configuración

1. En GA4 → Admin → **Flujos de datos** → tu flujo de datos web → **Medición
   mediante Measurement Protocol** → crea un secreto de API.
2. Copia el **Measurement ID** (formato `G-XXXXXXXXXX`, visible en el
   mismo flujo de datos) y el **API secret** que acabas de crear.
3. Agrega estas 2 variables de entorno donde vaya a correr este código:
   ```
   GA4_MEASUREMENT_ID=G-XXXXXXXXXX
   GA4_API_SECRET=...
   ```
4. Revisa `sendToGa4.ts` — especialmente la sección sobre `client_id`,
   es la parte más importante de leer antes de usar esto en serio: de
   eso depende si el evento en GA4 queda conectado a la sesión real de
   esa persona en el sitio, o si aparece como una sesión nueva y suelta.
5. Ajusta el mapa `META_TO_GA4_EVENT_NAME` a los eventos reales que
   dispara el sitio (la misma lista que ya usa IKTER en la constante
   `EVENTS` de `app/page.tsx`, para que ambos lados queden consistentes).
6. Prueba con el **DebugView** de GA4 (Admin → DebugView) antes de dar
   por buena la integración — ahí ves en vivo si los eventos están
   llegando bien formados.

## Archivos

- `sendToGa4.ts` — la función reutilizable, sin dependencias externas.
- `example-uso.ts` — cómo llamarla justo al lado de tu llamada actual a
  la Meta Conversions API.
