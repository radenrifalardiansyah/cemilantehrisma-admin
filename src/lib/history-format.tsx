'use client';

// Format/tampilan bersama untuk data audit_log — dipakai oleh halaman Riwayat terpusat
// (HistoryTab.tsx) dan tombol "Riwayat" per baris di masing-masing menu transaksi (RecordHistory.tsx).
import type { ReactNode } from 'react';
import {
  PlusCircle, Pencil, Trash2,
  ShoppingCart, Factory, Truck, Boxes, Store, Warehouse, Landmark, Coins, Banknote,
} from 'lucide-react';

export type AuditAction = 'create' | 'update' | 'delete';

export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  entityLabel: string;
  action: AuditAction;
  actorUsername: string;
  actorRole: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[] | null;
  meta?: Record<string, unknown>;
  createdAt?: { seconds?: number; _seconds?: number };
}

export function entrySeconds(entry: Pick<AuditEntry, 'createdAt'>) {
  return entry.createdAt?.seconds ?? entry.createdAt?._seconds ?? 0;
}

export function formatDateTime(entry: Pick<AuditEntry, 'createdAt'>) {
  const seconds = entrySeconds(entry);
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Badge kecil "Dibuat/Diubah/Dihapus" — mengikuti jenis aksi (CRUD), terpisah dari ikon avatar.
export const ACTION_META: Record<AuditAction, { label: string; badge: string; icon: ReactNode }> = {
  create: { label: 'Dibuat',  badge: 'badge-green', icon: <PlusCircle size={16} /> },
  update: { label: 'Diubah',  badge: 'badge-blue',  icon: <Pencil size={16} /> },
  delete: { label: 'Dihapus', badge: 'badge-red',   icon: <Trash2 size={16} /> },
};

// Ikon avatar merepresentasikan JENIS transaksinya (modul), sedangkan warnanya merepresentasikan
// arah aliran uang/stok: hijau = masuk, merah = keluar, biru = netral (mis. transfer/penyesuaian
// internal yang bukan aliran kas langsung, atau data master).
export type Direction = 'in' | 'out' | 'neutral';
export const DIRECTION_COLOR: Record<Direction, { color: string; bg: string }> = {
  in:      { color: '#15803D', bg: '#F0FDF4' },
  out:     { color: '#DC2626', bg: '#FEF2F2' },
  neutral: { color: '#0369A1', bg: '#EFF6FF' },
};

const ENTITY_META: Record<string, { icon: ReactNode; direction: Direction }> = {
  orders:               { icon: <ShoppingCart size={16} />, direction: 'in' },
  pos:                  { icon: <ShoppingCart size={16} />, direction: 'in' },
  income:               { icon: <Coins size={16} />,        direction: 'in' },
  expenses:             { icon: <Banknote size={16} />,     direction: 'out' },
  'material-purchases': { icon: <Truck size={16} />,        direction: 'out' },
  production:           { icon: <Factory size={16} />,      direction: 'neutral' },
  materials:            { icon: <Boxes size={16} />,        direction: 'neutral' },
  consignment:          { icon: <Store size={16} />,        direction: 'neutral' },
  stock:                { icon: <Warehouse size={16} />,    direction: 'neutral' },
  warehouses:           { icon: <Warehouse size={16} />,    direction: 'neutral' },
  capital:              { icon: <Landmark size={16} />,     direction: 'neutral' }, // arah ditentukan per-entri (modal vs prive), lihat directionFor()
};

// Modal & Prive sama-sama entity 'capital' tapi arahnya berlawanan — modal = uang masuk,
// prive = uang ditarik keluar — jadi harus dibaca dari field `type` datanya, bukan dari entity saja.
export function directionFor(entry: AuditEntry): Direction {
  if (entry.entity === 'capital') {
    const type = (entry.after ?? entry.before)?.type;
    return type === 'prive' ? 'out' : 'in';
  }
  return ENTITY_META[entry.entity]?.direction ?? 'neutral';
}

export function avatarIconFor(entry: AuditEntry): ReactNode {
  return ENTITY_META[entry.entity]?.icon ?? ACTION_META[entry.action].icon;
}

export const rp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const MONEY_KEY_RE = /amount|total|cost|harga|revenue|balance|subtotal|omzet|modal/i;

// Field teknis (foreign-key id) yang sudah terwakili oleh field `...Name` pasangannya — disembunyikan
// dari tampilan supaya tidak membingungkan (mis. locationId disembunyikan kalau locationName ada).
function visibleEntries(data: Record<string, unknown>): [string, unknown][] {
  return Object.entries(data).filter(([k]) => {
    if (/Id$/.test(k) && k !== 'productId') {
      const nameKey = k.replace(/Id$/, 'Name');
      if (Object.prototype.hasOwnProperty.call(data, nameKey)) return false;
    }
    return true;
  });
}

const FIELD_LABELS: Record<string, string> = {
  invoiceNo: 'No. Invoice', locationName: 'Lokasi', warehouseName: 'Gudang', supplierName: 'Supplier',
  items: 'Barang', note: 'Catatan', total: 'Total', totalSold: 'Total Terjual', totalRetur: 'Total Retur',
  totalReject: 'Total Reject', totalRevenue: 'Total Pendapatan', amount: 'Jumlah', date: 'Tanggal',
  description: 'Keterangan', category: 'Kategori', paymentStatus: 'Status Pembayaran', status: 'Status',
  createdAt: 'Dibuat Pada', updatedAt: 'Diperbarui Pada', openedBy: 'Dibuka oleh', openingBalance: 'Modal Awal',
  closingBalance: 'Modal Akhir', name: 'Nama', type: 'Jenis', qty: 'Qty', minStock: 'Stok Minimum',
  stockQty: 'Stok', avgCost: 'Rata-rata Biaya', unit: 'Satuan', code: 'Kode', address: 'Alamat',
  contactName: 'Kontak', contactPhone: 'No. Telepon', outputs: 'Hasil Produksi', materialsUsed: 'Bahan Terpakai',
  materialCost: 'Biaya Bahan', otherCost: 'Biaya Lain', totalCost: 'Total Biaya', totalYieldQty: 'Total Hasil',
  costPerPcs: 'Biaya per Pcs', customerName: 'Pelanggan', paymentMethod: 'Metode Bayar', source: 'Sumber',
};

function fieldLabel(k: string): string {
  return FIELD_LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}

function summarizeItem(item: unknown): string {
  if (typeof item !== 'object' || item === null) return String(item);
  const o = item as Record<string, unknown>;
  const name = (o.productName ?? o.description ?? o.name) as string | undefined;
  const qty = o.qty ?? o.qtySold;
  const price = o.hargaTitip ?? o.price ?? o.amount;
  const subtotal = o.subtotal;
  if (name) {
    let s = String(name);
    if (typeof qty === 'number') s += ` ×${qty}`;
    if (typeof price === 'number') s += ` @${rp(price)}`;
    if (typeof subtotal === 'number') s += ` = ${rp(subtotal)}`;
    return s;
  }
  return JSON.stringify(item);
}

function formatValue(key: string, v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'number') return MONEY_KEY_RE.test(key) ? rp(v) : String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '–';
    if (typeof v[0] === 'object' && v[0] !== null) {
      return (
        <div className="flex flex-col items-end gap-1">
          {v.map((item, i) => <span key={i}>{summarizeItem(item)}</span>)}
        </div>
      );
    }
    return v.join(', ');
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if ('seconds' in obj || '_seconds' in obj) {
      const seconds = (obj.seconds ?? obj._seconds) as number | undefined;
      if (seconds) return new Date(seconds * 1000).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    }
    return JSON.stringify(v);
  }
  return String(v);
}

