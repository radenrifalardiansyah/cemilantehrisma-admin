import { parseJsonb } from '@/lib/db';
import { guardWalletBalances } from '@/lib/wallet-balance';
import { rowToPurchase, type PurchaseRow } from '@/lib/materials-pg';
import type { PgTx } from '@/lib/doc-number';

// Logika inti pembelian bahan baku, dipakai bersama oleh Pembelian manual
// (api/material-purchases) dan Penerimaan Barang/GR yang di-approve (api/goods-receipts/[id]/approve)
// supaya stok, harga rata-rata, dan pengeluaran dihitung dengan rumus yang SAMA di kedua jalur.
// Semua fungsi jalan di dalam transaksi `pgTx` milik pemanggil.

export interface PurchaseItemInput {
  materialId: string; materialName: string; unit: string;
  qty: number; price: number;
}

export interface CreatePurchaseArgs {
  purchaseId: string;
  expenseId: string;
  supplierId: string | null;
  supplierName: string;
  items: PurchaseItemInput[];
  date: string;
  note: string;
  walletId: string | null;
  paymentStatus: 'lunas' | 'belum_lunas';
  poId?: string | null;
  grId?: string | null;
}

export async function createPurchaseTx(pgTx: PgTx, a: CreatePurchaseArgs): Promise<Record<string, unknown>> {
  const materialIds = a.items.map(it => it.materialId);
  const materialRows = await pgTx<{ id: string; stock_qty: string; avg_cost: string }[]>`
    select id, stock_qty, avg_cost from raw_materials where id in ${pgTx(materialIds)} order by id for update
  `;
  const materialById = new Map(materialRows.map(r => [r.id, r]));
  a.items.forEach(it => { if (!materialById.has(it.materialId)) throw new Error(`Bahan baku "${it.materialName}" tidak ditemukan.`); });

  const itemsWithSubtotal = a.items.map(it => ({ ...it, subtotal: it.qty * it.price }));
  const total = itemsWithSubtotal.reduce((s, it) => s + it.subtotal, 0);

  // State berjalan per bahan baku — bahan yang sama bisa muncul di lebih dari satu baris (mis.
  // 5 kg + 3 kg Tepung), jadi tiap baris harus melihat hasil baris sebelumnya, bukan nilai awal.
  const state = new Map([...materialById].map(([mid, m]) => [mid, { qty: Number(m.stock_qty) || 0, avg: Number(m.avg_cost) || 0 }]));
  for (const it of a.items) {
    const st = state.get(it.materialId)!;
    const qty = st.qty + it.qty;
    const avg = qty > 0 ? (st.qty * st.avg + it.qty * it.price) / qty : 0;
    state.set(it.materialId, { qty, avg });
  }
  for (const [mid, st] of state) {
    await pgTx`update raw_materials set stock_qty = ${st.qty}, avg_cost = ${st.avg}, updated_at = now() where id = ${mid}`;
  }

  // Catat otomatis sebagai Pengeluaran (uang keluar beneran saat beli bahan baku) — cuma kalau
  // sudah lunas. Kalau belum lunas, pengeluaran baru dicatat saat ditandai lunas (lihat
  // [id]/mark-lunas/route.ts), supaya Jurnal Kas/Laba Rugi tidak menghitung uang yang belum
  // benar-benar keluar.
  const willCreateExpense = total > 0 && a.paymentStatus === 'lunas';
  const source = a.grId ? 'po' : 'manual';

  const purchaseData = {
    supplierId: a.supplierId,
    supplierName: a.supplierName,
    items: itemsWithSubtotal,
    total, date: a.date, paymentStatus: a.paymentStatus,
    expenseId: willCreateExpense ? a.expenseId : null,
    note: a.note, walletId: a.walletId,
    source, poId: a.poId ?? null, grId: a.grId ?? null,
  };
  await pgTx`
    insert into material_purchases (id, supplier_id, supplier_name, items, total, date, payment_status, expense_id, note, wallet_id, source, po_id, gr_id, created_at)
    values (${a.purchaseId}, ${a.supplierId}, ${a.supplierName}, ${JSON.stringify(itemsWithSubtotal)}, ${total}, ${a.date}, ${a.paymentStatus}, ${willCreateExpense ? a.expenseId : null}, ${a.note}, ${a.walletId}, ${source}, ${a.poId ?? null}, ${a.grId ?? null}, now())
  `;

  if (willCreateExpense) {
    const itemNames = itemsWithSubtotal.map(it => it.materialName).join(', ');
    // Pembelian lunas = uang keluar dari dompet — dicek sama seperti Pengeluaran biasa supaya
    // saldo dompet tidak tembus minus lewat jalur pembelian bahan baku.
    await guardWalletBalances(pgTx, [a.walletId], async () => {
      await pgTx`
        insert into expenses (id, category, description, amount, date, note, wallet_id, source_type, source_id, created_at, updated_at)
        values (${a.expenseId}, 'Bahan Baku', ${`Pembelian bahan baku - ${a.supplierName || 'Tanpa nama'}`}, ${total}, ${a.date}, ${`Otomatis dari pembelian bahan baku (${itemNames})`}, ${a.walletId}, 'material-purchase', ${a.purchaseId}, now(), now())
      `;
    });
  }
  return purchaseData;
}

