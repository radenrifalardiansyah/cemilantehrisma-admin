import type { ShoppingListPDFData } from '@/lib/pdf/ShoppingListPDF';

// Model + pembentuk data PDF Daftar Belanja. MURNI (tanpa DB/HTTP/node:crypto/react-pdf) — dipakai bersama oleh panel
// (klien, PDF unduhan) dan rute publik /b/[code] (server), supaya kedua PDF berasal dari satu sumber.

export interface ShoppingItem {
  id: string; materialId: string; materialName: string; unit: string;
  qty: number; price: number | null; note: string;
  shoppingDate: string; supplierId?: string; supplierName: string;
  checked: boolean; status: 'pending' | 'done'; purchaseId?: string; doneAt?: string;
  walletId?: string; paymentStatus?: 'lunas' | 'belum_lunas'; createdBy?: string;
}

// Satu daftar belanja = kumpulan item dengan tanggal + supplier yang sama (otomatis tergabung).
export interface ShoppingGroup {
  key: string; date: string; supplierId?: string; supplierName: string;
  items: ShoppingItem[]; pending: ShoppingItem[]; checked: ShoppingItem[];
  total: number; notes: string[]; walletIds: string[]; unpaid: boolean; imported: boolean; status: 'menunggu' | 'belanja' | 'sebagian' | 'selesai';
}

export const SHOPPING_STATUS_LABEL: Record<ShoppingGroup['status'], string> = {
  menunggu: 'Menunggu', belanja: 'Sedang belanja', sebagian: 'Sebagian', selesai: 'Selesai',
};

export const NO_SUPPLIER = 'Tanpa supplier';

// Kunci pengelompokan supplier: id terdaftar, atau nama (huruf kecil, tanpa spasi pinggir) untuk toko/warung lain.
export const supplierKeyOf = (i: { supplierId?: string; supplierName: string }) =>
  i.supplierId ? `id:${i.supplierId}` : `n:${i.supplierName.trim().toLowerCase()}`;

export function buildGroups(items: ShoppingItem[]): ShoppingGroup[] {
  const map = new Map<string, ShoppingItem[]>();
  items.forEach(i => {
    const key = `${i.shoppingDate}|${supplierKeyOf(i)}`;
    map.set(key, [...(map.get(key) ?? []), i]);
  });
  return [...map.entries()].map(([key, list]) => {
    const pending = list.filter(i => i.status === 'pending');
    const done = list.filter(i => i.status === 'done');
    const checked = pending.filter(i => i.checked);
    const status: ShoppingGroup['status'] = pending.length === 0 ? 'selesai' : done.length > 0 ? 'sebagian' : checked.length > 0 ? 'belanja' : 'menunggu';
    return {
      key, date: list[0].shoppingDate, supplierId: list[0].supplierId, supplierName: list[0].supplierName,
      items: list, pending, checked,
      total: list.reduce((s, i) => s + i.qty * (i.price ?? 0), 0),
      notes: [...new Set(list.map(i => i.note.trim()).filter(Boolean))],
      walletIds: [...new Set(done.map(i => i.walletId).filter((w): w is string => !!w))],
      unpaid: done.some(i => i.paymentStatus === 'belum_lunas'),
      imported: list.some(i => i.createdBy === 'import-pembelian'),
      status,
    };
  });
}

export const formatQty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

export const formatDateLong = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Label waktu pembuatan PDF. `timeZone` diisi di server (zona proses server = UTC), klien memakai zona perangkat. */
export const shoppingPdfGeneratedAt = (d = new Date(), timeZone?: string) =>
  d.toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });

/** Data PDF satu tanggal: per supplier ada tabel item + subtotal, ditutup total tanggal. */
export function buildShoppingPdfData(
  date: string, gs: ShoppingGroup[],
  ctx: { no: number; walletNames: Record<string, string>; generatedAt: string },
): ShoppingListPDFData {
  const supplierLabel = (g: { supplierName: string }) => g.supplierName.trim() || NO_SUPPLIER;
  const walletLabel = (g: ShoppingGroup) => g.walletIds.map(id => ctx.walletNames[id] ?? 'Dompet dihapus').join(', ') || '-';
  return {
    no: ctx.no,
    dateLabel: formatDateLong(date),
    generatedAt: ctx.generatedAt,
    itemCount: gs.reduce((t, g) => t + g.items.length, 0), grandTotal: gs.reduce((t, g) => t + g.total, 0),
    suppliers: gs.slice().sort((a, b) => (a.supplierName || '￿').localeCompare(b.supplierName || '￿')).map(g => ({
      name: supplierLabel(g), notes: g.notes.join(' · '), wallet: walletLabel(g),
      status: SHOPPING_STATUS_LABEL[g.status] + (g.unpaid ? ' (belum lunas)' : ''),
      total: g.total,
      items: g.items.map((i, idx) => ({
        no: idx + 1, name: i.materialName, qty: formatQty(i.qty), unit: i.unit,
        price: i.price, subtotal: i.qty * (i.price ?? 0), bought: i.status === 'done',
      })),
    })),
  };
}
