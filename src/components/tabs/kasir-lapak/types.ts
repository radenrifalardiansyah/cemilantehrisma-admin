export interface Ts { seconds: number }

export interface Shift {
  id: string; stallId: string; openedBy: string; openingBalance: number; openedAt: Ts | null; status: string;
  cashSalesTotal?: number; expectedBalance?: number; actualBalance?: number; difference?: number;
}
export interface PosStall {
  id: string; code: string; name: string; address: string; warehouseId: string; invoicePrefix: string; shift: Shift | null;
}
export interface CatalogItem {
  kind: 'own' | 'consign'; productId: string; name: string; code: string; unit: string; price: number; stock: number;
  consignorName?: string; blocked?: string; emoji?: string; imageUrl?: string;
}
export interface SaleItem {
  kind: 'own' | 'consign'; productId: string; name: string; unit: string; qty: number; price: number; subtotal: number;
}
export type PaymentMethod = 'cash' | 'qris' | 'transfer';
export interface Sale {
  id: string; invoiceNo: string; stallId: string; stallName: string; shiftId: string; date: string; cashier: string;
  items: SaleItem[]; subtotal: number; discount: number; total: number; paymentMethod: PaymentMethod;
  amountPaid: number; changeAmount: number; note: string; status: 'paid' | 'void'; voidReason: string; createdAt: Ts | null;
}
export const PAY_LABEL: Record<PaymentMethod, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' };
export const itemKey = (kind: string, productId: string) => `${kind}:${productId}`;
