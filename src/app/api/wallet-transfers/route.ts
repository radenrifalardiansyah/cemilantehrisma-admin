import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { SettlementError, parseLinks } from '@/lib/closing-settlement';
import { logLinkChanges } from '@/lib/closing-settlement-history';
import { TransferValidationError, createWalletTransfer, parseTransferInput } from '@/lib/wallet-transfers-pg';

interface WalletTransferRow {
  id: string; from_wallet_id: string; to_wallet_id: string; amount: string; date: string; note: string | null;
  created_at: Date; updated_at: Date | null;
}

function toTimestamp(d: Date | null) {
  if (!d) return null;
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
}

interface ClosingLinkRow { wallet_transfer_id: string; closing_id: string; amount: string; period_from: string | null; period_to: string }

function toTransfer(r: WalletTransferRow, links: ClosingLinkRow[]) {
  return {
    id: r.id,
    fromWalletId: r.from_wallet_id,
    toWalletId: r.to_wallet_id,
    amount: Number(r.amount),
    date: r.date,
    note: r.note ?? '',
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
    // Tautan ke closing HPP (status transfer closing) — hanya untuk badge & alokasi, tidak mempengaruhi saldo.
    closingLinks: links.map(l => ({ closingId: l.closing_id, amount: Number(l.amount), periodFrom: l.period_from, periodTo: l.period_to })),
  };
}

// Migrated dari Firestore ke Postgres (Tahap 3 migrasi) — lihat plan gleaming-wondering-quokka.md.
const getCachedWalletTransfers = unstable_cache(
  async () => {
    const sql = getSql();
    const [rows, linkRows] = await Promise.all([
      sql<WalletTransferRow[]>`select * from wallet_transfers order by date desc`,
      sql<ClosingLinkRow[]>`
        select s.wallet_transfer_id, s.closing_id, s.amount, c.period_from, c.period_to
        from closing_settlements s join closings c on c.id = s.closing_id order by c.period_to, c.closed_at
      `,
    ]);
    const byTransfer = new Map<string, ClosingLinkRow[]>();
    for (const l of linkRows) { const a = byTransfer.get(l.wallet_transfer_id); if (a) a.push(l); else byTransfer.set(l.wallet_transfer_id, [l]); }
    return rows.map(r => toTransfer(r, byTransfer.get(r.id) ?? []));
  },
  ['admin-wallet-transfers'],
  { revalidate: 15, tags: ['admin-wallet-transfers'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'view');
  if (guard instanceof Response) return guard;
  const transfers = await getCachedWalletTransfers();
  return Response.json({ transfers });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();

  const parsed = parseTransferInput(data);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const payload = parsed.input;

  // Tautan closing opsional (satu transaksi dengan transfernya). Memilih closing butuh akses baca product-report.
  let links: { closingId: string; amount: number }[] = [];
  if (data.closingLinks !== undefined) {
    const pl = parseLinks(data.closingLinks);
    if ('error' in pl) return Response.json({ error: pl.error }, { status: 400 });
    if (pl.links.length > 0 && !(await hasPermission(guard, 'product-report', 'view'))) {
      return Response.json({ error: 'Anda tidak punya akses untuk menautkan transfer ke closing.' }, { status: 403 });
    }
    links = pl.links;
  }

  let created: Awaited<ReturnType<typeof createWalletTransfer>>;
  try {
    created = await createWalletTransfer(getSql(), db, payload, links, guard.username);
  } catch (err) {
    if (err instanceof TransferValidationError || err instanceof SettlementError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
  const { id: transferId, fromName, toName, applied } = created;

  try {
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: transferId,
      entityLabel: `${fromName} → ${toName} - Rp${payload.amount.toLocaleString('id-ID')}`,
      action: 'create',
      actor: guard,
      after: { ...payload, ...(links.length > 0 ? { closingLinks: links } : {}) },
    });
  } catch (err) {
    console.error('Failed to write history for wallet-transfers create', err);
  }
  await logLinkChanges(db, guard, { transferId, transferLabel: '', diff: applied, periodTo: applied.periodTo });
  revalidateTag('admin-wallet-transfers', { expire: 0 });
  return Response.json({ id: transferId });
}
