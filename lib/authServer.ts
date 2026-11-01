import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Usuario con sesion iniciada, leido desde las cookies dentro de una ruta
// /api. El middleware ya bloquea las llamadas sin sesion; esto se usa
// cuando la ruta necesita SABER quien es (ej. su correo).
export async function getSessionUser() {
  const store = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(list) {
          try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* solo lectura */ }
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** true si la llamada trae "Authorization: Bearer <CRON_SECRET>". */
export function isCronRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}
