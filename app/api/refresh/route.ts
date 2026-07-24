import { NextResponse } from 'next/server';
import { runMetaSync } from '@/lib/syncMeta';

export const maxDuration = 60;

export async function POST() {
  try {
    const result = await runMetaSync();
    return NextResponse.json({ ok: true, ...result, synced_at: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
