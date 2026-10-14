import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { WA_GROUP_JID_RE } from '@/lib/wa-forward';

// Pasangkan satu mitra dengan satu grup WA (locationId + jid), atau lepas (jid kosong). Satu mitra = satu grup,
// satu grup = satu mitra (dijaga unique index di database).
export async function PUT(req: NextRequest) {
  const guard = await requirePermission(req, 'wa-forward', 'edit');
  if (guard instanceof Response) return guard;
  const b = await req.json().catch(() => null) as { locationId?: unknown; jid?: unknown; isActive?: unknown } | null;
  const locationId = typeof b?.locationId === 'string' ? b.locationId : '';
  if (!locationId) return Response.json({ error: 'locationId wajib.' }, { status: 400 });
  const sql = getSql();
  const [loc] = await sql`select 1 from consignment_locations where id = ${locationId}`;
  if (!loc) return Response.json({ error: 'Mitra tidak ditemukan.' }, { status: 404 });

  const jid = typeof b?.jid === 'string' ? b.jid : '';
  await sql.begin(async tx => {
    await tx`delete from wa_group_links where location_id = ${locationId}`;
    if (!jid) return;
    if (!WA_GROUP_JID_RE.test(jid)) throw new HttpError(400, 'Grup tidak valid.');
    const [g] = await tx`select 1 from wa_groups where jid = ${jid}`;
    if (!g) throw new HttpError(400, 'Grup belum terdeteksi worker.');
    const [target] = await tx`select 1 from wa_forward_settings where id = 1 and target_jid = ${jid}`;
    if (target) throw new HttpError(400, 'Grup ini adalah grup tujuan, tidak bisa dipasangkan ke mitra.');
    const [taken] = await tx`select 1 from wa_group_links where jid = ${jid}`;
    if (taken) throw new HttpError(409, 'Grup ini sudah dipasangkan ke mitra lain.');
    await tx`insert into wa_group_links (jid, location_id, is_active) values (${jid}, ${locationId}, ${b?.isActive !== false})`;
  }).catch(e => { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); throw e; });
  revalidateTag('admin-consignment-locations', { expire: 0 }); // daftar Mitra menampilkan badge Grup WA
  return Response.json({ ok: true });
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
