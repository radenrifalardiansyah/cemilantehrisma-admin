import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { createPurchaseTx, type PurchaseItemInput } from '@/lib/material-purchase-core';
import { invalidPurchaseItemMessage } from '@/lib/validate-items';
import { logHistory } from '@/lib/history';
import { rowToPurchase, type PurchaseRow } from '@/lib/materials-pg';
import { wibDateKey } from '@/lib/date';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  // `?limit=all` → tanpa batas (LIMIT NULL di Postgres) — dipakai tab riwayat supaya pencarian,
  // opsi tampil "Semua", dan export tidak diam-diam terpotong di 50 data terakhir.
  const limitParam = searchParams.get('limit');
  const limit = limitParam === 'all' ? null : parseInt(limitParam ?? '50') || 50;
  const sql = getSql();
  const rows = await sql<PurchaseRow[]>`
    select p.*, po.po_number, gr.gr_number
    from material_purchases p
    left join purchase_orders po on po.id = p.po_id
    left join goods_receipts gr on gr.id = p.gr_id
    order by p.created_at desc limit ${limit}
  `;
  return Response.json({ purchases: rows.map(rowToPurchase) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    supplierId?: string; supplierName: string; date?: string; note?: string; items: PurchaseItemInput[];
    paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
  };
  const items = data.items ?? [];
  if (items.length === 0) return Response.json({ error: 'Minimal 1 bahan baku.' }, { status: 400 });
  const itemError = invalidPurchaseItemMessage(items);
  if (itemError) return Response.json({ error: itemError }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
  const date = data.date || wibDateKey(new Date());

  const db = getDb();
  const sql = getSql();
  const purchaseId = randomUUID();
  const expenseId = randomUUID();
  let purchaseData: Record<string, unknown> = {};

  // Bahan baku (Tahap 18b) DAN dokumen pembelian & pengeluaran otomatis (expenses, Tahap 5)
  // sama-sama di Postgres, jadi digabung jadi SATU transaksi atomic. Logikanya ada di
  // createPurchaseTx (dipakai bersama approve GR).
  try {
    await sql.begin(async pgTx => {
      purchaseData = await createPurchaseTx(pgTx, {
        purchaseId, expenseId,
        supplierId: data.supplierId ?? null,
        supplierName: data.supplierName ?? '',
        items, date, paymentStatus,
        note: data.note ?? '',
        walletId: data.walletId ?? null,
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan pembelian.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'material-purchases',
      entityId: purchaseId,
      entityLabel: `${data.supplierName?.trim() || 'Tanpa nama'} - Rp${purchaseData.total}`,
      action: 'create',
      actor: guard,
      after: purchaseData,
    });
  } catch (err) {
    console.error('Failed to write history for material purchase create', err);
  }
  revalidateTag('admin-materials', { expire: 0 });
  if (purchaseData.expenseId) revalidateTag('admin-expenses', { expire: 0 });
  revalidateTag('admin-analytics', { expire: 0 });

  return Response.json({ id: purchaseId });
}
