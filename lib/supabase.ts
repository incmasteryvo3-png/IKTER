import { createClient } from '@supabase/supabase-js';

// Cliente para el navegador (frontend) - usa la clave publica (anon)
// Respeta Row Level Security. Seguro para exponer en el cliente.
export const supabaseBrowser = createClient(
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
