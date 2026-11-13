import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { ClosingError, createClosing } from '@/lib/closing';
import { loadSettlements, settlementRemaining, settlementStatus } from '@/lib/closing-settlement';

interface ClosingRow {
  id: string; period_from: string | null; period_to: string; closed_at: Date; closed_by: string | null;
  total_qty: string | null; total_cogs: string | null; total_revenue: string | null; item_count: number; note: string | null;
  status: string; reopened_at: Date | null; reopened_by: string | null; reopen_reason: string | null; is_opening_balance: boolean;
}

// Riwayat closing (terbaru dulu) + id closing aktif paling terakhir (satu-satunya yang boleh dibuka ulang).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'product-report', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const rows = await sql<ClosingRow[]>`select * from closings order by period_to desc, closed_at desc limit 200`;
  const latestActiveId = rows.find(r => r.status === 'aktif')?.id ?? null;
  const num = (v: string | null) => v == null ? null : Number(v);
  // Tautan transfer dompet (status transfer closing): ringkasan tanpa saldo dompet.
  const settlements = await loadSettlements(sql, rows.map(r => r.id));
  const byClosing = new Map<string, typeof settlements>();
  for (const s of settlements) { const a = byClosing.get(s.closingId); if (a) a.push(s); else byClosing.set(s.closingId, [s]); }
  return Response.json({
    latestActiveId,
    closings: rows.map(r => {
      const links = byClosing.get(r.id) ?? [];
      const settledAmount = links.reduce((n, l) => n + l.amount, 0);
      const cogs = num(r.total_cogs);
      const status = settlementStatus({ totalCogs: cogs, status: r.status, isOpeningBalance: r.is_opening_balance }, settledAmount);
      return {
        id: r.id, periodFrom: r.period_from, periodTo: r.period_to, closedAt: r.closed_at.toISOString(), closedBy: r.closed_by ?? '',
        totalQty: num(r.total_qty), totalCogs: cogs, totalRevenue: num(r.total_revenue), itemCount: r.item_count,
        note: r.note ?? '', status: r.status, reopenedAt: r.reopened_at?.toISOString() ?? null, reopenedBy: r.reopened_by ?? '',
        reopenReason: r.reopen_reason ?? '', isOpeningBalance: r.is_opening_balance,
        settledAmount, settlementStatus: status, settlementRemaining: status && cogs != null ? settlementRemaining(cogs, settledAmount) : null,
        settlements: links.map(l => ({
          id: l.id, walletTransferId: l.walletTransferId, amount: l.amount, date: l.date,
          fromWalletName: l.fromWalletName, toWalletName: l.toWalletName, createdBy: l.createdBy,
        })),
      };
    }),
  });
}

// Closing: ambil semua transaksi yang sudah dibayar & belum closing sampai `upTo` (tanggal bayar, WIB),
// hitung HPP & omzet (proporsional untuk cicilan), tandai closing_id, simpan baris closings — satu transaksi DB.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'product-report', 'close');
  if (guard instanceof Response) return guard;
  const body = await req.json().catch(() => ({})) as { upTo?: string; note?: string };
  const upTo = String(body.upTo ?? '');
  const note = String(body.note ?? '').slice(0, 500);

  let result: Awaited<ReturnType<typeof createClosing>>;
  try {
    result = await createClosing(getSql(), { upTo, note, username: guard.username });
  } catch (err) {
    if (err instanceof ClosingError) return Response.json({ error: err.message }, { status: 400 });
    console.error('Closing gagal', err);
    return Response.json({ error: 'Gagal melakukan closing.' }, { status: 500 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'closings', entityId: result.id, entityLabel: `Closing sampai ${result.periodTo}`,
      action: 'create', actor: guard, after: { ...result, note },
    });
  } catch (err) {
    console.error('Failed to write history for closing', err);
  }
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, closing: result });
}
