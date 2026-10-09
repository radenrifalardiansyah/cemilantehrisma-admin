'use client';

import { createPortal } from 'react-dom';
import { Loader2, Check, X } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import NumberInput from '@/components/NumberInput';
import SearchSelect from '@/components/SearchSelect';
import { resolveScheme, calcShare, schemeText, SCHEME_LABEL, type ShareScheme } from '@/lib/consign';

export const API = '';
export const HEADER_BTN_H = 34;

export interface Stall {
  id: string; code: string; name: string; address: string; warehouseId: string; note: string; isActive: boolean;
}
export interface Consignor {
  id: string; code: string; name: string; phone: string; address: string;
  bankName: string; bankAccount: string; bankHolder: string; note: string; logoUrl: string;
  scheme: ShareScheme | null; schemeValue: number; isActive: boolean;
}
export interface CProduct {
  id: string; code: string; consignorId: string; name: string; unit: string; defaultPrice: number;
  scheme: ShareScheme | null; schemeValue: number | null; note: string; isActive: boolean;
}
export interface StallItem {
  id: string; productId: string; stallId: string; price: number | null;
  scheme: ShareScheme | null; schemeValue: number | null; stockQty: number;
}
export interface ReceiptItem { productId: string; productName: string; unit: string; qty: number }
export interface Receipt {
  id: string; docNumber: string; kind: 'in' | 'return'; consignorId: string; consignorName: string;
  stallId: string; stallName: string; docDate: string; items: ReceiptItem[]; totalQty: number; note: string; createdBy: string;
}
export interface Warehouse { id: string; name: string }
export interface MasterBank { name: string; bankCode?: string; logoUrl?: string }

export interface TitipJualData {
  stalls: Stall[]; consignors: Consignor[]; products: CProduct[]; stallItems: StallItem[]; warehouses: Warehouse[]; banks: MasterBank[];
}

export interface SectionProps {
  creds: string;
  data: TitipJualData;
  reload: () => Promise<void>;
  can: (a: 'view' | 'create' | 'edit' | 'delete') => boolean;
  goTo?: (tab: 'products' | 'consignors' | 'stalls' | 'stock' | 'receipts') => void; // pindah sub-tab
}

export const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;
export const qtyText = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 3 });

// Harga jual & skema yang berlaku untuk produk di satu lapak (lapak → produk → penitip).
export function effectiveFor(product: CProduct, consignor: Consignor | undefined, item: StallItem | undefined) {
  const price = item?.price ?? product.defaultPrice;
  const spec = resolveScheme([
    item ? { scheme: item.scheme, value: item.schemeValue } : null,
    { scheme: product.scheme, value: product.schemeValue },
    consignor ? { scheme: consignor.scheme, value: consignor.schemeValue } : null,
  ]);
  // spec/share null = skema belum bisa ditentukan (penitip "Belum ditentukan" dan produk/lapak kosong).
  return { price, spec, share: spec ? calcShare(price, spec) : null };
}

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' | 'danger' | 'ok' }) {
  const colors = {
    muted: { background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' },
    accent: { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid transparent' },
    danger: { background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid transparent' },
    ok: { background: 'rgba(5,150,105,0.1)', color: '#059669', border: '1px solid transparent' },
  }[tone];
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap" style={colors}>{children}</span>;
}

// Input skema bagi hasil. `allowInherit`: tampilkan opsi "Ikut default" (value = null).
export function SchemeFields({ scheme, value, onChange, allowInherit, inheritLabel, price }: {
  scheme: ShareScheme | null; value: number | null;
  onChange: (scheme: ShareScheme | null, value: number | null) => void;
  allowInherit?: boolean; inheritLabel?: string; price?: number;
}) {
  const share = scheme && price && price > 0 ? calcShare(price, { scheme, value: value ?? 0 }) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 2, minWidth: 0 }}>
          <SearchSelect value={scheme ?? ''} searchPlaceholder="Cari skema…"
            onChange={v => {
              // Nilai dikosongkan saat skema diganti: 15 (%) tidak sepadan dengan Rp15.
              onChange(v === '' ? null : v as ShareScheme, null);
            }}
            options={[
              ...(allowInherit ? [{ value: '', label: inheritLabel ?? 'Ikut default' }] : []),
              { value: 'nominal', label: SCHEME_LABEL.nominal },
              { value: 'commission', label: SCHEME_LABEL.commission },
            ]} />
        </div>
        {scheme === 'nominal' && (
          <NumberInput className="input" style={{ flex: 1 }} value={value ?? ''} placeholder="Rp setor"
            onChange={raw => onChange(scheme, raw === '' ? null : Number(raw))} />
        )}
        {scheme === 'commission' && (
          <input className="input" style={{ flex: 1 }} type="number" min={0} max={100} step="any" inputMode="decimal"
            value={value ?? ''} placeholder="% komisi"
            onChange={e => onChange(scheme, e.target.value === '' ? null : Number(e.target.value))} />
        )}
      </div>
      {share && scheme && (
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {schemeText({ scheme, value: value ?? 0 })} → penitip {rupiah(share.consignor)} · kita {rupiah(share.ours)} per unit
        </p>
      )}
    </div>
  );
}

