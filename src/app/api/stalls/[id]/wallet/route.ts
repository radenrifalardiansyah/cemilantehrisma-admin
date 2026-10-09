import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { toTimestamp } from '@/lib/orders-pg';
import { auditConsign } from '@/lib/consign-audit';

type Ctx = { params: Promise<{ id: string }> };

interface EntryRow { id: string; kind: string; amount: string; ref_id: string | null; note: string; created_by: string | null; created_at: Date }

// Buku kas/dompet lapak: saldo + riwayat entri (terbaru dulu).
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [stall] = await sql`select id from stalls where id = ${id}`;
  if (!stall) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 404 });
  const [rows, [{ balance }]] = await Promise.all([
    sql<EntryRow[]>`select id, kind, amount, ref_id, note, created_by, created_at from stall_wallet_entries where stall_id = ${id} order by created_at desc limit 300`,
    sql<{ balance: string | null }[]>`select sum(amount) as balance from stall_wallet_entries where stall_id = ${id}`,
  ]);
  return Response.json({
    balance: Number(balance ?? 0),
    entries: rows.map(r => ({ id: r.id, kind: r.kind, amount: Number(r.amount), refId: r.ref_id, note: r.note, createdBy: r.created_by ?? '', createdAt: toTimestamp(r.created_at) })),
  });
}

// Entri manual: tambah modal/setoran ('in') atau ambil kas/setor ke toko ('out'). Saldo tidak boleh minus.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return Response.json({ error: 'Jumlah harus lebih dari 0.' }, { status: 400 });
  const direction = data.direction === 'out' ? 'out' : 'in';
  const note = typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '';
  if (!note) return Response.json({ error: 'Keterangan wajib diisi.' }, { status: 400 });

  const sql = getSql();
  try {
    const result = await sql.begin(async tx => {
      // Kunci baris lapak supaya dua entri bersamaan tidak sama-sama lolos cek saldo.
      const [stall] = await tx<{ id: string; name: string }[]>`select id, name from stalls where id = ${id} for update`;
      if (!stall) throw new Error('NOT_FOUND');
      const [{ balance }] = await tx<{ balance: string | null }[]>`select sum(amount) as balance from stall_wallet_entries where stall_id = ${id}`;
      const current = Number(balance ?? 0);
      const signed = direction === 'out' ? -amount : amount;
      if (current + signed < 0) throw new Error(`INSUFFICIENT:${current}`);
      const entryId = randomUUID();
      await tx`
        insert into stall_wallet_entries (id, stall_id, kind, amount, note, created_by, created_at)
        values (${entryId}, ${id}, 'manual', ${signed}, ${note}, ${guard.username}, now())
      `;
      return { entryId, name: stall.name, balance: current + signed };
    });
    await auditConsign(guard, 'update', 'stall-wallet', id, `Dompet lapak ${result.name}`, null, { direction, amount, note, balanceAfter: result.balance });
    return Response.json({ ok: true, balance: result.balance });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'NOT_FOUND') return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 404 });
    if (msg.startsWith('INSUFFICIENT:')) {
      return Response.json({ error: `Saldo dompet lapak tidak cukup (saldo Rp${Number(msg.split(':')[1]).toLocaleString('id-ID')}).` }, { status: 400 });
    }
    throw err;
  }
}