export interface VoidPurchaseResult {
  before: ReturnType<typeof rowToPurchase>;
  purchaseUpdate: Record<string, unknown>;
  expenseDeleted: boolean;
  reversed: boolean;
  skippedMaterials: string[];
}

// Batalkan (void) — baris pembelian TETAP ADA (ditandai voided) untuk jejak audit. Stok & harga
// rata-rata dikembalikan dengan rumus reversal yang SAMA seperti DELETE — TAPI hanya kalau aman
// (belum ada pembelian/produksi lain yang menyentuh bahan baku yang sama setelah transaksi ini).
// Kalau tidak aman, reversal dilewati dan dilaporkan lewat `reversed`/`skippedMaterials`.
export async function voidPurchaseTx(pgTx: PgTx, id: string, note: string): Promise<VoidPurchaseResult> {
  const [row] = await pgTx<PurchaseRow[]>`select * from material_purchases where id = ${id} for update`;
  if (!row) throw new Error('Pembelian tidak ditemukan.');
  const purchase = rowToPurchase(row);
  if (purchase.voided) throw new Error('Pembelian ini sudah dibatalkan sebelumnya.');

  const items = purchase.items;
  const materialIds = items.map(it => it.materialId);
  const materialRows = materialIds.length > 0
    ? await pgTx<{ id: string; stock_qty: string; avg_cost: string }[]>`select id, stock_qty, avg_cost from raw_materials where id in ${pgTx(materialIds)} order by id for update`
    : [];
  const materialById = new Map(materialRows.map(r => [r.id, r]));

  // Perbandingan lewat subquery, bukan JS Date `row.created_at` — sama seperti PUT & DELETE.
  const [laterPurchaseRows, laterBatchRows] = await Promise.all([
    pgTx<{ items: unknown }[]>`select items from material_purchases where created_at > (select created_at from material_purchases where id = ${id}) and id != ${id}`,
    pgTx<{ materials_used: unknown }[]>`select materials_used from production_batches where created_at > (select created_at from material_purchases where id = ${id})`,
  ]);
  const touchedAfter = new Set<string>();
  laterPurchaseRows.forEach(r => {
    ((parseJsonb(r.items) as { materialId: string }[] | null) ?? []).forEach(it => touchedAfter.add(it.materialId));
  });
  laterBatchRows.forEach(r => {
    ((parseJsonb(r.materials_used) as { materialId: string }[] | null) ?? []).forEach(m => touchedAfter.add(m.materialId));
  });

  const blockedNames = [...new Set(items.filter(it => touchedAfter.has(it.materialId)).map(it => it.materialName))];
  const canReverse = blockedNames.length === 0;

  if (canReverse) {
    // State berjalan per bahan baku, dibalik dari baris terakhir — sama seperti DELETE.
    const state = new Map([...materialById].map(([mid, m]) => [mid, { qty: Number(m.stock_qty) || 0, avg: Number(m.avg_cost) || 0 }]));
    for (const it of [...items].reverse()) {
      const st = state.get(it.materialId);
      if (!st) continue;
      const qty = st.qty - it.qty;
      // Kebalikan dari rumus rata-rata tertimbang saat pembelian — sama seperti DELETE.
      const avg = qty > 0 ? (st.avg * st.qty - it.qty * it.price) / qty : 0;
      state.set(it.materialId, { qty, avg });
    }
    for (const [mid, st] of state) {
      await pgTx`update raw_materials set stock_qty = ${Math.max(0, st.qty)}, avg_cost = ${Math.max(0, st.avg)}, updated_at = now() where id = ${mid}`;
    }
  }

  let deleted = false;
  if (purchase.expenseId) {
    const [expenseRow] = await pgTx<{ id: string }[]>`select id from expenses where id = ${purchase.expenseId}`;
    if (expenseRow) {
      await pgTx`delete from expenses where id = ${purchase.expenseId}`;
      deleted = true;
    }
  }

  const voidNote = note.trim();
  await pgTx`
    update material_purchases set
      voided = true, voided_at = now(), void_note = ${voidNote},
      payment_status = 'belum_lunas', expense_id = null, updated_at = now()
    where id = ${id}
  `;
  return {
    before: purchase,
    purchaseUpdate: { voided: true, voidNote, paymentStatus: 'belum_lunas', expenseId: null },
    expenseDeleted: deleted,
    reversed: canReverse,
    skippedMaterials: blockedNames,
  };
}
