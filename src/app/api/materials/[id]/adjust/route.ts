import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToMaterial, type MaterialRow } from '@/lib/materials-pg';

type Ctx = { params: Promise<{ id: string }> };

// Koreksi langsung stok & harga rata-rata bahan baku ke angka yang benar SEKARANG — tanpa
// menulis ulang riwayat pembelian/produksi yang sudah terkunci. Dipakai kalau ada kesalahan
// input lama yang sudah tidak bisa diedit lagi karena bahan bakunya sudah dipakai/dibeli lagi.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as { newStockQty?: number; newAvgCost?: number; note: string };
  if (!data.note?.trim()) return Response.json({ error: 'Catatan/alasan koreksi wajib diisi.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  const adjustmentId = randomUUID();

  let before: ReturnType<typeof rowToMaterial>;
  let after: { stockQty: number; avgCost: number };

  try {
    ({ before, after } = await sql.begin(async pgTx => {
      const [row] = await pgTx<MaterialRow[]>`select * from raw_materials where id = ${id} for update`;
      if (!row) throw new Error('Bahan baku tidak ditemukan.');
      const m = rowToMaterial(row);
      const oldStockQty = m.stockQty;
      const oldAvgCost = m.avgCost;
      const newStockQty = Math.max(0, data.newStockQty != null ? Number(data.newStockQty) : oldStockQty);
      const newAvgCost = Math.max(0, data.newAvgCost != null ? Number(data.newAvgCost) : oldAvgCost);

      await pgTx`update raw_materials set stock_qty = ${newStockQty}, avg_cost = ${newAvgCost}, updated_at = now() where id = ${id}`;
      await pgTx`
        insert into material_adjustments (id, material_id, material_name, unit, old_stock_qty, new_stock_qty, old_avg_cost, new_avg_cost, note, created_at)
        values (${adjustmentId}, ${id}, ${m.name}, ${m.unit}, ${oldStockQty}, ${newStockQty}, ${oldAvgCost}, ${newAvgCost}, ${data.note.trim()}, now())
      `;
      return { before: m, after: { stockQty: newStockQty, avgCost: newAvgCost } };
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan koreksi.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'materials',
      entityId: id,
      entityLabel: before.name,
      action: 'update',
      actor: guard,
      before,
      after: { ...before, ...after },
      meta: { adjustQty: after.stockQty - before.stockQty, note: data.note.trim() },
    });
  } catch (err) {
    console.error('Failed to write history for material adjust', err);
  }

  return Response.json({ ok: true });
}
