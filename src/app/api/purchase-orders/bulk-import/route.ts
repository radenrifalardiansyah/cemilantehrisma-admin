import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { invalidPurchaseItemMessage } from '@/lib/validate-items';
import { logHistory } from '@/lib/history';
import { createPoTx } from '@/lib/purchase-orders-core';
import { wibDateKey } from '@/lib/date';

interface ImportPo {
  supplierName: string; supplierPhone?: string; date?: string; expectedDate?: string | null; note?: string;
  items: { materialId: string; materialName: string; unit: string; qty: number; price: number }[];
}

// Impor PO dari Excel — sudah dikelompokkan di klien (satu PO per supplier+tanggal). Semua PO
// masuk sebagai draft (belum dikirim). Tiap PO transaksi sendiri; yang gagal dilewati & dihitung.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const { purchaseOrders } = await req.json() as { purchaseOrders: ImportPo[] };
  if (!Array.isArray(purchaseOrders) || purchaseOrders.length === 0) {
    return Response.json({ error: 'Tidak ada data PO untuk diimpor.' }, { status: 400 });
  }
  if (purchaseOrders.length > 200) return Response.json({ error: 'Maksimal 200 PO per impor.' }, { status: 400 });

  const sql = getSql();
  const suppliers = await sql<{ id: string; name: string }[]>`select id, name from suppliers`;
  const supplierByName = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s.id]));

  let created = 0, skippedInvalid = 0;
  for (const po of purchaseOrders) {
    const name = (po.supplierName ?? '').toString().trim();
    if (!name || !Array.isArray(po.items) || po.items.length === 0 || invalidPurchaseItemMessage(po.items)) { skippedInvalid++; continue; }
    try {
      const res = await sql.begin(pgTx => createPoTx(pgTx, {
        supplierId: supplierByName.get(name.toLowerCase()) ?? null, supplierName: name,
        supplierPhone: (po.supplierPhone ?? '').toString(), date: po.date || wibDateKey(new Date()),
        expectedDate: po.expectedDate || null, note: (po.note ?? '').toString().trim(), items: po.items, createdBy: guard.username,
      }));
      created++;
      try {
        await logHistory(getDb(), {
          entity: 'purchase-orders', entityId: res.id, entityLabel: `${res.poNumber} - ${name} - Rp${res.total}`,
          action: 'create', actor: guard, after: { poNumber: res.poNumber, supplierName: name, items: res.poItems, total: res.total }, meta: { source: 'excel-import' },
        });
      } catch (err) { console.error('Failed to write history for PO import', err); }
    } catch { skippedInvalid++; }
  }
  return Response.json({ created, skippedInvalid });
}
