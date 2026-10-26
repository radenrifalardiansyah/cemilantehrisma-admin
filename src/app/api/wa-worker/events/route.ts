import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requireWorker } from '@/lib/wa-worker-auth';

const KEEP = 500; // log kejadian disimpan sebanyak ini saja (yang lama otomatis dibuang)

// Worker mengirim kumpulan kejadian (terhubung/putus, pesan masuk & alasan lolos/dilewati, error) untuk ditampilkan di admin.
export async function POST(req: NextRequest) {
  const denied = requireWorker(req);
  if (denied) return denied;
  const b = await req.json().catch(() => null) as { events?: { at?: unknown; level?: unknown; text?: unknown }[] } | null;
  const now = Date.now();
  const events = (b?.events ?? []).slice(0, 100).flatMap(e => {
    const text = typeof e.text === 'string' ? e.text.trim().slice(0, 500) : '';
    if (!text) return [];
    const level = e.level === 'warn' || e.level === 'error' ? e.level : 'info';
    const t = typeof e.at === 'number' && Number.isFinite(e.at) ? Math.min(now, Math.max(now - 24 * 3600_000, e.at)) : now;
    return [{ at: new Date(t), level, text }];
  });
  if (events.length === 0) return Response.json({ saved: 0 });
  const sql = getSql();
  await sql`insert into wa_worker_events ${sql(events, 'at', 'level', 'text')}`;
  await sql`delete from wa_worker_events where id <= (select id from wa_worker_events order by id desc offset ${KEEP} limit 1)`;
  return Response.json({ saved: events.length });
}
