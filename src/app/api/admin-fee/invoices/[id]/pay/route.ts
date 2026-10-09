import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { logHistory } from '@/lib/history';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requireAdminOrSuperAdmin } from '@/lib/rbac';

async function auditInvoice(actor: Parameters<typeof logHistory>[1]['actor'], action: 'create' | 'update', id: string, label: string, before: Record<string, unknown> | null, after: Record<string, unknown>) {
  try {
    await logHistory(getDb(), { entity: 'admin-fee', entityCollection: 'invoices', entityId: id, entityLabel: label, action, actor, before, after });
  } catch (err) { console.error('Failed to write admin-fee audit log', err); }
}

// Aksi "Bayar" milik `admin` (pemilik usaha) atas invoice Biaya Admin yang sudah ditagihkan
// superadmin — pembayaran manual (transfer di luar sistem, lalu konfirmasi di sini), bukan
// payment gateway. Sengaja endpoint terpisah dari PATCH /invoices/[id] (yang bebas set status
// apapun tapi superadmin-only): endpoint ini cuma boleh transisi invoiced -> paid, jadi admin
// tidak bisa mengubah status ke draft atau mengarang ulang nominal tagihan.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { note?: string };

  const sql = getSql();
  const [row] = await sql<{ status: string; invoice_no: string }[]>`select status, invoice_no from admin_fee_invoices where id = ${id}`;
  if (!row) return Response.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
  if (row.status !== 'invoiced') {
    return Response.json({ error: 'Invoice ini belum ditagihkan atau sudah dibayar.' }, { status: 400 });
  }

  await sql`
    update admin_fee_invoices set
      status = 'paid', paid_at = now(), paid_by = ${guard.username},
      payment_note = ${body.note?.trim() || null}, updated_at = now()
    where id = ${id}
  `;

  await auditInvoice(guard, 'update', id, `Invoice Biaya Admin ${row.invoice_no}`, { status: 'invoiced' }, { status: 'paid', note: body.note?.trim() || null });
  revalidateTag('admin-fee-invoices', { expire: 0 });
  return Response.json({ ok: true });
}
