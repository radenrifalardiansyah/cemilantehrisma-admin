import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { guardStall, rowToShift, type ShiftRow } from '@/lib/stall-pos-server';
import { randomUUID } from 'crypto';
import { auditConsign } from '@/lib/consign-audit';

type Ctx = { params: Promise<{ id: string }> };

// Tutup shift: hitung kas yang seharusnya (kas awal + penjualan TUNAI yang tidak dibatalkan)
// dibanding hitungan fisik kasir.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const data = await req.json() as { actualBalance?: number; note?: string };
  const sql = getSql();
  const [shift] = await sql<ShiftRow[]>`select * from stall_shifts where id = ${id}`;
  if (!shift) return Response.json({ error: 'Shift tidak ditemukan.' }, { status: 404 });
  const guard = await guardStall(req, 'create', shift.stall_id);
  if (guard instanceof Response) return guard;
  const actual = Number(data.actualBalance);
  if (!Number.isFinite(actual) || actual < 0) return Response.json({ error: 'Kas akhir tidak valid.' }, { status: 400 });

  const result = await sql.begin(async tx => {
    const [locked] = await tx<ShiftRow[]>`select * from stall_shifts where id = ${id} for update`;
    if (locked.status !== 'open') return null;
    const [{ cash }] = await tx<{ cash: string | null }[]>`
      select sum(total - refund_total) as cash from stall_sales where shift_id = ${id} and payment_method = 'cash' and status = 'paid'
    `;
    const cashTotal = Number(cash ?? 0);
    const expected = Number(locked.opening_balance) + cashTotal;
    const difference = actual - expected;
    // Selisih kas (hitungan fisik − seharusnya) dicatat otomatis di dompet lapak supaya saldo dompet
    // mengikuti kenyataan di laci: kurang = pengeluaran, lebih = pemasukan.
    if (difference !== 0) {
      await tx`
        insert into stall_wallet_entries (id, stall_id, kind, amount, ref_id, note, created_by, created_at)
        values (${randomUUID()}, ${locked.stall_id}, 'shift_diff', ${difference}, ${id}, ${`Selisih kas tutup shift (seharusnya ${expected}, hitungan ${actual})`}, ${guard.user.username}, now())
      `;
    }
    const [row] = await tx<ShiftRow[]>`
      update stall_shifts set status = 'closed', closed_at = now(), closed_by = ${guard.user.username},
        cash_sales_total = ${cashTotal}, expected_balance = ${expected}, actual_balance = ${actual}, difference = ${difference},
        close_note = ${(data.note ?? '').trim().slice(0, 200)}
      where id = ${id} returning *
    `;
    return row;
  });
  if (!result) return Response.json({ error: 'Shift sudah ditutup.' }, { status: 409 });
  await auditConsign(guard.user, 'update', 'stall-shifts', id, `Tutup kasir ${guard.stall.name}`, null, { actual, difference: Number(result.difference) });
  return Response.json({ shift: rowToShift(result) });
}
