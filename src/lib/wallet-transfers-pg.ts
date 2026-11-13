import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import type { Firestore } from 'firebase-admin/firestore';
import { parseMoneyAmount } from '@/lib/validate-input';
import { computeWalletBalance } from '@/lib/wallet-balance';
import { wibDateKey } from '@/lib/date';
import { applyTransferLinks, type AppliedLinks, type LinkInput } from '@/lib/closing-settlement';

// Kegagalan validasi yang diketahui (saldo kurang, dompet tidak ditemukan, dst) — dilempar dari dalam
// transaksi supaya bisa dibedakan dari error tak terduga dan diterjemahkan ke respons 400.
export class TransferValidationError extends Error {}

export interface TransferInput { fromWalletId: string; toWalletId: string; amount: number; date: string; note: string }

// Validasi bentuk body POST /api/wallet-transfers (dipakai juga oleh "Catat transfer baru" dari Closing).
export function parseTransferInput(data: Record<string, unknown>): { input: TransferInput } | { error: string } {
  const fromWalletId = typeof data.fromWalletId === 'string' ? data.fromWalletId : '';
  const toWalletId = typeof data.toWalletId === 'string' ? data.toWalletId : '';
  const amount = parseMoneyAmount(data.amount) ?? 0;
  if (!fromWalletId || !toWalletId) return { error: 'Dompet asal dan tujuan wajib diisi.' };
  if (fromWalletId === toWalletId) return { error: 'Dompet asal dan tujuan tidak boleh sama.' };
  if (amount <= 0) return { error: 'Jumlah transfer harus lebih dari 0.' };
  return {
    input: {
      fromWalletId, toWalletId, amount,
      date: typeof data.date === 'string' && data.date ? data.date : wibDateKey(new Date()),
      note: (data.note as string | undefined) ?? '',
    },
  };
}

export interface CreatedTransfer { id: string; fromName: string; toName: string; applied: AppliedLinks }

// Buat transfer antar dompet (+ tautan closing opsional) dalam SATU transaksi DB.
// Kunci advisory dompet asal (pg_advisory_xact_lock(hashtext(fromWalletId))) supaya dua transfer keluar dari
// dompet yang sama yang tiba hampir bersamaan tidak lolos validasi berdasarkan saldo yang sama (TOCTOU).
export async function createWalletTransfer(
  sql: postgres.Sql, db: Firestore, input: TransferInput, links: LinkInput[], username: string,
): Promise<CreatedTransfer> {
  const [fromRow, toRow] = await Promise.all([
    sql<{ name: string; initial_balance: string }[]>`select name, initial_balance from wallets where id = ${input.fromWalletId}`,
    sql<{ name: string }[]>`select name from wallets where id = ${input.toWalletId}`,
  ]);
  if (!fromRow[0]) throw new TransferValidationError('Dompet asal tidak ditemukan.');
  if (!toRow[0]) throw new TransferValidationError('Dompet tujuan tidak ditemukan.');
  const fromName = fromRow[0].name ?? input.fromWalletId;
  const toName = toRow[0].name ?? input.toWalletId;
  const fromInitialBalance = Number(fromRow[0].initial_balance) || 0;

  return sql.begin(async pgTx => {
    await pgTx`select pg_advisory_xact_lock(hashtext(${input.fromWalletId}))`;
    const fromBalance = await computeWalletBalance(db, input.fromWalletId, fromInitialBalance, undefined, undefined, pgTx);
    if (input.amount > fromBalance) {
      throw new TransferValidationError(`Saldo "${fromName}" tidak cukup (saldo saat ini Rp${Math.round(fromBalance).toLocaleString('id-ID')}).`);
    }
    const id = randomUUID();
    await pgTx`
      insert into wallet_transfers (id, from_wallet_id, to_wallet_id, amount, date, note, created_at, updated_at)
      values (${id}, ${input.fromWalletId}, ${input.toWalletId}, ${input.amount}, ${input.date}, ${input.note}, now(), now())
    `;
    const applied = await applyTransferLinks(pgTx, { transferId: id, transferAmount: input.amount, links, username });
    return { id, fromName, toName, applied };
  });
}
