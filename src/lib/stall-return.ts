// Perhitungan retur sebagian penjualan lapak (murni, tanpa database) — dipakai server & pratinjau di UI.

export interface ReturnableItem { price: number; qty: number; returnedQty?: number }
export interface ReturnSelection { index: number; qty: number }

// Sisa yang masih boleh diretur untuk satu item.
export const remainingQty = (i: ReturnableItem) => i.qty - (i.returnedQty ?? 0);

// Nilai refund = harga × qty yang diretur, dikurangi bagian diskon transaksi secara PROPORSIONAL
// (pelanggan tidak dikembalikan lebih dari yang sebenarnya ia bayar), dibulatkan ke rupiah.
export function computeReturn(
  items: ReturnableItem[], subtotal: number, discount: number, selections: ReturnSelection[],
): { error: string } | { lines: { index: number; qty: number; gross: number }[]; refund: number } {
  if (selections.length === 0) return { error: 'Pilih minimal satu barang yang diretur.' };
  const seen = new Set<number>();
  const lines: { index: number; qty: number; gross: number }[] = [];
  for (const s of selections) {
    const item = items[s.index];
    if (!item || !Number.isInteger(s.index) || seen.has(s.index)) return { error: 'Item retur tidak valid.' };
    seen.add(s.index);
    if (!Number.isFinite(s.qty) || s.qty <= 0) return { error: 'Jumlah retur harus lebih dari 0.' };
    if (s.qty > remainingQty(item) + 1e-9) return { error: 'Jumlah retur melebihi jumlah yang dibeli (setelah retur sebelumnya).' };
    lines.push({ index: s.index, qty: s.qty, gross: item.price * s.qty });
  }
  const gross = lines.reduce((a, l) => a + l.gross, 0);
  const factor = subtotal > 0 ? Math.max(0, subtotal - discount) / subtotal : 1;
  return { lines, refund: Math.round(gross * factor) };
}
