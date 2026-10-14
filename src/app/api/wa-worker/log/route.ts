import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requireWorker } from '@/lib/wa-worker-auth';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

// POST = catat pesan baru (idempotent: message_key sama → { duplicate: true }, worker berhenti, tidak kirim dobel).
// PATCH = laporkan hasil kirim ke grup kita (sent / failed).
export async function POST(req: NextRequest) {
  const denied = requireWorker(req);
  if (denied) return denied;
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  const key = str(b?.messageKey, 300); const jid = str(b?.sourceJid, 100); const body = str(b?.body, 8000);
  if (!key || !jid || !body.trim()) return Response.json({ error: 'messageKey, sourceJid, body wajib.' }, { status: 400 });
  const sql = getSql();
  // Nama mitra diambil dari pemetaan saat ini (bukan dari worker) supaya label selalu konsisten dengan admin.
  const [link] = await sql<{ location_id: string; name: string }[]>`
    select l.location_id, c.name from wa_group_links l join consignment_locations c on c.id = l.location_id where l.jid = ${jid} and l.is_active
  `;
  if (!link) return Response.json({ error: 'Grup tidak terpetakan ke mitra.' }, { status: 404 });
  const id = randomUUID();
  const [row] = await sql<{ id: string }[]>`
    insert into wa_forward_log (id, message_key, source_jid, location_id, location_name, sender_name, body)
    values (${id}, ${key}, ${jid}, ${link.location_id}, ${link.name}, ${str(b?.senderName, 100)}, ${body})
    on conflict (message_key) do nothing returning id
  `;
  if (!row) return Response.json({ duplicate: true });
  return Response.json({ id, locationName: link.name });
}

export async function PATCH(req: NextRequest) {
  const denied = requireWorker(req);
  if (denied) return denied;
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  const id = str(b?.id, 100);
  const status = b?.status;
  if (!id || (status !== 'sent' && status !== 'failed')) return Response.json({ error: 'id & status (sent/failed) wajib.' }, { status: 400 });
  const sql = getSql();
  await sql`
    update wa_forward_log set status = ${status}, error = ${status === 'failed' ? str(b?.error, 500) || 'gagal' : null},
      sent_at = ${status === 'sent' ? new Date() : null}
    where id = ${id}
  `;
  return Response.json({ ok: true });
}
