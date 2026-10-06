// Hitung dampak retur per item pada sebuah pesanan — satu rumus untuk server (sumber kebenaran)
// dan pratinjau di layar Pesanan, supaya nilai yang terlihat sama dengan yang tercatat.
// Diskon dikurangi proporsional terhadap subtotal baru, jadi pelanggan tidak mendapat diskon
// penuh atas barang yang tinggal sebagian. Nilai retur = total lama − total baru.

export interface ReturnItem { price: number; qty: number }
export interface ReturnOutcome {
  newSubtotal: number;
  newDiscountAmount: number;
  newTotal: number;
  refund: number;
  remainingQty: number;
  returnedQty: number;
}

export function computeReturn(
  items: ReturnItem[],
  discountAmount: number,
  oldTotal: number,
  returnQtyByIndex: (index: number) => number,
): ReturnOutcome {
  const oldSubtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const newSubtotal = items.reduce((s, it, i) => s + it.price * (it.qty - returnQtyByIndex(i)), 0);
  const newDiscountAmount = oldSubtotal > 0 ? Math.round(discountAmount * (newSubtotal / oldSubtotal)) : 0;
  const newTotal = Math.max(0, newSubtotal - newDiscountAmount);
  return {
    newSubtotal,
    newDiscountAmount,
    newTotal,
    refund: Math.max(0, oldTotal - newTotal),
    remainingQty: items.reduce((s, it, i) => s + it.qty - returnQtyByIndex(i), 0),
    returnedQty: items.reduce((s, _it, i) => s + returnQtyByIndex(i), 0),
  };
}
