import { randomUUID } from 'crypto';
import type { TransactionSql } from 'postgres';
import { parseSchemeInput } from '@/lib/consign-pg';
import { validateScheme } from '@/lib/consign';

export interface ProductInput {
  consignorId: string; name: string; unit: string; defaultPrice: number;
  scheme: 'nominal' | 'commission' | null; schemeValue: number | null;
  note: string; isActive: boolean;
  stallItems: { stallId: string; price: number | null; scheme: 'nominal' | 'commission' | null; schemeValue: number | null }[];
}

// Validasi body produk (dipakai POST dan PUT). Mengembalikan input bersih atau pesan error.
export function parseProductBody(data: Record<string, unknown>): { value: ProductInput } | { error: string } {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) return { error: 'Nama produk wajib diisi.' };
  const consignorId = typeof data.consignorId === 'string' ? data.consignorId : '';
  if (!consignorId) return { error: 'Penitip wajib dipilih.' };
  const defaultPrice = Number(data.defaultPrice);
  if (!Number.isFinite(defaultPrice) || defaultPrice < 0) return { error: 'Harga jual default tidak valid.' };

  const scheme = parseSchemeInput(data.scheme, data.schemeValue);
  if ('error' in scheme) return { error: scheme.error };
  if (scheme.scheme) {
    const e = validateScheme(scheme.scheme, scheme.value ?? 0, defaultPrice);
    if (e) return { error: e };
  }

  const rawStalls = Array.isArray(data.stallItems) ? data.stallItems as Record<string, unknown>[] : [];
  const seen = new Set<string>();
  const stallItems: ProductInput['stallItems'] = [];
  for (const s of rawStalls) {
    const stallId = typeof s.stallId === 'string' ? s.stallId : '';
    if (!stallId || seen.has(stallId)) return { error: 'Data lapak pada produk tidak valid.' };
    seen.add(stallId);
    let price: number | null = null;
    if (s.price !== null && s.price !== undefined && s.price !== '') {
      price = Number(s.price);
      if (!Number.isFinite(price) || price < 0) return { error: 'Harga jual di lapak tidak valid.' };
    }
    const ss = parseSchemeInput(s.scheme, s.schemeValue);
    if ('error' in ss) return { error: ss.error };
    if (ss.scheme) {
      const e = validateScheme(ss.scheme, ss.value ?? 0, price ?? defaultPrice);
      if (e) return { error: e };
    }
    stallItems.push({ stallId, price, scheme: ss.scheme, schemeValue: ss.value });
  }
  return {
    value: {
      consignorId, name, unit: (typeof data.unit === 'string' && data.unit.trim()) || 'pcs', defaultPrice,
      scheme: scheme.scheme, schemeValue: scheme.value, note: (data.note as string) ?? '',
      isActive: data.isActive !== false, stallItems,
    },
  };
}

// Simpan konfigurasi harga/skema per lapak: upsert yang dikirim, hapus lapak yang tidak dikirim
// HANYA kalau stoknya 0 (stok yang masih ada tidak boleh hilang diam-diam).
export async function syncStallItems(tx: TransactionSql, productId: string, items: ProductInput['stallItems']): Promise<string | null> {
  const stallIds = items.map(i => i.stallId);
  if (stallIds.length > 0) {
    const found = await tx<{ id: string }[]>`select id from stalls where id in ${tx(stallIds)}`;
    if (found.length !== new Set(stallIds).size) return 'Ada lapak yang tidak ditemukan.';
  }
  for (const i of items) {
    await tx`
      insert into consign_stall_items (id, product_id, stall_id, price, scheme, scheme_value, stock_qty, created_at, updated_at)
      values (${randomUUID()}, ${productId}, ${i.stallId}, ${i.price}, ${i.scheme}, ${i.schemeValue}, 0, now(), now())
      on conflict (product_id, stall_id) do update
        set price = excluded.price, scheme = excluded.scheme, scheme_value = excluded.scheme_value, updated_at = now()
    `;
  }
  const keep = stallIds.length > 0 ? tx`and stall_id not in ${tx(stallIds)}` : tx``;
  await tx`delete from consign_stall_items where product_id = ${productId} and stock_qty = 0 ${keep}`;
  return null;
}
