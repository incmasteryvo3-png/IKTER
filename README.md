# Mastery Dashboard — Meta Ads en tiempo real + análisis con Gemini

Sistema completo: se conecta a Meta Ads, trae campañas/conjuntos/anuncios
automáticamente cada cierto tiempo, guarda el histórico en una base de
datos propia, y usa Gemini para generar un análisis en lenguaje simple.
El dashboard muestra el embudo comparador (igual al de tus infografías)
y el comparador de creativos con insignias automáticas.

## Cómo funciona, de punta a punta

```
Meta Graph API
      │  (cada 30 min, cron automático)
      ▼
Función serverless (/api/sync-meta)  ──► guarda snapshot en Supabase
      ▲
      │  (también se puede disparar manual)
Botón "Actualizar ahora" (/api/refresh)

Supabase (base de datos)
      │
      ▼
Dashboard (page.tsx)  ──lee la última data guardada, no llama a Meta directo

Función serverless (/api/analyze) ──► le manda el JSON consolidado a Gemini
      │                                  y guarda el resumen en Supabase
      ▼
Panel "Lectura del equipo" en el dashboard
```

**El punto clave:** el dashboard nunca llama a Meta directamente. Siempre
lee de Supabase, que se mantiene actualizado solo por el cron. Esto hace
que la carga sea instantánea y que no dependamos de que Meta responda
rápido cada vez que alguien abre la página.

**Sobre "siempre la data más reciente":** el cron llama a Meta cada 30
minutos automáticamente, sin que nadie tenga que abrir nada — corre en
el servidor de Vercel las 24 horas. Además, el botón "Actualizar ahora"
fuerza una llamada inmediata. Una aclaración honesta: Meta consolida
algunas métricas de conversión con un retraso de horas por temas de
atribución, así que "más reciente" significa *lo último que Meta tiene
disponible*, no necesariamente lo que pasó hace 2 minutos exactos.

---

## Paso 1 — Crear la app y el token en Meta

Esto es lo único que se hace directamente en Meta. Sígelo en orden:

### 1.1 Crear una app en Meta for Developers