export function ModalShell({ title, subtitle, icon, onClose, children, footer, size = 'modal-sm' }: {
  title: string; subtitle?: string; icon: React.ReactNode; onClose: () => void;
  children: React.ReactNode; footer: React.ReactNode; size?: string;
}) {
  // Dirender lewat portal ke <body>: area konten tab memakai animasi (transform) dan scroll sendiri,
  // yang membuat `position: fixed` menempel ke area itu — modal jadi terpotong di bawah header.
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-sheet ${size}`} onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon">{icon}</div>
            <div>
              <p className="modal-title">{title}</p>
              {subtitle && <p className="modal-subtitle">{subtitle}</p>}
            </div>
          </div>
          <Tooltip label="Tutup"><button onClick={onClose} className="modal-close"><X size={14} /></button></Tooltip>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ModalFooter({ onClose, onSave, saving, disabled, label }: {
  onClose: () => void; onSave: () => void; saving: boolean; disabled?: boolean; label: string;
}) {
  return (
    <>
      <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
      <button onClick={onSave} disabled={saving || disabled} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        {saving ? 'Menyimpan…' : label}
      </button>
    </>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
      {message}
    </p>
  );
}

export const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="field-label">{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
    {children}
  </div>
);

// Pager ringkas: "x item · halaman a dari b" + tombol sebelumnya/berikutnya.
export function usePaged<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  return { totalPages, safePage, rows: items.slice((safePage - 1) * pageSize, safePage * pageSize) };
}

// Hapus beberapa data lewat endpoint DELETE satuan; yang ditolak server (masih dipakai) dilewati
// dan dilaporkan di hasil.
export async function deleteMany(base: string, ids: string[], headers: Record<string, string>): Promise<{ deleted: number; failed: number; firstError: string }> {
  let deleted = 0, failed = 0, firstError = '';
  for (const id of ids) {
    const r = await fetch(`${API}${base}/${id}`, { method: 'DELETE', headers });
    if (r.ok) deleted++;
    else { failed++; if (!firstError) firstError = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? ''; }
  }
  return { deleted, failed, firstError };
}

// Ringkas hasil impor dari server jadi satu pesan toast.
export function reportImport(
  toast: { success: (m: string) => void; error: (m: string) => void },
  noun: string,
  d: { created: number; skippedDuplicate: number; errors: string[]; errorCount: number },
) {
  const extra = [
    d.skippedDuplicate > 0 ? `${d.skippedDuplicate} duplikat dilewati` : '',
    d.errorCount > 0 ? `${d.errorCount} baris bermasalah: ${d.errors.slice(0, 3).join('; ')}${d.errorCount > 3 ? '; …' : ''}` : '',
  ].filter(Boolean).join(' · ');
  if (d.created > 0) toast.success(`${d.created} ${noun} berhasil diimpor.${extra ? ` (${extra})` : ''}`);
  else toast.error(extra || `Tidak ada ${noun} yang diimpor.`);
}
