import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requireWorker } from '@/lib/wa-worker-auth';
import { WA_GROUP_JID_RE } from '@/lib/wa-forward';

// Worker mengirim daftar grup yang diikuti nomornya (id + nama). Hanya menambah/memperbarui nama; pemetaan ke mitra
// dibuat admin secara manual.
export async function POST(req: NextRequest) {
  const denied = requireWorker(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null) as { groups?: { jid?: unknown; subject?: unknown }[] } | null;
  const groups = (body?.groups ?? [])
    .filter((g): g is { jid: string; subject: string } => typeof g.jid === 'string' && WA_GROUP_JID_RE.test(g.jid))
    .slice(0, 500)
    .map(g => ({ jid: g.jid, subject: typeof g.subject === 'string' ? g.subject.slice(0, 200) : '' }));
  if (groups.length === 0) return Response.json({ saved: 0 });
  const sql = getSql();
  await sql`
    insert into wa_groups ${sql(groups, 'jid', 'subject')}
    on conflict (jid) do update set subject = excluded.subject, last_seen_at = now()
  `;
  return Response.json({ saved: groups.length });
}