1. Ve a [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Crear app**.
2. Tipo de app: **Empresa** (Business).
3. Ponle un nombre (ej. "Mastery Dashboard") y asócialo a tu **Business Manager**.
4. Dentro de la app, agrega el producto **Marketing API**.

### 1.2 Crear un System User en el Business Manager

Un token de usuario normal expira en horas. Para algo que corre solo
24/7, necesitas un **token de System User**, que no expira:

1. Ve a [business.facebook.com](https://business.facebook.com) → **Configuración del negocio → Usuarios → Usuarios del sistema**.
2. **Añadir** → nombre (ej. "Mastery Sync Bot") → rol **Administrador**.
3. En **Añadir activos**, selecciona la(s) cuenta(s) publicitaria(s) que
   quieres monitorear y dale permiso de **Control total** (o al menos
   "Ver rendimiento").
4. Click en **Generar nuevo token**:
   - App: la que creaste en el paso 1.1.
   - Permisos: marca **`ads_read`** y **`read_insights`**.
   - Duración: el token de System User **no caduca** por defecto.
5. Copia el token generado — es lo que va en `META_SYSTEM_USER_TOKEN`.
   No lo vuelves a ver completo después, guárdalo ya en tu gestor de
   contraseñas.

### 1.3 Obtener el Ad Account ID

En [Ads Manager](https://adsmanager.facebook.com), arriba a la izquierda
verás algo como `Cuenta: 123456789`. El ID que necesitas es
`act_123456789` (con el prefijo `act_`). Eso va en `META_AD_ACCOUNT_ID`.

### 1.4 ¿Necesitas App Review?

- **Para monitorear tus propias cuentas** (las de Mastery, dentro de tu
  propio Business Manager): **no necesitas App Review**. El System User
  ya tiene acceso directo porque es admin de esas cuentas — esto se
  llama "Acceso Estándar" y es suficiente.
- **Para la Fase 2** (cuando cada cliente conecte *su propia* cuenta
  publicitaria, fuera de tu Business Manager): ahí sí Meta exige que
  pases por **verificación de negocio** y, para el permiso `ads_read`
  en cuentas ajenas, típicamente un **Acceso Avanzado** revisado por
  Meta (App Review). Es un proceso de Meta, no algo que yo controle;
  toma de días a semanas. Cuando lleguemos a esa fase te guío el
  formulario paso a paso.

---

## Paso 2 — Supabase (base de datos)

1. [supabase.com](https://supabase.com) → **New project**.
2. **SQL Editor** → pega y ejecuta `sql/schema.sql` completo.
3. **Settings → API** → copia:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (secreta, nunca al frontend)

## Paso 3 — Gemini

[aistudio.google.com/apikey](https://aistudio.google.com/apikey) → genera
una clave → `GEMINI_API_KEY`.

## Paso 4 — Variables de entorno

Copia `.env.example` a `.env.local` y llena todo. Para `CRON_SECRET`:

```bash
openssl rand -hex 32
```

## Paso 5 — Probar en local

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`, presiona **Actualizar ahora** para la
primera carga de datos reales.

## Paso 6 — Desplegar en Vercel

1. Sube el proyecto a GitHub.
2. [vercel.com](https://vercel.com) → **Add New → Project** → importa el repo.
3. Agrega todas las variables de `.env.local` en **Environment Variables**.
4. Despliega. Vercel lee `vercel.json` automáticamente y activa los crons:
   - `/api/sync-meta` cada 30 minutos.
   - `/api/analyze` una vez al día (8am).

A partir de aquí, el sistema se mantiene solo. Cada vez que alguien abra
la URL, ve la última data disponible — sin depender de que alguien lo
abra para que se actualice.

---

## Fase 2 — plataforma con login para clientes

La base ya está lista (`clients`, `client_members`, RLS en `sql/schema.sql`):

1. Activar **Supabase Auth**.
2. Un registro en `clients` por cliente; sus cuentas van en `ad_accounts`
   con ese `client_id`.
3. Vincular usuarios a clientes en `client_members`.
4. Filtrar el frontend por el cliente del usuario logueado.
5. Adaptar `/api/refresh` y `/api/analyze` para recibir `ad_account_id`
   y validar sesión, en vez de usar una sola cuenta fija.
6. Si el cliente conecta su propia cuenta de Meta (fuera de tu Business
   Manager), ahí aplica el tema de App Review mencionado arriba.

## Notas importantes

- `results` se define en `lib/meta.ts` buscando los `action_type`
  `lead`, `complete_registration`, `submit_application`. Ajústalo al
  evento de conversión real que configuraste en Meta.
- `video_play_time` es una **estimación** (reproducciones × tiempo
  promedio de reproducción), porque Meta no entrega el tiempo total
  reproducido como campo directo a nivel de anuncio.
- El botón "Actualizar ahora" es público (no pide login) porque no
  acepta parámetros del usuario — siempre sincroniza la cuenta fija de
  las variables de entorno. En Fase 2 debe protegerse con sesión.

## Estructura del proyecto

```
sql/schema.sql          → tablas + RLS para Supabase
lib/meta.ts               → llamadas a la Meta Graph API
lib/gemini.ts              → llamadas a Gemini y el prompt de análisis
lib/supabase.ts            → clientes de Supabase (browser + admin)
lib/syncMeta.ts            → lógica compartida de sincronización
app/api/sync-meta/        → ruta protegida, usada por el cron
app/api/refresh/           → ruta pública, botón "Actualizar ahora"
app/api/analyze/           → genera y guarda el análisis de Gemini
app/page.tsx               → el dashboard (embudo comparador + creativos)
app/globals.css            → estilos (tema Mastery)
```
