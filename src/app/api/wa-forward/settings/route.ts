import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { parseKeywordList, WA_GROUP_JID_RE } from '@/lib/wa-forward';

export async function PUT(req: NextRequest) {
  const guard = await requirePermission(req, 'wa-forward', 'edit');
  if (guard instanceof Response) return guard;
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: 'Data tidak valid.' }, { status: 400 });
  const sql = getSql();

  const targetJid = typeof b.targetJid === 'string' && b.targetJid ? b.targetJid : null;
  if (targetJid) {
    if (!WA_GROUP_JID_RE.test(targetJid)) return Response.json({ error: 'Grup tujuan tidak valid.' }, { status: 400 });
    const [g] = await sql`select 1 from wa_groups where jid = ${targetJid}`;
    if (!g) return Response.json({ error: 'Grup tujuan belum terdeteksi worker.' }, { status: 400 });
    // Grup mitra tidak boleh jadi tujuan: pesan akan berputar balik ke grup yang dibaca.
    const [linked] = await sql`select 1 from wa_group_links where jid = ${targetJid}`;
    if (linked) return Response.json({ error: 'Grup tujuan tidak boleh sama dengan grup mitra.' }, { status: 400 });
  }
  const keywords = parseKeywordList(b.keywords);
  if (keywords.length === 0) return Response.json({ error: 'Minimal satu kata kunci.' }, { status: 400 });
  const excludeKeywords = parseKeywordList(b.excludeKeywords);
  const maxPerHour = Math.round(Number(b.maxPerHour));
  if (!Number.isFinite(maxPerHour) || maxPerHour < 1 || maxPerHour > 600) return Response.json({ error: 'Batas per jam harus 1–600.' }, { status: 400 });
  const enabled = b.enabled === true;
  if (enabled && !targetJid) return Response.json({ error: 'Pilih grup tujuan sebelum mengaktifkan.' }, { status: 400 });

  await sql`
    update wa_forward_settings set enabled = ${enabled}, target_jid = ${targetJid}, keywords = ${keywords},
      exclude_keywords = ${excludeKeywords}, max_per_hour = ${maxPerHour}, updated_by = ${guard.username}, updated_at = now()
    where id = 1
  `;
  return Response.json({ ok: true });
}
