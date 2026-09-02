import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToHeld, type PosHeldRow } from '@/lib/pos-held-pg';

// Transaksi tertahan (Hold/Pending) di Kasir — disimpan di Postgres (bukan localStorage)
// supaya bisa dilanjutkan dari perangkat manapun, bukan cuma perangkat yang menahannya.

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'pos', 'view');
  if (user instanceof Response) return user;
  const sql = getSql();
  const rows = await sql<PosHeldRow[]>`select * from pos_held_transactions order by created_at asc`;
  return Response.json({ held: rows.map(rowToHeld) });
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'pos', 'create');
  if (user instanceof Response) return user;
  const body = await req.json() as Record<string, unknown>;

  const id = randomUUID();
  const data = {
    label: String(body.label ?? ''),
    cart: JSON.stringify(Array.isArray(body.cart) ? body.cart : []),
    customItems: JSON.stringify(Array.isArray(body.customItems) ? body.customItems : []),
    custName: String(body.custName ?? ''),
    custPhone: String(body.custPhone ?? ''),
    discountType: body.discountType === 'nominal' ? 'nominal' : 'percent',
    discountRaw: String(body.discountRaw ?? ''),
    paymentMethod: String(body.paymentMethod ?? 'cash'),
    amountPaidRaw: String(body.amountPaidRaw ?? ''),
    transferBank: String(body.transferBank ?? ''),
    transferAmountRaw: String(body.transferAmountRaw ?? ''),
    transferProofUrl: String(body.transferProofUrl ?? ''),
    selectedCustRef: String(body.selectedCustRef ?? ''),
    createdAt: Number(body.createdAt) || Date.now(),
    createdBy: user.username,
  };

  const sql = getSql();
  const [row] = await sql<PosHeldRow[]>`
    insert into pos_held_transactions (
      id, label, cart, custom_items, cust_name, cust_phone, discount_type, discount_raw,
      payment_method, amount_paid_raw, transfer_bank, transfer_amount_raw, transfer_proof_url,
      selected_cust_ref, created_at, created_by
    ) values (
      ${id}, ${data.label}, ${data.cart}, ${data.customItems}, ${data.custName}, ${data.custPhone},
      ${data.discountType}, ${data.discountRaw}, ${data.paymentMethod}, ${data.amountPaidRaw},
      ${data.transferBank}, ${data.transferAmountRaw}, ${data.transferProofUrl}, ${data.selectedCustRef},
      ${data.createdAt}, ${data.createdBy}
    )
    returning *
  `;
  return Response.json({ held: rowToHeld(row) });
}
