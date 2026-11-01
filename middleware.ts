import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Corre antes de CUALQUIER pagina y de CUALQUIER ruta /api (ver "matcher").
//
// - Paginas: sin sesion -> redirige a /login (igual que antes).
// - Rutas /api: sin sesion -> 401 en JSON (antes quedaban abiertas a
//   cualquiera que conociera la URL). Excepciones, que ya tienen su
//   propia clave y la siguen validando dentro de cada ruta:
//     * llamadas con "Authorization: Bearer <CRON_SECRET>" (cron de
//       Vercel, GitHub Actions, backfill y diagnosticos manuales)
//     * el webhook de GHL (/api/webhooks/*, valida X-Webhook-Secret)
const PUBLIC_API_PREFIXES = ['/api/webhooks/'];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith('/api/');

  if (isApi) {
    if (PUBLIC_API_PREFIXES.some((p) => path.startsWith(p))) return NextResponse.next();
    const auth = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && auth === `Bearer ${cronSecret}`) return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (isApi) {
    if (!user) {
      return NextResponse.json({ error: 'Tu sesión expiró. Recarga la página e inicia sesión de nuevo.' }, { status: 401 });
    }
    return response;
  }

  const isLoginPage = path.startsWith('/login');

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Aplica a todo (incluidas las rutas /api) EXCEPTO archivos estaticos
    // de Next y el logo (imagenes en /public).
    '/((?!_next/static|_next/image|favicon.ico|logo-mastery.png).*)',
  ],
};
