import { parseJsonb } from '@/lib/db';

// Versi Postgres dari koleksi Firestore `posHeldTransactions`.

export interface PosHeldRow {
  id: string; label: string; cart: unknown; custom_items: unknown;
  cust_name: string; cust_phone: string; discount_type: string; discount_raw: string;
  payment_method: string; amount_paid_raw: string; transfer_bank: string;
  transfer_amount_raw: string; transfer_proof_url: string; selected_cust_ref: string;
  created_at: number; created_by: string;
}

export function rowToHeld(r: PosHeldRow) {
  return {
    id: r.id, label: r.label,
    cart: parseJsonb(r.cart) ?? [], customItems: parseJsonb(r.custom_items) ?? [],
    custName: r.cust_name, custPhone: r.cust_phone,
    discountType: r.discount_type, discountRaw: r.discount_raw,
    paymentMethod: r.payment_method, amountPaidRaw: r.amount_paid_raw,
    transferBank: r.transfer_bank, transferAmountRaw: r.transfer_amount_raw,
    transferProofUrl: r.transfer_proof_url, selectedCustRef: r.selected_cust_ref,
    createdAt: Number(r.created_at), createdBy: r.created_by,
  };
}
