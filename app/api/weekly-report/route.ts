import { NextRequest, NextResponse } from 'next/server';
import { buildWeeklyReport, renderWeeklyEmail, getRecipients, sendEmails } from '@/lib/weeklyReport';
import { getSessionUser, isCronRequest } from '@/lib/authServer';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Resumen semanal por correo.
//
// - Cron de Vercel (lunes 8am Colombia, ver vercel.json): llega con
//   "Authorization: Bearer <CRON_SECRET>" y envía a TODOS los usuarios
//   registrados.
// - Con sesión iniciada (desde el navegador):
//     /api/weekly-report            → vista previa del correo (no envía nada)
//     /api/weekly-report?enviar=yo  → te lo envía SOLO a ti, para probar
//   Un usuario con sesión NUNCA puede disparar el envío masivo.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const siteUrl = process.env.SITE_URL || origin;

  try {
    if (isCronRequest(req)) {
      const report = await buildWeeklyReport();
      const { subject, html } = renderWeeklyEmail(report, siteUrl);
      const to = await getRecipients();
      if (!to.length) return NextResponse.json({ ok: true, sent: 0, note: 'No hay usuarios confirmados.' });
      const sent = await sendEmails(to, subject, html);
      return NextResponse.json({ ok: true, sent, week: report.week });
    }

    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const report = await buildWeeklyReport();
    const { subject, html } = renderWeeklyEmail(report, siteUrl);

    if (searchParams.get('enviar') === 'yo') {
      if (!user.email) return NextResponse.json({ error: 'Tu usuario no tiene correo.' }, { status: 400 });
      await sendEmails([user.email], `[Prueba] ${subject}`, html);
      return new NextResponse(
        `<p style="font-family:sans-serif">Listo: te envié el resumen de prueba a <b>${user.email}</b>. Revisa también la carpeta de spam.</p>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (err: any) {
    console.error('Error en /api/weekly-report:', err);
    return NextResponse.json({ error: err?.message || 'Error al generar el resumen semanal.' }, { status: 500 });
  }
}
