import { NextResponse } from 'next/server';
import { getAdAccounts } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

// Lista de cuentas publicitarias para el selector del header.
export async function GET() {
  const accounts = getAdAccounts();
  if (accounts.length === 0) {
    return NextResponse.json({ error: 'Falta META_AD_ACCOUNTS (o META_AD_ACCOUNT_ID) en el servidor.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, accounts });
}
