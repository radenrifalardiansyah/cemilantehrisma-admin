import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { auditConsign } from '@/lib/consign-audit';
import { wibDateKey } from '@/lib/date';
import { rowToOwnSettlement, type OwnSettlementRow } from '@/lib/stall-own';

type Ctx = { params: Promise<{ id: string }> };

class PayError extends Error {}

// Bayar setoran: uang keluar dari DOMPET LAPAK (saldo tidak boleh minus) dan masuk sebagai PEMASUKAN toko
// ke dompet toko yang dipilih — satu transaksi atomik.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'stall-own', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json().catch(() => ({})) as { walletId?: string };
  const walletId = typeof data.walletId === 'string' ? data.walletId : '';
  if (!walletId) return Response.json({ error: 'Pilih dompet toko tujuan.' }, { status: 400 });
  const sql = getSql();
  try {
    const paid = await sql.begin(async tx => {
      const [wallet] = await tx<{ id: string; is_active: boolean }[]>`select id, is_active from wallets where id = ${walletId}`;
      if (!wallet || !wallet.is_active) throw new PayError('Dompet toko tidak ditemukan atau nonaktif.');
      const [st] = await tx<OwnSettlementRow[]>`select * from stall_own_settlements where id = ${id} for update`;
      if (!st) throw new PayError('NOT_FOUND');
      if (st.status !== 'unpaid') throw new PayError('Setoran ini sudah dibayar.');
      const total = Number(st.total_amount);
      if (!(total > 0)) throw new PayError('Total setoran nol atau negatif — tidak bisa dibayar. Hapus setoran ini lalu buat ulang.');
      await tx`select id from stalls where id = ${st.stall_id} for update`;
      const [{ balance }] = await tx<{ balance: string | null }[]>`select sum(amount) as balance from stall_wallet_entries where stall_id = ${st.stall_id}`;
      const current = Number(balance ?? 0);
      if (current < total) {
        throw new PayError(`Saldo dompet ${st.stall_name} tidak cukup (saldo Rp${current.toLocaleString('id-ID')}, perlu Rp${total.toLocaleString('id-ID')}).`);
      }
      await tx`
        insert into stall_wallet_entries (id, stall_id, kind, amount, ref_id, note, created_by, created_at)
        values (${randomUUID()}, ${st.stall_id}, 'payout', ${-total}, ${id}, ${`Setoran ke toko · ${st.doc_number}`}, ${guard.username}, now())
      `;
      const incomeId = randomUUID();
      const items = (rowToOwnSettlement(st).items).map(i => ({ name: i.productName, qty: i.qty, amount: i.amount }));
      await tx`
        insert into income (id, category, description, amount, items, date, note, wallet_id, created_at, updated_at)
        values (${incomeId}, 'Penjualan Lapak', ${`Setoran ${st.stall_name} · ${st.doc_number}`}, ${total}, ${JSON.stringify(items)}, ${wibDateKey(new Date())},
          ${`Periode ${st.period_from} s/d ${st.period_to}`}, ${walletId}, now(), now())
      `;
      const [row] = await tx<OwnSettlementRow[]>`
        update stall_own_settlements set status = 'paid', wallet_id = ${walletId}, income_id = ${incomeId}, paid_at = now(), paid_by = ${guard.username} where id = ${id} returning *
      `;
      return row;
    });
    await auditConsign(guard, 'update', 'stall-settlements', id, `Bayar setoran ${paid.doc_number}`, { status: 'unpaid' }, { status: 'paid', total: Number(paid.total_amount), walletId });
    revalidateTag('admin-income', { expire: 0 });
    revalidateTag('admin-analytics', { expire: 0 });
    return Response.json({ settlement: rowToOwnSettlement(paid) });
  } catch (err) {
    if (err instanceof PayError) {
      return err.message === 'NOT_FOUND' ? Response.json({ error: 'Setoran tidak ditemukan.' }, { status: 404 }) : Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
