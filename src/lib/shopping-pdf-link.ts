import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { supplierKeyOf } from '@/lib/shopping-pdf-data';

// Tautan PDF publik Daftar Belanja untuk pesan WA: /b/<kode>. Server-only (memakai JWT_SECRET).
// Daftar belanja tidak punya id: identitasnya (tanggal, supplier) ada DI DALAM kode dan ditandatangani.
//   kode = base64url(muatan) + base64url(12 byte pertama HMAC-SHA256(JWT_SECRET, 'shopping-pdf:' + muatan))
//   muatan = 3 byte tanggal (hari sejak 2000-01-01, big-endian)            -> gabungan semua supplier (kode 20 karakter)
//          | 3 byte tanggal + 8 byte SHA-256(supplierKeyOf) pertama        -> satu supplier (kode 31 karakter)
// supplierKeyOf sama dengan pengelompokan di panel (id terdaftar, atau nama huruf kecil tanpa spasi pinggir).
// Prefiks 'shopping-pdf:' memisahkan domain dari 'closing-pdf:'. Tanpa JWT_SECRET: gagal tertutup.

const SIG_BYTES = 12;
const SIG_CHARS = Math.ceil((SIG_BYTES * 4) / 3); // 16
const DAY_CHARS = 4;   // 3 byte
const SUP_CHARS = 15;  // 11 byte
const EPOCH = Date.UTC(2000, 0, 1);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SHOPPING_PDF_TAG = 'shopping-pdf';
export const shoppingPdfTag = (date: string) => `shopping-pdf:${date}`;
/** Daftar belanja berubah (tambah/ubah/hapus/proses): buang cache PDF server. Hanya dari Route Handler / Server Function. */
export const revalidateShoppingPdf = () => revalidateTag(SHOPPING_PDF_TAG, { expire: 0 });

export interface ShoppingPdfTarget {
  date: string;
  /** 8 byte hash kunci supplier; null = gabungan semua supplier pada tanggal itu. */
  supplierHash: Buffer | null;
}

export const supplierHashOf = (s: { supplierId?: string; supplierName: string }): Buffer =>
  createHash('sha256').update(supplierKeyOf(s)).digest().subarray(0, 8);

const sigOf = (payload: Buffer): Buffer | null => {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update('shopping-pdf:').update(payload).digest().subarray(0, SIG_BYTES);
};

function dateToBytes(date: string): Buffer | null {
  if (!DATE_RE.test(date)) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  const days = Math.round((t - EPOCH) / 86_400_000);
  if (!Number.isFinite(days) || days < 0 || days > 0xffffff) return null;
  if (new Date(t).toISOString().slice(0, 10) !== date) return null; // tolak 2026-02-31
  return Buffer.from([(days >> 16) & 255, (days >> 8) & 255, days & 255]);
}

function bytesToDate(b: Buffer): string {
  const days = (b[0] << 16) | (b[1] << 8) | b[2];
  return new Date(EPOCH + days * 86_400_000).toISOString().slice(0, 10);
}

/** Kode ringkas, atau null bila tanggal tidak valid / JWT_SECRET kosong. */
export function signShoppingShortCode(t: ShoppingPdfTarget): string | null {
  const d = dateToBytes(t.date);
  if (!d) return null;
  if (t.supplierHash && t.supplierHash.length !== 8) return null;
  const payload = t.supplierHash ? Buffer.concat([d, t.supplierHash]) : d;
  const sig = sigOf(payload);
  if (!sig) return null;
  return payload.toString('base64url') + sig.toString('base64url');
}

/** Verifikasi kode; null bila bentuk/tanda tangan salah atau JWT_SECRET kosong. */
export function parseShoppingShortCode(code: string | null | undefined): ShoppingPdfTarget | null {
  if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  let payloadChars: number;
  if (code.length === DAY_CHARS + SIG_CHARS) payloadChars = DAY_CHARS;
  else if (code.length === SUP_CHARS + SIG_CHARS) payloadChars = SUP_CHARS;
  else return null;
  const payload = Buffer.from(code.slice(0, payloadChars), 'base64url');
  const sig = sigOf(payload);
  if (!sig) return null;
  const a = Buffer.from(code.slice(payloadChars));
  const b = Buffer.from(sig.toString('base64url'));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { date: bytesToDate(payload), supplierHash: payload.length === 11 ? payload.subarray(3) : null };
}

/** Tautan untuk pesan WA, atau null bila tidak bisa ditandatangani. */
export function buildShoppingPdfUrl(origin: string, t: ShoppingPdfTarget): string | null {
  const code = signShoppingShortCode(t);
  return code ? `${origin}/b/${code}` : null;
}
