import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { lockClosings } from '@/lib/closing';
import {
  SettlementError, allocationProblem, diffLinks, isEmptyDiff,
  type ClosingForLink, type LinkDiff, type LinkInput,
} from '@/lib/closing-settlement-core';

export * from '@/lib/closing-settlement-core';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/closing.ts
type PgClient = postgres.ISql<{}>;

// ── Akses DB ────────────────────────────────────────────────────────────────────────────────

export const lockTransferRow = async (tx: PgClient, transferId: string) => {
  const [t] = await tx<{ id: string; amount: string; from_wallet_id: string; to_wallet_id: string; date: string }[]>`
    select id, amount, from_wallet_id, to_wallet_id, date from wallet_transfers where id = ${transferId} for update
  `;
  return t ?? null;
};

export async function linkedTotalOfTransfer(tx: PgClient, transferId: string): Promise<number> {
  const [r] = await tx<{ s: string }[]>`select coalesce(sum(amount), 0) as s from closing_settlements where wallet_transfer_id = ${transferId}`;
  return Number(r.s) || 0;
}

export interface AppliedLinks extends LinkDiff { periodTo: Record<string, string> }

// Jadikan `links` sebagai SELURUH tautan sebuah transfer (set pengganti). Panggil di DALAM transaksi, setelah
// baris transfer dikunci (lockTransferRow) atau baru di-insert. Tanpa tautan lama maupun baru -> tidak mengunci apa pun.
export async function applyTransferLinks(
  tx: PgClient, a: { transferId: string; transferAmount: number; links: LinkInput[]; username: string },
): Promise<AppliedLinks> {
  const existing = await tx<{ id: string; closing_id: string; amount: string }[]>`
    select id, closing_id, amount from closing_settlements where wallet_transfer_id = ${a.transferId}
  `;
  const none: AppliedLinks = { added: [], changed: [], removed: [], periodTo: {} };
  if (a.links.length === 0 && existing.length === 0) return none;

  if (a.links.length > 0) {
    await lockClosings(tx);
    const ids = [...new Set(a.links.map(l => l.closingId))].sort();
    const rows = await tx<{ id: string; status: string; is_opening_balance: boolean; total_cogs: string | null; period_to: string }[]>`
      select id, status, is_opening_balance, total_cogs, period_to from closings where id in ${tx(ids)} order by id for update
    `;
    const others = await tx<{ closing_id: string; s: string }[]>`
      select closing_id, sum(amount) as s from closing_settlements
      where closing_id in ${tx(ids)} and wallet_transfer_id <> ${a.transferId} group by closing_id
    `;
    const otherMap = new Map(others.map(o => [o.closing_id, Number(o.s) || 0]));
    const closings = new Map<string, ClosingForLink>(rows.map(r => [r.id, {
      id: r.id, status: r.status, isOpeningBalance: r.is_opening_balance,
      totalCogs: r.total_cogs == null ? null : Number(r.total_cogs), settledByOthers: otherMap.get(r.id) ?? 0, periodTo: r.period_to,
    }]));
    const problem = allocationProblem({ links: a.links, transferAmount: a.transferAmount, closings });
    if (problem) throw new SettlementError(problem);
  }

  const diff = diffLinks(existing.map(e => ({ closingId: e.closing_id, amount: Number(e.amount) })), a.links);
  const involved = [...new Set([...diff.added, ...diff.changed, ...diff.removed].map(d => d.closingId))];
  if (isEmptyDiff(diff)) return none;

  if (diff.removed.length > 0) {
    await tx`delete from closing_settlements where wallet_transfer_id = ${a.transferId} and closing_id in ${tx(diff.removed.map(d => d.closingId))}`;
  }
  for (const c of diff.changed) {
    await tx`update closing_settlements set amount = ${c.after} where wallet_transfer_id = ${a.transferId} and closing_id = ${c.closingId}`;
  }
  for (const c of diff.added) {
    await tx`
      insert into closing_settlements (id, closing_id, wallet_transfer_id, amount, created_at, created_by)
      values (${randomUUID()}, ${c.closingId}, ${a.transferId}, ${c.amount}, now(), ${a.username})
    `;
  }
  const periods = await tx<{ id: string; period_to: string }[]>`select id, period_to from closings where id in ${tx(involved)}`;
  return { ...diff, periodTo: Object.fromEntries(periods.map(p => [p.id, p.period_to])) };
}

