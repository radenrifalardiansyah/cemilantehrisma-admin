import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Log kejadian worker terbaru (terbaru dulu) untuk halaman admin. ?limit= maks 200.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wa-forward', 'view');
  if (guard instanceof Response) return guard;
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100));
  const rows = await getSql()<{ id: string; at: Date; level: string; text: string }[]>`
    select id, at, level, text from wa_worker_events order by id desc limit ${limit}
  `;
  return Response.json({ events: rows.map(r => ({ id: r.id, at: r.at.toISOString(), level: r.level, text: r.text })) });
}
