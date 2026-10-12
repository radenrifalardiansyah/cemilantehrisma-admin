import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { auditConsign } from '@/lib/consign-audit';
import { rowToSettlement, type SettlementRow } from '@/lib/consign-settlement';

type Ctx = { params: Promise<{ id: string }> };

class UnpayError extends Error {}

// Batalkan PEMBAYARAN rekap (mis. salah bayar): uang dikembalikan ke dompet lapak lewat entri pembalik
// (riwayat tetap utuh) dan rekap kembali "Belum dibayar" — lalu bisa diubah, dibayar ulang, atau dihapus.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  try {
    const row = await sql.begin(async tx => {
      const [st] = await tx<SettlementRow[]>`select * from consign_settlements where id = ${id} for update`;
      if (!st) throw new UnpayError('NOT_FOUND');
      if (st.status !== 'paid') throw new UnpayError('Rekap ini belum dibayar.');
      await tx`select id from stalls where id = ${st.stall_id} for update`;
      await tx`
        insert into stall_wallet_entries (id, stall_id, kind, amount, ref_id, note, created_by, created_at)
        values (${randomUUID()}, ${st.stall_id}, 'payout', ${Number(st.total_amount)}, ${id}, ${`Batal bayar ${st.consignor_name} · ${st.doc_number}`}, ${guard.username}, now())
      `;
      const [updated] = await tx<SettlementRow[]>`update consign_settlements set status = 'unpaid', paid_at = null, paid_by = null where id = ${id} returning *`;
      return updated;
    });
    await auditConsign(guard, 'update', 'settlements', id, `Batal bayar rekap ${row.doc_number}`, { status: 'paid' }, { status: 'unpaid', total: Number(row.total_amount) });
    return Response.json({ settlement: rowToSettlement(row) });
  } catch (err) {
    if (err instanceof UnpayError) {
      return err.message === 'NOT_FOUND' ? Response.json({ error: 'Rekap tidak ditemukan.' }, { status: 404 }) : Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
