import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requireWorker } from '@/lib/wa-worker-auth';

const STATES = new Set(['open', 'connecting', 'qr', 'close', 'logged-out']);

// Satu panggilan per menit dari worker: sekaligus heartbeat (?state=...) dan pengambilan konfigurasi.
// Flag resync dibaca lalu langsung dimatikan, supaya sinkron grup hanya dijalankan sekali per permintaan admin.
export async function GET(req: NextRequest) {
  const denied = requireWorker(req);
  if (denied) return denied;
  const sql = getSql();
  const state = req.nextUrl.searchParams.get('state') ?? '';
  const workerState = STATES.has(state) ? state : 'open';

  const [s] = await sql<{
    enabled: boolean; target_jid: string | null; keywords: string[]; exclude_keywords: string[];
    max_per_hour: number; resync_requested: boolean;
  }[]>`select enabled, target_jid, keywords, exclude_keywords, max_per_hour, resync_requested from wa_forward_settings where id = 1`;
  await sql`update wa_forward_settings set worker_state = ${workerState}, worker_last_seen = now(), resync_requested = false where id = 1`;
  if (!s) return Response.json({ error: 'Pengaturan belum dibuat (jalankan scripts/add-wa-forward.mjs).' }, { status: 500 });

  const links = await sql<{ jid: string; location_id: string; location_name: string }[]>`
    select l.jid, l.location_id, c.name as location_name
    from wa_group_links l join consignment_locations c on c.id = l.location_id
    where l.is_active
  `;
  return Response.json({
    enabled: s.enabled, targetJid: s.target_jid, keywords: s.keywords, excludeKeywords: s.exclude_keywords,
    maxPerHour: s.max_per_hour, resync: s.resync_requested,
    links: links.map(l => ({ jid: l.jid, locationId: l.location_id, locationName: l.location_name })),
  });
}