export function SnapshotBlock({ title, data, highlight }: { title: string; data: Record<string, unknown> | null; highlight?: string[] | null }) {
  if (!data) return null;
  const entries = visibleEntries(data);
  return (
    <div className="card p-3" style={{ borderColor: 'var(--border-2)' }}>
      <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>{title}</p>
      <div className="flex flex-col gap-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-3 text-xs" style={{ borderBottom: '1px solid var(--border-2)', paddingBottom: 4 }}>
            <span className="font-semibold flex-shrink-0" style={{ color: highlight?.includes(k) ? 'var(--accent)' : 'var(--text-muted)' }}>{fieldLabel(k)}</span>
            <span className="text-right break-all" style={{ color: 'var(--text-primary)' }}>{formatValue(k, v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Konten collapse satu entri riwayat — dipakai baik di halaman Riwayat terpusat maupun panel
// riwayat per-record, dirender inline (bukan modal) supaya isi lengkapnya bisa dilihat di tempat.
export function HistoryEntryDetail({ entry }: { entry: AuditEntry }) {
  const hasContent = !!entry.before || !!entry.after || (entry.meta && Object.keys(entry.meta).length > 0);
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      {entry.meta && Object.keys(entry.meta).length > 0 && (
        <SnapshotBlock title="Info Tambahan" data={entry.meta} />
      )}
      {entry.action === 'delete' ? (
        <SnapshotBlock title="Data yang Dihapus" data={entry.before} />
      ) : entry.action === 'create' ? (
        <SnapshotBlock title="Data yang Dibuat" data={entry.after} />
      ) : (
        <>
          <SnapshotBlock title="Sebelum" data={entry.before} highlight={entry.changedFields} />
          <SnapshotBlock title="Sesudah" data={entry.after} highlight={entry.changedFields} />
        </>
      )}
      {!hasContent && (
        <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>Tidak ada detail tambahan untuk entri ini.</p>
      )}
    </div>
  );
}
