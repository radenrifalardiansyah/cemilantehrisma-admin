import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { computeWalletBalance } from '@/lib/wallet-balance';
import { logHistory } from '@/lib/history';

interface WalletTransferRow {
  id: string; from_wallet_id: string; to_wallet_id: string; amount: string; date: string; note: string | null;
  created_at: Date; updated_at: Date | null;
}

function toTimestamp(d: Date | null) {
  if (!d) return null;
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
}

function toTransfer(r: WalletTransferRow) {
  return {
    id: r.id,
    fromWalletId: r.from_wallet_id,
    toWalletId: r.to_wallet_id,
    amount: Number(r.amount),
    date: r.date,
    note: r.note ?? '',
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}

// Migrated dari Firestore ke Postgres (Tahap 3 migrasi) — lihat plan gleaming-wondering-quokka.md.
const getCachedWalletTransfers = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<WalletTransferRow[]>`select * from wallet_transfers order by date desc`;
    return rows.map(toTransfer);
  },
  ['admin-wallet-transfers'],
  { revalidate: 15 },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'view');
  if (guard instanceof Response) return guard;
  const transfers = await getCachedWalletTransfers();
  return Response.json({ transfers });
}

// Kegagalan validasi yang diketahui (saldo kurang, dompet tidak ditemukan, dst) — dilempar dari
// dalam transaksi supaya bisa dibedakan dari error tak terduga dan diterjemahkan ke respons 400.
class TransferValidationError extends Error {}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();

  const fromWalletId = typeof data.fromWalletId === 'string' ? data.fromWalletId : '';
  const toWalletId = typeof data.toWalletId === 'string' ? data.toWalletId : '';
  const amount = Number(data.amount) || 0;
  if (!fromWalletId || !toWalletId) return Response.json({ error: 'Dompet asal dan tujuan wajib diisi.' }, { status: 400 });
  if (fromWalletId === toWalletId) return Response.json({ error: 'Dompet asal dan tujuan tidak boleh sama.' }, { status: 400 });
  if (amount <= 0) return Response.json({ error: 'Jumlah transfer harus lebih dari 0.' }, { status: 400 });

  // Dompet sendiri masih di Firestore (belum dipindah) — cukup baca biasa (bukan transaksi),
  // karena satu-satunya tulisan di route ini sekarang ke Postgres (wallet_transfers), bukan
  // Firestore lagi.
  const [fromSnap, toSnap] = await Promise.all([
    db.collection('wallets').doc(fromWalletId).get(),
    db.collection('wallets').doc(toWalletId).get(),
  ]);
  if (!fromSnap.exists) return Response.json({ error: 'Dompet asal tidak ditemukan.' }, { status: 400 });
  if (!toSnap.exists) return Response.json({ error: 'Dompet tujuan tidak ditemukan.' }, { status: 400 });
  const fromName = fromSnap.data()?.name ?? fromWalletId;
  const toName = toSnap.data()?.name ?? toWalletId;

  const payload = {
    fromWalletId, toWalletId, amount,
    date: typeof data.date === 'string' && data.date ? data.date : new Date().toISOString().slice(0, 10),
    note: (data.note as string | undefined) ?? '',
  };

  let transferId: string;
  const sql = getSql();
  try {
    // Kunci baris via pg_advisory_xact_lock(hashtext(fromWalletId)) supaya dua transfer keluar
    // dari dompet yang sama yang tiba hampir bersamaan tidak lolos validasi berdasarkan saldo yang
    // sama (TOCTOU) — transaksi kedua menunggu transaksi pertama commit sebelum hitung ulang saldo,
    // beda dari mekanisme retry otomatis Firestore, tapi mencegah race yang sama. Ini HANYA
    // melindungi porsi data yang sudah di Postgres (capital_entries, wallet_transfers); porsi
    // Firestore (income/expenses/orders/consignmentRecaps) tetap dibaca best-effort di luar
    // transaksi ini — trade-off yang diterima selama migrasi bertahap, lihat plan.
    transferId = await sql.begin(async (pgTx) => {
      await pgTx`select pg_advisory_xact_lock(hashtext(${fromWalletId}))`;
      const fromBalance = await computeWalletBalance(db, fromWalletId, Number(fromSnap.data()?.initialBalance) || 0, undefined, undefined, pgTx);
      if (amount > fromBalance) {
        throw new TransferValidationError(`Saldo "${fromName}" tidak cukup (saldo saat ini Rp${Math.round(fromBalance).toLocaleString('id-ID')}).`);
      }
      const id = randomUUID();
      await pgTx`
        insert into wallet_transfers (id, from_wallet_id, to_wallet_id, amount, date, note, created_at, updated_at)
        values (${id}, ${payload.fromWalletId}, ${payload.toWalletId}, ${payload.amount}, ${payload.date}, ${payload.note}, now(), now())
      `;
      return id;
    });
  } catch (err) {
    if (err instanceof TransferValidationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }

  try {
    await logHistory(db, {
      entity: 'wallet-transfers',
      entityId: transferId,
      entityLabel: `${fromName} → ${toName} - Rp${amount.toLocaleString('id-ID')}`,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for wallet-transfers create', err);
  }
  return Response.json({ id: transferId });
}
