import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Ringkasan untuk halaman admin: pengaturan + status worker, daftar grup terdeteksi, pemetaan, dan daftar mitra.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wa-forward', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [settings, groups, links, locations] = await Promise.all([
    sql<{
      enabled: boolean; target_jid: string | null; keywords: string[]; exclude_keywords: string[]; max_per_hour: number;
      resync_requested: boolean; worker_state: string; worker_last_seen: Date | null; worker_desired: boolean;
    }[]>`select enabled, target_jid, keywords, exclude_keywords, max_per_hour, resync_requested, worker_state, worker_last_seen, worker_desired from wa_forward_settings where id = 1`,
    sql<{ jid: string; subject: string }[]>`select jid, subject from wa_groups order by subject`,
    sql<{ jid: string; location_id: string; is_active: boolean }[]>`select jid, location_id, is_active from wa_group_links`,
    sql<{ id: string; name: string; code: string | null }[]>`select id, name, code from consignment_locations order by name`,
  ]);
  const s = settings[0];
  if (!s) return Response.json({ error: 'Pengaturan belum dibuat (jalankan scripts/add-wa-forward.mjs).' }, { status: 500 });
  // Worker dianggap online bila terlihat dalam 3 menit terakhir (ia menghubungi server tiap ±1 menit).
  const online = !!s.worker_last_seen && Date.now() - s.worker_last_seen.getTime() < 3 * 60_000;
  return Response.json({
    settings: {
      enabled: s.enabled, targetJid: s.target_jid, keywords: s.keywords, excludeKeywords: s.exclude_keywords,
      maxPerHour: s.max_per_hour, resyncRequested: s.resync_requested,
    },
    worker: { online, desired: s.worker_desired, state: online ? s.worker_state : 'offline', lastSeen: s.worker_last_seen ? s.worker_last_seen.toISOString() : null },
    groups: groups.map(g => ({ jid: g.jid, subject: g.subject })),
    links: links.map(l => ({ jid: l.jid, locationId: l.location_id, isActive: l.is_active })),
    locations: locations.map(l => ({ id: l.id, name: l.name, code: l.code ?? '' })),
  });
}
