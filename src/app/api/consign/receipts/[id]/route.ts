import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToReceipt, type ReceiptRow } from '@/lib/consign-pg';
import { voidReceipt, ConsignStockError } from '@/lib/consign-receipts';
import { auditConsign } from '@/lib/consign-audit';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan dokumen terima/retur: stok dibalik. Ditolak kalau stok sudah terpakai.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [row] = await sql<ReceiptRow[]>`select * from consign_receipts where id = ${id}`;
  if (!row) return Response.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404 });
  const r = rowToReceipt(row);
  try {
    await sql.begin(async tx => {
      // Kunci dokumen supaya dua pembatalan bersamaan tidak membalik stok dua kali.
      const [locked] = await tx`select id from consign_receipts where id = ${id} for update`;
      if (!locked) throw new ConsignStockError('Dokumen sudah dibatalkan.');
      await voidReceipt(tx, { id: r.id, docNumber: r.docNumber, kind: r.kind, stallId: r.stallId, stallName: r.stallName, items: r.items });
    });
  } catch (err) {
    if (err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
  await auditConsign(guard, 'delete', 'receipts', id, `Batal ${r.docNumber}`, { docNumber: r.docNumber, totalQty: r.totalQty }, null);
  return Response.json({ ok: true });
}
