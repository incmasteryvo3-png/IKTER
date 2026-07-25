import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// Cliente para el navegador (frontend). Ahora usa @supabase/ssr en vez del
// cliente basico, porque asi guarda la sesion en cookies (no solo en
// localStorage) - eso es lo que le permite al middleware (que corre en el
// servidor) saber si la persona esta logueada antes de mostrarle una pagina.
export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Cliente para el servidor (funciones serverless) - usa la Service Role Key.
// Ignora RLS por completo. NUNCA debe llegar al navegador.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
