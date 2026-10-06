import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { invalidQtyMessage } from '@/lib/validate-items';

// Menyimpan salinan invoice Kasir ke tabel `invoices` (dibaca storefront untuk PDF publik
// /api/invoice/<no>?t=<token>). Dulu Kasir memanggil endpoint publik tanpa autentikasi di
// storefront; sekarang ditulis dari sini (butuh izin Kasir) dengan nomor yang dijamin unik dan
// token acak di link. Basis data `invoices` dipakai bersama kedua aplikasi.
const STOREFRONT = (process.env.NEXT_PUBLIC_API_URL ?? 'https://cemilantehrisma.vercel.app').replace(/\/$/, '');

interface InvoiceBody {
  invoiceNo?: string; date?: string; customerName?: string; customerPhone?: string;
  items?: unknown; subtotal?: number; discount?: { amount: number; label: string } | null; total?: number;
  paymentStatus?: 'lunas' | 'belum_lunas';
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, ['pos', 'orders'], 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as InvoiceBody;
  const base = (data.invoiceNo ?? '').toString().trim().slice(0, 60);
  if (!base || !Array.isArray(data.items) || data.items.length === 0) {
    return Response.json({ error: 'Data invoice tidak lengkap.' }, { status: 400 });
  }
  const qtyError = invalidQtyMessage(data.items);
  if (qtyError) return Response.json({ error: qtyError }, { status: 400 });

  const sql = getSql();
  const token = randomBytes(16).toString('hex');
  // Nomor invoice Kasir hanya beresolusi menit — dua transaksi di menit yang sama akan bentrok.
  // Cari nomor yang belum dipakai di `invoices` maupun `orders` (sufiks -2, -3, …).
  let invoiceNo = base;
  for (let n = 2; n <= 30; n++) {
    const [taken] = await sql`select 1 from invoices where invoice_no = ${invoiceNo} union all select 1 from orders where invoice_no = ${invoiceNo} limit 1`;
    if (!taken) break;
    invoiceNo = `${base}-${n}`;
  }
  const rows = await sql<{ token: string }[]>`
    insert into invoices (invoice_no, date, customer_name, customer_phone, items, subtotal, discount, total, source, payment_status, token, created_at)
    values (
      ${invoiceNo}, ${data.date ?? ''}, ${data.customerName ?? ''}, ${data.customerPhone ?? ''},
      ${JSON.stringify(data.items)}, ${Number(data.subtotal) || 0}, ${data.discount ? JSON.stringify(data.discount) : null}, ${Number(data.total) || 0},
      'kasir', ${data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas'}, ${token}, now()
    )
    on conflict (invoice_no) do nothing
    returning token
  `;
  if (!rows[0]) return Response.json({ error: 'Gagal membuat nomor invoice unik, coba lagi.' }, { status: 409 });
  return Response.json({ invoiceNo, url: `${STOREFRONT}/api/invoice/${encodeURIComponent(invoiceNo)}?t=${token}` });
}
