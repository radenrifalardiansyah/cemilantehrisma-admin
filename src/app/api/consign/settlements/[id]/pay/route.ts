import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { auditConsign } from '@/lib/consign-audit';
import { rowToSettlement, type SettlementRow } from '@/lib/consign-settlement';

type Ctx = { params: Promise<{ id: string }> };

class PayError extends Error {}

// Bayar rekap ke penitip dari DOMPET LAPAK: saldo dompet berkurang sebesar total rekap (tidak boleh
// minus) dan rekap ditandai dibayar — atomik.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  try {
    const paid = await sql.begin(async tx => {
      const [st] = await tx<SettlementRow[]>`select * from consign_settlements where id = ${id} for update`;
      if (!st) throw new PayError('NOT_FOUND');
      if (st.status !== 'unpaid') throw new PayError('Rekap ini sudah dibayar.');
      // Kunci lapak supaya pembayaran/entri kas bersamaan tidak sama-sama lolos cek saldo.
      await tx`select id from stalls where id = ${st.stall_id} for update`;
      const [{ balance }] = await tx<{ balance: string | null }[]>`select sum(amount) as balance from stall_wallet_entries where stall_id = ${st.stall_id}`;
      const current = Number(balance ?? 0);
      const total = Number(st.total_amount);
      if (current < total) {
        throw new PayError(`Saldo dompet ${st.stall_name} tidak cukup (saldo Rp${current.toLocaleString('id-ID')}, perlu Rp${total.toLocaleString('id-ID')}).`);
      }
      await tx`
        insert into stall_wallet_entries (id, stall_id, kind, amount, ref_id, note, created_by, created_at)
        values (${randomUUID()}, ${st.stall_id}, 'payout', ${-total}, ${id}, ${`Bayar ${st.consignor_name} · ${st.doc_number}`}, ${guard.username}, now())
      `;
      const [row] = await tx<SettlementRow[]>`
        update consign_settlements set status = 'paid', paid_at = now(), paid_by = ${guard.username} where id = ${id} returning *
      `;
      return row;
    });
    await auditConsign(guard, 'update', 'settlements', id, `Bayar rekap ${paid.doc_number}`, { status: 'unpaid' }, { status: 'paid', total: Number(paid.total_amount) });
    return Response.json({ settlement: rowToSettlement(paid) });
  } catch (err) {
    if (err instanceof PayError) {
      return err.message === 'NOT_FOUND'
        ? Response.json({ error: 'Rekap tidak ditemukan.' }, { status: 404 })
        : Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
