import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { rowToTransfer, TRANSFERS_LIST_TAG, type ConsignmentTransferRow } from '@/lib/consignment-transfers-pg';
import { TRANSFER_STATUSES, TransferActionError, type TransferStatus } from '@/lib/consignment-transfer-status';
import { createTransferDraft, revalidateTransferCaches, type TransferBody } from '@/lib/consignment-transfer-workflow';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 200;

// Cache pendek (15 dtk) seperti daftar Kirim Stok; setiap mutasi transfer membuang tag ini.
const getCachedTransfers = unstable_cache(
  async (from: string | null, to: string | null, status: TransferStatus | null) => {
    const sql = getSql();
    const statusFilter = status ? sql`and status = ${status}` : sql``;
    const fromFilter = from ? sql`and doc_date >= ${wibDayStart(from).toDate()}` : sql``;
    const toFilter = to ? sql`and doc_date <= ${wibDayEnd(to).toDate()}` : sql``;
    const rows = await sql<ConsignmentTransferRow[]>`
      select * from consignment_transfers where true ${statusFilter} ${fromFilter} ${toFilter}
      order by created_at desc limit ${DEFAULT_LIMIT}
    `;
    return rows.map(rowToTransfer);
  },
  [TRANSFERS_LIST_TAG],
  { revalidate: 15, tags: [TRANSFERS_LIST_TAG] },
);

// GET ?status=draft|approved|ditolak|dibatalkan &from=yyyy-mm-dd &to=yyyy-mm-dd (filter tanggal dokumen, WIB; semua opsional).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
    return Response.json({ error: 'Format tanggal harus yyyy-mm-dd.' }, { status: 400 });
  }
  const statusParam = searchParams.get('status');
  const status = statusParam && (TRANSFER_STATUSES as readonly string[]).includes(statusParam) ? statusParam as TransferStatus : null;
  const transfers = await getCachedTransfers(from, to, status);
  return Response.json({ transfers });
}

// POST { fromLocationId, toLocationId, items:[{productId, qty}], note?, date? } → dokumen DRAFT (tanpa efek stok).
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'create');
  if (guard instanceof Response) return guard;
  const body = await req.json().catch(() => null) as TransferBody | null;
  if (!body || typeof body !== 'object') return Response.json({ error: 'Body tidak valid.' }, { status: 400 });
  try {
    const { id } = await createTransferDraft(body, guard);
    revalidateTransferCaches();
    return Response.json({ id });
  } catch (err) {
    if (err instanceof TransferActionError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
