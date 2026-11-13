import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { settlementRemaining, settlementStatus } from '@/lib/closing-settlement';

// Pemilih closing untuk "Untuk closing" di Transfer Antar Dompet: closing AKTIF, bukan saldo awal, ber-HPP, yang belum
// lunas ditransfer (sisa > Rp1). Terlama dulu. Hanya baca.
// `?transferId=` (saat edit transfer): sisa dihitung TANPA tautan transfer itu sendiri, dan closing yang sudah ditautkan
// oleh transfer itu tetap ikut (field `mine` = nominal tautannya) walau tanpa itu sebenarnya sudah lunas.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'product-report', 'view');
  if (guard instanceof Response) return guard;
  const transferId = new URL(req.url).searchParams.get('transferId') ?? '';
  const sql = getSql();
  const rows = await sql<{ id: string; period_from: string | null; period_to: string; total_cogs: string; others: string; mine: string }[]>`
    select c.id, c.period_from, c.period_to, c.total_cogs,
           coalesce(sum(s.amount) filter (where s.wallet_transfer_id <> ${transferId}), 0) as others,
           coalesce(sum(s.amount) filter (where s.wallet_transfer_id = ${transferId}), 0) as mine
    from closings c left join closing_settlements s on s.closing_id = c.id
    where c.status = 'aktif' and not c.is_opening_balance and c.total_cogs is not null and c.total_cogs > 0
    group by c.id order by c.period_to, c.closed_at
  `;
  const closings = rows.flatMap(r => {
    const totalCogs = Number(r.total_cogs);
    const settledAmount = Number(r.others);
    const mine = Number(r.mine);
    const status = settlementStatus({ totalCogs, status: 'aktif', isOpeningBalance: false }, settledAmount);
    if (status === null || (status === 'sudah' && mine <= 0)) return [];
    return [{ id: r.id, periodFrom: r.period_from, periodTo: r.period_to, totalCogs, settledAmount, remaining: settlementRemaining(totalCogs, settledAmount), mine, status }];
  });
  return Response.json({ closings });
}