// Tautkan transfer YANG SUDAH ADA ke satu closing (tanpa mengubah tautan lain milik transfer itu).
export async function linkExistingTransfer(
  sql: postgres.Sql, a: { closingId: string; transferId: string; amount: number; username: string },
) {
  return sql.begin(async tx => {
    const t = await lockTransferRow(tx, a.transferId);
    if (!t) throw new SettlementError('Transfer tidak ditemukan.');
    const existing = await tx<{ closing_id: string; amount: string }[]>`
      select closing_id, amount from closing_settlements where wallet_transfer_id = ${a.transferId}
    `;
    if (existing.some(e => e.closing_id === a.closingId)) {
      throw new SettlementError('Transfer ini sudah tertaut ke closing ini. Lepas tautan lebih dulu bila ingin mengubah nominalnya.');
    }
    const links = [...existing.map(e => ({ closingId: e.closing_id, amount: Number(e.amount) })), { closingId: a.closingId, amount: a.amount }];
    const applied = await applyTransferLinks(tx, { transferId: a.transferId, transferAmount: Number(t.amount), links, username: a.username });
    return { transfer: { id: t.id, amount: Number(t.amount), date: t.date, fromWalletId: t.from_wallet_id, toWalletId: t.to_wallet_id }, applied };
  });
}

// Lepas satu tautan (milik closing `closingId`). Mengembalikan data tautan yang dilepas untuk riwayat.
export async function unlinkSettlement(sql: postgres.Sql, a: { closingId: string; settlementId: string }) {
  return sql.begin(async tx => {
    // Kunci baris transfer lebih dulu (urutan kunci sama dengan PUT/DELETE transfer) agar tak race dengan perubahan transfer.
    const [link] = await tx<{ wallet_transfer_id: string }[]>`
      select wallet_transfer_id from closing_settlements where id = ${a.settlementId} and closing_id = ${a.closingId}
    `;
    if (!link) throw new SettlementError('Tautan tidak ditemukan.');
    await lockTransferRow(tx, link.wallet_transfer_id);
    const rows = await tx<{ id: string; wallet_transfer_id: string; amount: string; period_to: string }[]>`
      with del as (
        delete from closing_settlements where id = ${a.settlementId} and closing_id = ${a.closingId}
        returning id, closing_id, wallet_transfer_id, amount
      )
      select del.id, del.wallet_transfer_id, del.amount, c.period_to from del join closings c on c.id = del.closing_id
    `;
    if (!rows[0]) throw new SettlementError('Tautan tidak ditemukan.');
    return { id: rows[0].id, transferId: rows[0].wallet_transfer_id, amount: Number(rows[0].amount), periodTo: rows[0].period_to };
  });
}

// Lepas SEMUA tautan sebuah transfer (dipakai saat transfer dihapus). Panggil setelah baris transfer dikunci.
export async function releaseTransferLinks(tx: PgClient, transferIds: string[]) {
  if (transferIds.length === 0) return [];
  const rows = await tx<{ wallet_transfer_id: string; closing_id: string; amount: string; period_to: string }[]>`
    with del as (
      delete from closing_settlements where wallet_transfer_id in ${tx(transferIds)}
      returning closing_id, wallet_transfer_id, amount
    )
    select del.wallet_transfer_id, del.closing_id, del.amount, c.period_to from del join closings c on c.id = del.closing_id
  `;
  return rows.map(r => ({ transferId: r.wallet_transfer_id, closingId: r.closing_id, amount: Number(r.amount), periodTo: r.period_to }));
}

export interface SettlementRow {
  id: string; closingId: string; walletTransferId: string; amount: number; date: string;
  fromWalletId: string; toWalletId: string; fromWalletName: string; toWalletName: string; createdBy: string; createdAt: string;
}

// Tautan beserta data transfer & nama dompet (TANPA saldo) untuk kartu/riwayat closing.
export async function loadSettlements(sql: postgres.Sql | PgClient, closingIds?: string[]): Promise<SettlementRow[]> {
  const filter = closingIds ? sql`where s.closing_id in ${sql(closingIds)}` : sql``;
  if (closingIds && closingIds.length === 0) return [];
  const rows = await sql<{
    id: string; closing_id: string; wallet_transfer_id: string; amount: string; created_by: string | null; created_at: Date;
    date: string; from_wallet_id: string; to_wallet_id: string; from_name: string | null; to_name: string | null;
  }[]>`
    select s.id, s.closing_id, s.wallet_transfer_id, s.amount, s.created_by, s.created_at,
           t.date, t.from_wallet_id, t.to_wallet_id, fw.name as from_name, tw.name as to_name
    from closing_settlements s
    join wallet_transfers t on t.id = s.wallet_transfer_id
    left join wallets fw on fw.id = t.from_wallet_id
    left join wallets tw on tw.id = t.to_wallet_id
    ${filter}
    order by t.date, s.created_at
  `;
  return rows.map(r => ({
    id: r.id, closingId: r.closing_id, walletTransferId: r.wallet_transfer_id, amount: Number(r.amount), date: r.date,
    fromWalletId: r.from_wallet_id, toWalletId: r.to_wallet_id, fromWalletName: r.from_name ?? r.from_wallet_id, toWalletName: r.to_name ?? r.to_wallet_id,
    createdBy: r.created_by ?? '', createdAt: r.created_at.toISOString(),
  }));
}
