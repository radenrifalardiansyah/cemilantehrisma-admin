import type postgres from 'postgres';
import { computeVoucherDiscount, type VoucherRule } from '@/lib/voucher';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgClient = postgres.ISql<{}>;

export interface VoucherRow {
  code: string; description: string | null; type: 'percent' | 'nominal'; value: string;
  min_purchase: string; max_discount: string; valid_from: string | null; valid_until: string | null;
  usage_limit: number; used_count: number; per_customer_limit?: number; is_active: boolean; created_at: Date; updated_at: Date | null;
}

export function rowToVoucher(r: VoucherRow) {
  return {
    code: r.code,
    description: r.description ?? '',
    type: r.type,
    value: Number(r.value),
    minPurchase: Number(r.min_purchase),
    maxDiscount: Number(r.max_discount),
    validFrom: r.valid_from ?? '',
    validUntil: r.valid_until ?? '',
    usageLimit: r.usage_limit,
    perCustomerLimit: r.per_customer_limit ?? 0,
    usedCount: r.used_count,
    isActive: r.is_active,
  };
}

export function voucherRule(r: VoucherRow): VoucherRule {
  return { type: r.type, value: Number(r.value), minPurchase: Number(r.min_purchase), maxDiscount: Number(r.max_discount) };
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Mengembalikan pesan error (siap tampil) atau null kalau voucher boleh dipakai untuk subtotal ini.
// Ada identitas yang bisa dipakai untuk mencocokkan pelanggan? (id akun, atau nomor HP minimal 9 digit)
export function hasVoucherIdentity(who: { customerId?: string | null; phone?: string | null }): boolean {
  return !!who.customerId || String(who.phone ?? '').replace(/\D/g, '').length >= 9;
}

// Berapa kali pelanggan ini sudah memakai voucher `code` (pesanan yang dibatalkan/dihapus melepas kodenya,
// jadi tidak ikut terhitung). Identitas = id akun pelanggan, ATAU nomor HP (9 digit terakhir, supaya
// "0812…", "62812…" dan "+62812…" dianggap sama). Tanpa identitas sama sekali (mis. "Pelanggan Umum"
// di Kasir) mengembalikan 0 — voucher berbatas per pelanggan ditolak untuk kasus itu (lihat voucherProblem).
export async function customerVoucherUses(
  sql: PgClient,
  code: string,
  who: { customerId?: string | null; phone?: string | null },
): Promise<number> {
  const digits = String(who.phone ?? '').replace(/\D/g, '');
  const last9 = digits.length >= 9 ? digits.slice(-9) : '';
  const id = who.customerId ?? '';
  if (!id && !last9) return 0;
  const rows = await sql<{ n: string }[]>`
    select count(*) as n from orders
    where voucher_code = ${code}
      and (
        (${id} <> '' and customer_id = ${id})
        or (${last9} <> '' and right(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), 9) = ${last9})
      )
  `;
  return Number(rows[0]?.n) || 0;
}

// `customerUses`: hasil customerVoucherUses untuk pelanggan yang sedang memakai voucher ini.
// `identified`: hasil hasVoucherIdentity — voucher berbatas per pelanggan TIDAK bisa dipakai tanpa identitas.
export function voucherProblem(r: VoucherRow | undefined, subtotal: number, now = new Date(), customerUses = 0, identified = true): string | null {
  if (!r) return 'Kode voucher tidak ditemukan.';
  if (!r.is_active) return 'Voucher ini sudah tidak aktif.';
  const today = new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
  if (r.valid_from && today < r.valid_from) return 'Voucher ini belum berlaku.';
  if (r.valid_until && today > r.valid_until) return 'Voucher ini sudah kedaluwarsa.';
  if (r.usage_limit > 0 && r.used_count >= r.usage_limit) return 'Kuota voucher ini sudah habis.';
  const perCustomer = r.per_customer_limit ?? 0;
  if (perCustomer > 0 && !identified) {
    return 'Voucher ini hanya untuk pelanggan dengan nomor HP — isi nomor HP pelanggan dulu.';
  }
  if (perCustomer > 0 && customerUses >= perCustomer) {
    return perCustomer === 1 ? 'Voucher ini hanya bisa dipakai 1× per pelanggan dan sudah pernah Anda pakai.' : `Voucher ini maksimal ${perCustomer}× per pelanggan dan batasnya sudah tercapai.`;
  }
  const min = Number(r.min_purchase);
  if (min > 0 && subtotal < min) return `Minimal belanja Rp${min.toLocaleString('id-ID')} untuk memakai voucher ini.`;
  if (computeVoucherDiscount(voucherRule(r), subtotal) <= 0) return 'Voucher tidak memberi potongan untuk belanja ini.';
  return null;
}
