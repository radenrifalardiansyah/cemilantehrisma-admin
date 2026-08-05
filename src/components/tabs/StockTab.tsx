'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import ExcelJS from 'exceljs';
import {
  Loader2, RefreshCw, Plus, TrendingUp, TrendingDown, Warehouse,
  X, ArrowLeft, Pencil, Trash2, MapPin, ChevronRight, ChevronLeft, Package,
  ArrowLeftRight, Clock, ImageIcon, Ban, Search, FileBarChart, FileSpreadsheet,
  AlertTriangle, Wallet, Boxes,
} from 'lucide-react';
import { useViewMode, type ViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import ScrollChips from '@/components/ScrollChips';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import SearchSelect, { type SearchSelectOption } from '@/components/SearchSelect';
import ImageCarousel from '@/components/ImageCarousel';
import TopbarPortal from '@/components/TopbarPortal';
import PageSizeSelect from '@/components/PageSizeSelect';

const API = '';
const HEADER_BTN_H = 34;

type SubTab = 'stok' | 'masuk' | 'keluar' | 'transfer' | 'laporan';

const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'stok',     label: 'Stok',     Icon: Warehouse },
  { id: 'masuk',    label: 'Masuk',    Icon: TrendingUp },
  { id: 'keluar',   label: 'Keluar',   Icon: TrendingDown },
  { id: 'transfer', label: 'Transfer', Icon: ArrowLeftRight },
  { id: 'laporan',  label: 'Laporan',  Icon: FileBarChart },
];

// ── Laporan Stok — periode ────────────────────────────────────────────────────
type ReportPeriodKey = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';
const REPORT_PERIOD_OPTIONS: { id: ReportPeriodKey; label: string }[] = [
  { id: 'today',  label: 'Hari Ini' },
  { id: '7d',     label: '7 Hari' },
  { id: '30d',    label: '30 Hari' },
  { id: 'month',  label: 'Bulan Ini' },
  { id: 'year',   label: 'Tahun Ini' },
  { id: 'custom', label: 'Custom' },
];

function reportToISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function reportPeriodRange(period: ReportPeriodKey, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = reportToISO(now);
  switch (period) {
    case 'today': return { from: today, to: today };
    case '7d': { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: reportToISO(d), to: today }; }
    case '30d': { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: reportToISO(d), to: today }; }
    case 'month': { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { from: reportToISO(d), to: today }; }
    case 'year': { const d = new Date(now.getFullYear(), 0, 1); return { from: reportToISO(d), to: today }; }
    case 'custom': return { from: customFrom || today, to: customTo || today };
  }
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

interface WarehouseData {
  id: string;
  name: string;
  location: string;
  description: string;
}

interface ProductStock {
  productId: string;
  productName: string;
  stockQty: number;
}

interface TxEntry {
  id: string;
  type: 'in' | 'out' | 'transfer' | 'reject';
  warehouseId?: string;
  warehouseName?: string;
  fromWarehouseId?: string;
  fromWarehouseName?: string;
  toWarehouseId?: string;
  toWarehouseName?: string;
  productId: string;
  productName?: string;
  qty: number;
  note?: string;
  createdAt?: { seconds?: number; _seconds?: number };
}

interface Product {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  imageUrls?: string[];
  category?: string;
  stock?: string;
  stockQty?: number;
  costPrice?: number;
}

interface WhStockRow {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  stockQty: number;
}

interface Category {
  id: string;
  label: string;
  emoji: string;
}

function formatDate(entry: Pick<TxEntry, 'createdAt'>) {
  const seconds = entry.createdAt?.seconds ?? entry.createdAt?._seconds;
  if (seconds)
    return new Date(seconds * 1000).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  return '–';
}

// ── WarehouseModal ────────────────────────────────────────────────────────────
interface WFormState { name: string; location: string; description: string }

function WarehouseModal({
  title, subtitle, form, saving, onChange, onClose, onSave, submitLabel,
}: {
  title: string; subtitle: string;
  form: WFormState; saving: boolean;
  onChange: (f: WFormState) => void;
  onClose: () => void; onSave: () => void;
  submitLabel: string;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><Warehouse size={17} /></div>
            <div>
              <p className="modal-title">{title}</p>
              <p className="modal-subtitle">{subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {([
              { key: 'name',        label: 'Nama Gudang',     required: true,  placeholder: 'cth: Gudang Utama' },
              { key: 'location',    label: 'Lokasi / Alamat', required: false, placeholder: 'cth: Jl. Mawar No. 5, Bogor' },
              { key: 'description', label: 'Keterangan',      required: false, placeholder: 'cth: Gudang untuk produk kering (opsional)' },
            ] as const).map(f => (
              <div key={f.key}>
                <label className="field-label">
                  {f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                </label>
                <input
                  type="text"
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={e => onChange({ ...form, [f.key]: e.target.value })}
                  autoFocus={f.key === 'name'}
                  className="input"
                />
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Batal
          </button>
          <button onClick={onSave} disabled={saving || !form.name.trim()}
            className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── TxModal — add stok masuk / keluar ─────────────────────────────────────────
function TxModal({
  type, warehouseOptions, productOptions,
  wId, pId, qty, note, noWarehouse, onWId, onPId, onQty, onNote, onNoWarehouse,
  submitting, onClose, onSubmit,
}: {
  type: 'in' | 'out';
  warehouseOptions: SearchSelectOption[];
  productOptions: SearchSelectOption[];
  wId: string; pId: string; qty: string; note: string; noWarehouse: boolean;
  onWId: (v: string) => void; onPId: (v: string) => void;
  onQty: (v: string) => void; onNote: (v: string) => void; onNoWarehouse: (v: boolean) => void;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (typeof document === 'undefined') return null;
  const isIn = type === 'in';
  const canSubmit = (noWarehouse || !!wId) && !!pId && !!qty && Number(qty) > 0;
  return createPortal(
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon" style={isIn ? undefined : { background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {isIn ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
            </div>
            <div>
              <p className="modal-title">{isIn ? 'Catat Stok Masuk' : 'Catat Stok Keluar'}</p>
              <p className="modal-subtitle">
                {isIn ? 'Penerimaan barang dari supplier atau penambahan stok' : 'Pengurangan stok — rusak, terpakai, retur, dll.'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!isIn && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={noWarehouse}
                  onChange={e => { onNoWarehouse(e.target.checked); if (e.target.checked) onWId(''); }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Koreksi stok — tanpa gudang (tidak mengubah stok per gudang)
                </span>
              </label>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!noWarehouse && (
                <div>
                  <label className="field-label">Gudang <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={wId} onChange={onWId} options={warehouseOptions}
                    placeholder="– Pilih Gudang –" searchPlaceholder="Cari gudang…" />
                </div>
              )}
              <div className={noWarehouse ? 'sm:col-span-2' : undefined}>
                <label className="field-label">Produk <span style={{ color: 'var(--danger)' }}>*</span></label>
                <SearchSelect value={pId} onChange={onPId} options={productOptions}
                  placeholder="– Pilih Produk –" searchPlaceholder="Cari produk…" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Jumlah Unit <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input type="number" min={1} placeholder={isIn ? 'cth: 50' : 'cth: 10'} value={qty}
                  onChange={e => onQty(e.target.value)} className="input" autoFocus />
              </div>
              <div>
                <label className="field-label">Keterangan</label>
                <input type="text" placeholder={isIn ? 'cth: Restock dari supplier (opsional)' : 'cth: Barang rusak saat pengiriman (opsional)'}
                  value={note} onChange={e => onNote(e.target.value)} className="input" />
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Batal
          </button>
          <button onClick={onSubmit} disabled={submitting || !canSubmit}
            className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0', background: isIn ? undefined : 'linear-gradient(135deg,#DC2626,#B91C1C)' }}>
            {submitting
              ? <Loader2 size={14} className="animate-spin" />
              : isIn ? <Plus size={14} /> : <TrendingDown size={14} />}
            {submitting ? 'Menyimpan…' : isIn ? 'Tambah Stok Masuk' : 'Kurangi Stok'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── TransferModal — transfer stok antar gudang ────────────────────────────────
function TransferModal({
  warehouseOptions, productOptions,
  fromWId, toWId, pId, qty, note,
  onFromWId, onToWId, onPId, onQty, onNote,
  submitting, onClose, onSubmit,
}: {
  warehouseOptions: SearchSelectOption[];
  productOptions: SearchSelectOption[];
  fromWId: string; toWId: string; pId: string; qty: string; note: string;
  onFromWId: (v: string) => void; onToWId: (v: string) => void; onPId: (v: string) => void;
  onQty: (v: string) => void; onNote: (v: string) => void;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (typeof document === 'undefined') return null;
  const sameWarehouse = !!fromWId && !!toWId && fromWId === toWId;
  const canSubmit = !!fromWId && !!toWId && !!pId && !!qty && Number(qty) > 0 && !sameWarehouse;
  return createPortal(
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon" style={{ background: '#EFF6FF', color: '#0284C7' }}>
              <ArrowLeftRight size={17} />
            </div>
            <div>
              <p className="modal-title">Transfer Antar Gudang</p>
              <p className="modal-subtitle">Pindahkan stok dari satu gudang ke gudang lain</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Dari Gudang <span style={{ color: 'var(--danger)' }}>*</span></label>
                <SearchSelect value={fromWId} onChange={onFromWId} options={warehouseOptions}
                  placeholder="– Pilih Asal –" searchPlaceholder="Cari gudang…" />
              </div>
              <div>
                <label className="field-label">Ke Gudang <span style={{ color: 'var(--danger)' }}>*</span></label>
                <SearchSelect value={toWId} onChange={onToWId}
                  options={warehouseOptions.filter(o => o.value !== fromWId)}
                  placeholder="– Pilih Tujuan –" searchPlaceholder="Cari gudang…" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Produk <span style={{ color: 'var(--danger)' }}>*</span></label>
                <SearchSelect value={pId} onChange={onPId} options={productOptions}
                  placeholder="– Pilih Produk –" searchPlaceholder="Cari produk…" />
              </div>
              <div>
                <label className="field-label">Jumlah Unit <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input type="number" min={1} placeholder="cth: 20" value={qty}
                  onChange={e => onQty(e.target.value)} className="input" />
              </div>
            </div>
            <div>
              <label className="field-label">Keterangan</label>
              <input type="text" placeholder="cth: Redistribusi stok akhir bulan (opsional)" value={note}
                onChange={e => onNote(e.target.value)} className="input" />
            </div>
            {sameWarehouse && (
              <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                Gudang asal dan tujuan tidak boleh sama.
              </p>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Batal
          </button>
          <button onClick={onSubmit} disabled={submitting || !canSubmit}
            className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0', background: 'linear-gradient(135deg,#0284C7,#0369A1)' }}>
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
            {submitting ? 'Memproses…' : 'Proses Transfer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Pagination — shared bar across the tx lists in this tab ──────────────────
function Pagination({ total, safePage, totalPages, pageSize, onPageSize, onGoPage, unit }: {
  total: number; safePage: number; totalPages: number; pageSize: number;
  onPageSize: (n: number) => void; onGoPage: (p: number) => void; unit: string;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {total} {unit} · halaman {safePage} dari {totalPages}
        </p>
        <PageSizeSelect value={pageSize} onChange={onPageSize} />
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onGoPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30">
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
            .reduce<(number | '…')[]>((acc, n, i, arr) => {
              if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
              acc.push(n); return acc;
            }, [])
            .map((n, i) =>
              n === '…'
                ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                : <button key={n} onClick={() => onGoPage(n as number)}
                    className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                    style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                    {n}
                  </button>
            )
          }
          <button onClick={() => onGoPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── TxList — shared transaction list component ────────────────────────────────
function TxList({
  entries, loading, emptyLabel, warehouses, products, view, startIndex = 0,
}: {
  entries: TxEntry[];
  loading: boolean;
  emptyLabel: string;
  warehouses: WarehouseData[];
  products: Product[];
  view: ViewMode;
  startIndex?: number;
}) {
  const wName = (id?: string) => warehouses.find(w => w.id === id)?.name ?? id ?? '–';
  const pName = (entry: TxEntry) => entry.productName || products.find(p => p.id === entry.productId)?.name || entry.productId;
  const pEmoji = (id: string) => products.find(p => p.id === id)?.emoji ?? '📦';
  const pImages = (id: string) => products.find(p => p.id === id)?.imageUrls;
  const pBgColor = (id: string) => products.find(p => p.id === id)?.bgColor ?? '#F5F0E9';

  const typeBadge = (type: TxEntry['type']) => {
    if (type === 'in')       return { label: 'Masuk',    Icon: TrendingUp,     color: 'var(--success)', bg: 'var(--success-bg)' };
    if (type === 'out')      return { label: 'Keluar',   Icon: TrendingDown,   color: 'var(--danger)',  bg: 'var(--danger-bg)'  };
    if (type === 'reject')   return { label: 'Reject',   Icon: Ban,            color: 'var(--danger)',  bg: 'var(--danger-bg)'  };
    return                          { label: 'Transfer', Icon: ArrowLeftRight, color: '#0284C7',        bg: '#EFF6FF'            };
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  if (entries.length === 0) return (
    <div className="rounded-2xl p-12 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
      <Clock size={24} style={{ color: 'var(--text-muted)', margin: '0 auto 10px', display: 'block' }} />
      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</p>
    </div>
  );

  const rows = entries.map((e, i) => {
    const isIn = e.type === 'in';
    const isTransfer = e.type === 'transfer';
    const badge = typeBadge(e.type);
    const locationLabel = isTransfer
      ? `${e.fromWarehouseName || wName(e.fromWarehouseId)}  →  ${e.toWarehouseName || wName(e.toWarehouseId)}`
      : (e.warehouseName || wName(e.warehouseId));
    return { e, isIn, isTransfer, badge, locationLabel, num: startIndex + i + 1 };
  });

  if (view === 'table') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(({ e, isIn, isTransfer, badge, locationLabel, num }) => (
        <div key={e.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', borderRadius: 12,
          background: 'var(--surface)', border: '1px solid var(--border-2)',
        }}>
          <span style={{ width: 22, flexShrink: 0, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {num}
          </span>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${pBgColor(e.productId)}22`, fontSize: 16, position: 'relative', overflow: 'hidden',
          }}>
            {pImages(e.productId)?.[0]
              ? <Image src={pImages(e.productId)![0]} alt={pName(e)} fill className="object-contain" sizes="36px" unoptimized />
              : pEmoji(e.productId)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-1.5">
              <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pName(e)}
              </p>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em',
                color: badge.color, background: badge.bg, borderRadius: 999, padding: '1.5px 6px 1.5px 5px',
              }}>
                <badge.Icon size={9} strokeWidth={2.5} /> {badge.label}
              </span>
            </div>
            <p style={{
              fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
              display: 'flex', alignItems: 'center', gap: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {isTransfer ? <ArrowLeftRight size={10} style={{ flexShrink: 0 }} /> : <Warehouse size={10} style={{ flexShrink: 0 }} />}
              {locationLabel}
            </p>
            {e.note && (
              <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                &ldquo;{e.note}&rdquo;
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: badge.color, fontVariantNumeric: 'tabular-nums' }}>
              {isIn ? '+' : isTransfer ? '' : '–'}{e.qty} unit
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
              {formatDate(e)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {rows.map(({ e, isIn, isTransfer, badge, locationLabel, num }) => (
        <div key={e.id} className="card overflow-hidden flex flex-col" style={{ borderColor: 'var(--border-2)' }}>
          <div className="relative w-full aspect-square" style={{ background: `${pBgColor(e.productId)}22` }}>
            <ImageCarousel
              imageUrls={pImages(e.productId)}
              emoji={pEmoji(e.productId)}
              alt={pName(e)}
              sizes="(max-width: 640px) 50vw, 200px"
              emojiClassName="text-4xl"
            />
            <span className="absolute top-2 left-2 flex items-center justify-center" style={{
              width: 18, height: 18, borderRadius: 999, fontSize: 9.5, fontWeight: 800,
              color: 'var(--text-secondary)', background: 'var(--surface)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.12)', fontVariantNumeric: 'tabular-nums',
            }}>
              {num}
            </span>
            <span className="absolute top-2 right-2" style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em',
              color: badge.color, background: 'var(--surface)', borderRadius: 999, padding: '2px 7px 2px 6px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
            }}>
              <badge.Icon size={9} strokeWidth={2.5} /> {badge.label}
            </span>
          </div>
          <div className="px-3 pt-2 pb-3">
            <p className="text-[11px] font-bold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
              {pName(e)}
            </p>
            <p className="text-[10.5px] mt-1 flex items-center gap-1 truncate" style={{ color: 'var(--text-muted)' }}>
              {isTransfer ? <ArrowLeftRight size={9} style={{ flexShrink: 0 }} /> : <Warehouse size={9} style={{ flexShrink: 0 }} />}
              {locationLabel}
            </p>
            {e.note && (
              <p className="text-[10.5px] mt-0.5 italic truncate" style={{ color: 'var(--text-muted)' }}>&ldquo;{e.note}&rdquo;</p>
            )}
            <div className="flex items-center justify-between mt-2 pt-1.5" style={{ borderTop: '1px solid var(--border-2)' }}>
              <p className="text-xs font-extrabold tabular" style={{ color: badge.color }}>
                {isIn ? '+' : isTransfer ? '' : '–'}{e.qty} unit
              </p>
              <p className="text-[10px] tabular" style={{ color: 'var(--text-muted)' }}>{formatDate(e)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ReportTable — tabel detail stok per produk pada Laporan Stok ─────────────
interface ReportRow {
  product: Product;
  qty: number;
  costPrice: number;
  nilai: number;
  masuk: number;
  keluar: number;
  net: number;
  status: 'habis' | 'rendah' | 'normal' | 'open_po';
}

const REPORT_STATUS_STYLE = {
  habis:   { label: 'Habis',   color: '#DC2626', bg: '#FEF2F2' },
  rendah:  { label: 'Rendah',  color: '#A84F10', bg: '#FDF0E6' },
  normal:  { label: 'Normal',  color: '#15803D', bg: '#F0FDF4' },
  open_po: { label: 'Open PO', color: '#A84F10', bg: '#FDF0E6' },
} as const;

function ReportTable({ rows, categories, startIndex = 0 }: {
  rows: ReportRow[];
  categories: Category[];
  startIndex?: number;
}) {
  const catLabel = (id?: string) => categories.find(c => c.id === id)?.label;
  const formatRpCell = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

  return (
    <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
      <div className="hidden lg:flex px-4 py-2.5 items-center gap-3" style={{ borderBottom: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
        <span className="w-6 flex-shrink-0" />
        <span className="flex-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Produk</span>
        <span className="w-16 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Stok</span>
        <span className="w-24 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>HPP</span>
        <span className="w-28 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Nilai Stok</span>
        <span className="w-16 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Masuk</span>
        <span className="w-16 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Keluar</span>
        <span className="w-20 text-right text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Status</span>
      </div>
      <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
        {rows.map((r, i) => {
          const st = REPORT_STATUS_STYLE[r.status];
          const cat = catLabel(r.product.category);
          return (
            <div key={r.product.id} className="px-4 py-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
              <div className="flex items-center gap-3 lg:contents">
                <span className="hidden lg:inline-block w-6 flex-shrink-0 text-right text-[11px] font-bold tabular" style={{ color: 'var(--text-muted)' }}>
                  {startIndex + i + 1}
                </span>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-base relative overflow-hidden" style={{ background: `${r.product.bgColor}22` }}>
                  {r.product.imageUrls?.[0]
                    ? <Image src={r.product.imageUrls[0]} alt={r.product.name} fill className="object-contain" sizes="36px" unoptimized />
                    : r.product.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{r.product.name}</p>
                  {cat && <p className="text-[10.5px] truncate" style={{ color: 'var(--text-muted)' }}>{cat}</p>}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 lg:contents">
                <div className="lg:w-16 lg:flex-shrink-0 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Stok</p>
                  <p className="text-sm font-bold tabular lg:text-right" style={{ color: 'var(--text-primary)' }}>{r.qty}</p>
                </div>
                <div className="lg:w-24 lg:flex-shrink-0 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>HPP</p>
                  <p className="text-sm tabular truncate lg:text-right" style={{ color: 'var(--text-secondary)' }}>{formatRpCell(r.costPrice)}</p>
                </div>
                <div className="lg:w-28 lg:flex-shrink-0 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Nilai Stok</p>
                  <p className="text-sm font-bold tabular truncate lg:text-right" style={{ color: 'var(--accent)' }}>{formatRpCell(r.nilai)}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 lg:contents">
                <div className="lg:w-16 lg:flex-shrink-0 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Masuk</p>
                  <p className="text-sm font-bold tabular lg:text-right" style={{ color: r.masuk > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                    {r.masuk > 0 ? `+${r.masuk}` : '–'}
                  </p>
                </div>
                <div className="lg:w-16 lg:flex-shrink-0 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Keluar</p>
                  <p className="text-sm font-bold tabular lg:text-right" style={{ color: r.keluar > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {r.keluar > 0 ? `–${r.keluar}` : '–'}
                  </p>
                </div>
                <div className="lg:w-20 lg:flex-shrink-0 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wide lg:hidden" style={{ color: 'var(--text-muted)' }}>Status</p>
                  <span className="inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded-full lg:ml-auto" style={{ color: st.color, background: st.bg }}>
                    {st.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function StockTab({
  creds,
  products = [],
  categories = [],
}: {
  creds: string;
  products?: Product[];
  categories?: Category[];
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [subTab, setSubTab] = useState<SubTab>('stok');

  // Shared
  const [warehouses, setWarehouses]   = useState<WarehouseData[]>([]);
  const [loading, setLoading]         = useState(true);
  const [transactions, setTxs]        = useState<TxEntry[]>([]);
  const [txLoading, setTxLoading]     = useState(false);

  // Stok view
  const [stokView, setStokView]                     = useState<'warehouses' | 'stock'>('warehouses');
  const [selectedWarehouse, setSelectedWarehouse]   = useState<WarehouseData | null>(null);
  const [stocks, setStocks]                         = useState<ProductStock[]>([]);
  const [stockLoading, setStockLoading]             = useState(false);
  const [hoveredCard, setHoveredCard]               = useState<string | null>(null);
  const [stockCatFilter, setStockCatFilter]         = useState('semua');
  const [historyView, setHistoryView]               = useViewMode('stock-history');

  // Warehouse CRUD
  const [showWForm, setShowWForm]       = useState(false);
  const [editWarehouse, setEditWarehouse] = useState<WarehouseData | null>(null);
  const [wForm, setWForm]               = useState({ name: '', location: '', description: '' });
  const [savingW, setSavingW]           = useState(false);
  const [deletingId, setDeletingId]     = useState<string | null>(null);

  // Masuk / Keluar modal
  const [showTxModal, setShowTxModal] = useState<'in' | 'out' | null>(null);
  const [txWId, setTxWId]           = useState('');
  const [txPId, setTxPId]           = useState('');
  const [txQty, setTxQty]           = useState('');
  const [txNote, setTxNote]         = useState('');
  const [txNoWarehouse, setTxNoWarehouse] = useState(false);
  const [txSubmitting, setTxSub]    = useState(false);

  // Transfer modal
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [fromWId, setFromWId]       = useState('');
  const [toWId, setToWId]           = useState('');
  const [trPId, setTrPId]           = useState('');
  const [trQty, setTrQty]           = useState('');
  const [trNote, setTrNote]         = useState('');
  const [trSubmitting, setTrSub]    = useState(false);

  // Masuk / Keluar / Transfer — pencarian & paginasi riwayat
  const [masukSearch, setMasukSearch]         = useState('');
  const [masukPage, setMasukPage]             = useState(1);
  const [masukPageSize, setMasukPageSize]     = useState(10);
  const [keluarSearch, setKeluarSearch]       = useState('');
  const [keluarPage, setKeluarPage]           = useState(1);
  const [keluarPageSize, setKeluarPageSize]   = useState(10);
  const [transferSearch, setTransferSearch]       = useState('');
  const [transferPage, setTransferPage]           = useState(1);
  const [transferPageSize, setTransferPageSize]   = useState(10);

  // Laporan Stok
  const [reportPeriod, setReportPeriod]         = useState<ReportPeriodKey>('month');
  const [reportCustomFrom, setReportCustomFrom] = useState('');
  const [reportCustomTo, setReportCustomTo]     = useState('');
  const [reportWhFilter, setReportWhFilter]     = useState('semua');
  const [reportCatFilter, setReportCatFilter]   = useState('semua');
  const [reportSearch, setReportSearch]         = useState('');
  const [reportPage, setReportPage]             = useState(1);
  const [reportPageSize, setReportPageSize]     = useState(10);
  const [reportTxPage, setReportTxPage]         = useState(1);
  const [reportTxPageSize, setReportTxPageSize] = useState(10);
  const [reportLedger, setReportLedger]         = useState<TxEntry[]>([]);
  const [reportLedgerLoading, setReportLedgerLoading] = useState(false);
  const [allWhStocks, setAllWhStocks]           = useState<WhStockRow[]>([]);
  const [allWhStocksLoading, setAllWhStocksLoading] = useState(false);
  const [exportingReport, setExportingReport]   = useState(false);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const loadWarehouses = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/warehouses`, { headers });
    if (r.ok) {
      const { warehouses: w } = await r.json() as { warehouses: WarehouseData[] };
      setWarehouses(w);
    }
    setLoading(false);
  };

  const loadTx = async () => {
    setTxLoading(true);
    const r = await fetch(`${API}/api/stock`, { headers });
    if (r.ok) {
      const { entries } = await r.json() as { entries: TxEntry[] };
      setTxs(entries);
    }
    setTxLoading(false);
  };

  const loadStock = async (warehouseId: string) => {
    setStockLoading(true);
    const r = await fetch(`${API}/api/warehouses/${warehouseId}/stock`, { headers });
    if (r.ok) {
      const { stocks: s } = await r.json() as { stocks: ProductStock[] };
      setStocks(s);
    }
    setStockLoading(false);
  };

  // ── Laporan Stok — mutasi periode & stok per gudang ──
  const { from: reportFrom, to: reportTo } = reportPeriodRange(reportPeriod, reportCustomFrom, reportCustomTo);

  const loadReportLedger = async () => {
    setReportLedgerLoading(true);
    const r = await fetch(`${API}/api/stock?from=${reportFrom}&to=${reportTo}`, { headers });
    if (r.ok) {
      const { entries } = await r.json() as { entries: TxEntry[] };
      setReportLedger(entries);
    }
    setReportLedgerLoading(false);
  };

  const loadAllWhStocks = async () => {
    if (warehouses.length === 0) { setAllWhStocks([]); return; }
    setAllWhStocksLoading(true);
    const results = await Promise.all(warehouses.map(async w => {
      const r = await fetch(`${API}/api/warehouses/${w.id}/stock`, { headers });
      if (!r.ok) return [];
      const { stocks: s } = await r.json() as { stocks: ProductStock[] };
      return s.map(x => ({ warehouseId: w.id, warehouseName: w.name, ...x }));
    }));
    setAllWhStocks(results.flat());
    setAllWhStocksLoading(false);
  };

  // ── Kosongkan stok ──
  const [clearingId, setClearingId]   = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const clearProductStock = async (productId: string, productName: string) => {
    if (!selectedWarehouse) return;
    if (!await confirm({ message: `Kosongkan stok "${productName}" di gudang ini ke 0?`, danger: true })) return;
    setClearingId(productId);
    const r = await fetch(`${API}/api/warehouses/${selectedWarehouse.id}/stock/${productId}`, { method: 'DELETE', headers });
    if (r.ok) {
      await loadStock(selectedWarehouse.id);
      toast.success(`Stok "${productName}" berhasil dikosongkan.`);
    } else {
      toast.error('Gagal mengosongkan stok produk.');
    }
    setClearingId(null);
  };

  const clearAllStock = async () => {
    if (!selectedWarehouse) return;
    if (!await confirm({ message: `Kosongkan SEMUA stok di gudang "${selectedWarehouse.name}" ke 0? Tindakan ini tidak bisa diurungkan.`, danger: true })) return;
    setClearingAll(true);
    const r = await fetch(`${API}/api/warehouses/${selectedWarehouse.id}/stock/clear`, { method: 'POST', headers });
    if (r.ok) {
      await loadStock(selectedWarehouse.id);
      toast.success('Semua stok di gudang ini berhasil dikosongkan.');
    } else {
      toast.error('Gagal mengosongkan stok gudang.');
    }
    setClearingAll(false);
  };

  useEffect(() => { loadWarehouses(); }, []);

  useEffect(() => {
    if (subTab !== 'stok' && subTab !== 'laporan') loadTx();
  }, [subTab]);

  useEffect(() => {
    if (subTab === 'laporan') { loadReportLedger(); loadAllWhStocks(); }
  }, [subTab, reportFrom, reportTo, warehouses]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Warehouse actions ──
  const openWarehouse = async (w: WarehouseData) => {
    setSelectedWarehouse(w);
    setStokView('stock');
    setStockCatFilter('semua');
    await loadStock(w.id);
  };

  const backToWarehouses = () => {
    setStokView('warehouses');
    setSelectedWarehouse(null);
    setStocks([]);
    setStockCatFilter('semua');
  };

  const openCreate = () => {
    setEditWarehouse(null);
    setWForm({ name: '', location: '', description: '' });
    setShowWForm(true);
  };

  const openEdit = (w: WarehouseData, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditWarehouse(w);
    setWForm({ name: w.name, location: w.location, description: w.description });
    setShowWForm(true);
  };

  const saveWarehouse = async () => {
    if (!wForm.name.trim()) return;
    setSavingW(true);
    const isEdit = !!editWarehouse;
    const r = isEdit
      ? await fetch(`${API}/api/warehouses/${editWarehouse!.id}`, { method: 'PUT', headers, body: JSON.stringify(wForm) })
      : await fetch(`${API}/api/warehouses`, { method: 'POST', headers, body: JSON.stringify(wForm) });
    setSavingW(false);
    if (r.ok) {
      setShowWForm(false);
      await loadWarehouses();
      toast.success(isEdit ? 'Gudang berhasil diperbarui.' : 'Gudang berhasil ditambahkan.');
    } else {
      toast.error('Gagal menyimpan gudang.');
    }
  };

  const deleteWarehouse = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await confirm({ message: 'Hapus gudang ini? Semua data stok di gudang ini juga akan dihapus.', danger: true })) return;
    setDeletingId(id);
    const r = await fetch(`${API}/api/warehouses/${id}`, { method: 'DELETE', headers });
    setDeletingId(null);
    if (r.ok) {
      await loadWarehouses();
      toast.success('Gudang berhasil dihapus.');
    } else {
      toast.error('Gagal menghapus gudang.');
    }
  };

  // ── Submit masuk / keluar ──
  const submitTx = async (type: 'in' | 'out') => {
    if (!txPId || !txQty || Number(txQty) <= 0) return;
    if (!txNoWarehouse && !txWId) return;
    setTxSub(true);
    const prod = products.find(p => p.id === txPId);
    const r = txNoWarehouse
      ? await fetch(`${API}/api/stock/${txPId}`, {
          method: 'POST', headers,
          body: JSON.stringify({ productName: prod?.name ?? '', type, qty: Number(txQty), note: txNote }),
        })
      : await fetch(`${API}/api/warehouses/${txWId}/stock`, {
          method: 'POST', headers,
          body: JSON.stringify({
            productId: txPId,
            productName: prod?.name ?? '',
            warehouseName: warehouses.find(w => w.id === txWId)?.name ?? '',
            type, qty: Number(txQty), note: txNote,
          }),
        });
    if (r.ok) {
      setTxWId(''); setTxPId(''); setTxQty(''); setTxNote(''); setTxNoWarehouse(false);
      setShowTxModal(null);
      await loadTx();
      toast.success(type === 'in' ? 'Stok masuk berhasil dicatat.' : 'Stok keluar berhasil dicatat.');
    } else {
      const { error } = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(error ?? 'Gagal mencatat transaksi stok.');
    }
    setTxSub(false);
  };

  // ── Submit transfer ──
  const submitTransfer = async () => {
    if (!fromWId || !toWId || !trPId || !trQty || Number(trQty) <= 0 || fromWId === toWId) return;
    setTrSub(true);
    const fromWh = warehouses.find(w => w.id === fromWId);
    const toWh   = warehouses.find(w => w.id === toWId);
    const prod   = products.find(p => p.id === trPId);
    const r = await fetch(`${API}/api/stock/transfer`, {
      method: 'POST', headers,
      body: JSON.stringify({
        fromWarehouseId: fromWId, fromWarehouseName: fromWh?.name ?? '',
        toWarehouseId: toWId,     toWarehouseName: toWh?.name ?? '',
        productId: trPId, productName: prod?.name ?? '',
        qty: Number(trQty), note: trNote,
      }),
    });
    if (r.ok) {
      setFromWId(''); setToWId(''); setTrPId(''); setTrQty(''); setTrNote('');
      setShowTransferModal(false);
      await loadTx();
      toast.success('Transfer stok berhasil.');
    } else {
      const { error } = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(error ?? 'Gagal melakukan transfer stok.');
    }
    setTrSub(false);
  };

  // ── Loading ──
  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  const inTx       = transactions.filter(t => t.type === 'in');
  const outTx      = transactions.filter(t => t.type === 'out' || t.type === 'reject');
  const transferTx = transactions.filter(t => t.type === 'transfer');

  const poProducts  = products.filter(p => p.stock === 'open_po');
  const totalQtyAll = products.reduce((s, p) => s + (p.stockQty ?? 0), 0);

  // Produk open PO tidak selalu punya entri warehouse_stock (bisa 0 unit fisik) —
  // tetap tampilkan di setiap gudang supaya admin melihat status PO-nya.
  const poIds       = new Set(poProducts.map(p => p.id));
  const stockPoExtra = poProducts
    .filter(p => !stocks.some(s => s.productId === p.id))
    .map(p => ({ productId: p.id, productName: p.name, stockQty: 0 }));
  const mergedStocks = [...stocks, ...stockPoExtra];

  // Dropdown produk hanya untuk item yang tersedia (ready) atau open PO — bukan yang habis
  const availableProducts = products.filter(p => p.stock === 'ready' || p.stock === 'open_po');
  const productOptions: SearchSelectOption[] = availableProducts.map(p => ({
    value: p.id, label: p.name, imageUrl: p.imageUrls?.[0], emoji: p.emoji,
    sublabel: p.stock === 'open_po' ? 'Open PO' : undefined,
  }));
  const warehouseOptions: SearchSelectOption[] = warehouses.map(w => ({
    value: w.id, label: w.name, sublabel: w.location || undefined, emoji: '🏬',
  }));

  // ── Modal open helpers ──
  const openTxModal = (type: 'in' | 'out') => {
    setTxWId(''); setTxPId(''); setTxQty(''); setTxNote(''); setTxNoWarehouse(false);
    setShowTxModal(type);
  };
  const openTransferModal = () => {
    setFromWId(''); setToWId(''); setTrPId(''); setTrQty(''); setTrNote('');
    setShowTransferModal(true);
  };

  // ── Pencarian & paginasi riwayat masuk / keluar / transfer ──
  const wName = (id?: string) => warehouses.find(w => w.id === id)?.name ?? '';
  const txSearchText = (e: TxEntry) => [
    e.productName || products.find(p => p.id === e.productId)?.name || '',
    e.warehouseName || wName(e.warehouseId),
    e.fromWarehouseName || wName(e.fromWarehouseId),
    e.toWarehouseName || wName(e.toWarehouseId),
    e.note ?? '',
  ].join(' ').toLowerCase();

  const filteredMasuk = masukSearch ? inTx.filter(e => txSearchText(e).includes(masukSearch.toLowerCase())) : inTx;
  const totalMasukPages = Math.max(1, Math.ceil(filteredMasuk.length / masukPageSize));
  const safeMasukPage   = Math.min(masukPage, totalMasukPages);
  const paginatedMasuk  = filteredMasuk.slice((safeMasukPage - 1) * masukPageSize, safeMasukPage * masukPageSize);
  const goMasukPage     = (p: number) => setMasukPage(Math.max(1, Math.min(p, totalMasukPages)));

  const filteredKeluar = keluarSearch ? outTx.filter(e => txSearchText(e).includes(keluarSearch.toLowerCase())) : outTx;
  const totalKeluarPages = Math.max(1, Math.ceil(filteredKeluar.length / keluarPageSize));
  const safeKeluarPage   = Math.min(keluarPage, totalKeluarPages);
  const paginatedKeluar  = filteredKeluar.slice((safeKeluarPage - 1) * keluarPageSize, safeKeluarPage * keluarPageSize);
  const goKeluarPage     = (p: number) => setKeluarPage(Math.max(1, Math.min(p, totalKeluarPages)));

  const filteredTransfer = transferSearch ? transferTx.filter(e => txSearchText(e).includes(transferSearch.toLowerCase())) : transferTx;
  const totalTransferPages = Math.max(1, Math.ceil(filteredTransfer.length / transferPageSize));
  const safeTransferPage   = Math.min(transferPage, totalTransferPages);
  const paginatedTransfer  = filteredTransfer.slice((safeTransferPage - 1) * transferPageSize, safeTransferPage * transferPageSize);
  const goTransferPage     = (p: number) => setTransferPage(Math.max(1, Math.min(p, totalTransferPages)));

  // ── Laporan Stok — mutasi periode terpilih, gudang terpilih ──
  const reportLedgerFiltered = reportWhFilter === 'semua'
    ? reportLedger
    : reportLedger.filter(e =>
        e.warehouseId === reportWhFilter ||
        e.fromWarehouseId === reportWhFilter ||
        e.toWarehouseId === reportWhFilter,
      );

  const sumQty = (entries: TxEntry[], types: TxEntry['type'][]) =>
    entries.filter(e => types.includes(e.type)).reduce((s, e) => s + e.qty, 0);

  const reportMasukQty   = sumQty(reportLedgerFiltered, ['in']);
  const reportKeluarQty  = sumQty(reportLedgerFiltered, ['out', 'reject']);
  const reportTrIn       = reportWhFilter === 'semua' ? 0 : reportLedgerFiltered.filter(e => e.type === 'transfer' && e.toWarehouseId === reportWhFilter).reduce((s, e) => s + e.qty, 0);
  const reportTrOut      = reportWhFilter === 'semua' ? 0 : reportLedgerFiltered.filter(e => e.type === 'transfer' && e.fromWarehouseId === reportWhFilter).reduce((s, e) => s + e.qty, 0);
  const reportTransferCt = reportLedgerFiltered.filter(e => e.type === 'transfer').length;
  const reportNetQty     = reportMasukQty + reportTrIn - reportKeluarQty - reportTrOut;

  // Stok saat ini — global (semua gudang) atau khusus satu gudang
  const currentQtyMap = new Map<string, number>();
  if (reportWhFilter === 'semua') {
    products.forEach(p => currentQtyMap.set(p.id, p.stockQty ?? 0));
  } else {
    allWhStocks.filter(s => s.warehouseId === reportWhFilter).forEach(s => currentQtyMap.set(s.productId, s.stockQty));
  }

  const reportRowsAll = products.map(p => {
    const qty = currentQtyMap.get(p.id) ?? 0;
    const costPrice = p.costPrice ?? 0;
    const ledgerForP = reportLedgerFiltered.filter(e => e.productId === p.id);
    const masuk = sumQty(ledgerForP, ['in']);
    const keluar = sumQty(ledgerForP, ['out', 'reject']);
    const trIn  = reportWhFilter === 'semua' ? 0 : ledgerForP.filter(e => e.type === 'transfer' && e.toWarehouseId === reportWhFilter).reduce((s, e) => s + e.qty, 0);
    const trOut = reportWhFilter === 'semua' ? 0 : ledgerForP.filter(e => e.type === 'transfer' && e.fromWarehouseId === reportWhFilter).reduce((s, e) => s + e.qty, 0);
    const isPO = p.stock === 'open_po';
    const status: 'habis' | 'rendah' | 'normal' | 'open_po' = isPO ? 'open_po' : qty === 0 ? 'habis' : qty < 10 ? 'rendah' : 'normal';
    return {
      product: p, qty, costPrice, nilai: qty * costPrice,
      masuk, keluar, net: masuk + trIn - keluar - trOut, status,
    };
  });

  const reportCatCounts = categories
    .map(c => ({ ...c, count: reportRowsAll.filter(r => r.product.category === c.id).length }))
    .filter(c => c.count > 0);

  const reportScopeRows = reportCatFilter === 'semua' ? reportRowsAll : reportRowsAll.filter(r => r.product.category === reportCatFilter);
  const reportDisplayRows = (reportSearch
    ? reportScopeRows.filter(r => r.product.name.toLowerCase().includes(reportSearch.toLowerCase()))
    : reportScopeRows
  ).slice().sort((a, b) => b.nilai - a.nilai);

  const reportTotalNilai   = reportScopeRows.reduce((s, r) => s + r.nilai, 0);
  const reportTotalUnit    = reportScopeRows.reduce((s, r) => s + r.qty, 0);
  const reportJenisProduk  = reportScopeRows.filter(r => r.qty > 0 || r.status === 'open_po').length;
  const reportRendahCount  = reportScopeRows.filter(r => r.status === 'rendah').length;
  const reportHabisCount   = reportScopeRows.filter(r => r.status === 'habis').length;

  const totalReportPages = Math.max(1, Math.ceil(reportDisplayRows.length / reportPageSize));
  const safeReportPage   = Math.min(reportPage, totalReportPages);
  const paginatedReportRows = reportDisplayRows.slice((safeReportPage - 1) * reportPageSize, safeReportPage * reportPageSize);
  const goReportPage     = (p: number) => setReportPage(Math.max(1, Math.min(p, totalReportPages)));

  const reportLedgerSorted = [...reportLedgerFiltered].sort((a, b) => {
    const as = a.createdAt?.seconds ?? a.createdAt?._seconds ?? 0;
    const bs = b.createdAt?.seconds ?? b.createdAt?._seconds ?? 0;
    return bs - as;
  });
  const totalReportTxPages = Math.max(1, Math.ceil(reportLedgerSorted.length / reportTxPageSize));
  const safeReportTxPage   = Math.min(reportTxPage, totalReportTxPages);
  const paginatedReportTx  = reportLedgerSorted.slice((safeReportTxPage - 1) * reportTxPageSize, safeReportTxPage * reportTxPageSize);
  const goReportTxPage     = (p: number) => setReportTxPage(Math.max(1, Math.min(p, totalReportTxPages)));

  const reportPeriodLabel = REPORT_PERIOD_OPTIONS.find(p => p.id === reportPeriod)?.label ?? '';
  const reportWhLabel = reportWhFilter === 'semua' ? 'Semua Gudang' : (warehouses.find(w => w.id === reportWhFilter)?.name ?? '');

  const exportReportExcel = async () => {
    setExportingReport(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();

      const styleTitle = (ws: ExcelJS.Worksheet, title: string, subtitle: string, colCount: number) => {
        ws.mergeCells(1, 1, 1, colCount);
        const t = ws.getCell(1, 1);
        t.value = title; t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
        ws.getRow(1).height = 28;
        ws.mergeCells(2, 1, 2, colCount);
        const s = ws.getCell(2, 1);
        s.value = subtitle; s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
        s.alignment = { horizontal: 'center', vertical: 'middle' };
        s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
        ws.getRow(2).height = 20;
      };
      const styleHeader = (ws: ExcelJS.Worksheet, rowNum: number, hdrs: string[]) => {
        const row = ws.getRow(rowNum);
        hdrs.forEach((h, i) => { row.getCell(i + 1).value = h; });
        row.height = 24;
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        ws.views = [{ state: 'frozen', ySplit: rowNum }];
      };
      const zebra = (ws: ExcelJS.Worksheet, rowNum: number, idx: number) => {
        ws.getRow(rowNum).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
      };

      // ── Sheet 1: Ringkasan ──
      const wsR = wb.addWorksheet('Ringkasan');
      wsR.columns = [{ key: 'a', width: 32 }, { key: 'b', width: 20 }];
      styleTitle(wsR, 'RINGKASAN LAPORAN STOK — CEMILAN TEH RISMA', `${reportWhLabel} · Periode: ${reportPeriodLabel} (${reportFrom} s/d ${reportTo})`, 2);
      styleHeader(wsR, 3, ['Keterangan', 'Jumlah']);
      const rRows: [string, number | string][] = [
        ['Total Nilai Stok (HPP)', reportTotalNilai], ['Total Unit Stok', reportTotalUnit],
        ['Jenis Produk', reportJenisProduk], ['Stok Rendah (< 10 unit)', reportRendahCount], ['Stok Habis', reportHabisCount],
        ['Stok Masuk (periode)', reportMasukQty], ['Stok Keluar (periode)', reportKeluarQty],
        ['Transaksi Transfer (periode)', reportTransferCt], ['Net Perubahan (periode)', reportNetQty],
      ];
      rRows.forEach(([label, val], i) => {
        const rowNum = 4 + i;
        wsR.getRow(rowNum).getCell(1).value = label;
        wsR.getRow(rowNum).getCell(2).value = val;
        if (label === 'Total Nilai Stok (HPP)') wsR.getRow(rowNum).getCell(2).numFmt = '"Rp"#,##0';
        zebra(wsR, rowNum, i);
      });

      // ── Sheet 2: Detail Stok per Produk ──
      const wsD = wb.addWorksheet('Detail Stok per Produk');
      wsD.columns = [
        { key: 'produk', width: 30 }, { key: 'kategori', width: 16 }, { key: 'qty', width: 12 },
        { key: 'hpp', width: 16 }, { key: 'nilai', width: 18 }, { key: 'masuk', width: 12 },
        { key: 'keluar', width: 12 }, { key: 'net', width: 12 }, { key: 'status', width: 14 },
      ];
      styleTitle(wsD, 'DETAIL STOK PER PRODUK — CEMILAN TEH RISMA', `${reportWhLabel} · Periode mutasi: ${reportPeriodLabel} (${reportFrom} s/d ${reportTo})`, 9);
      styleHeader(wsD, 3, ['Produk', 'Kategori', 'Stok Saat Ini', 'HPP', 'Nilai Stok', 'Masuk', 'Keluar', 'Net', 'Status']);
      const catLabelFor = (id?: string) => categories.find(c => c.id === id)?.label ?? (id ?? '');
      const statusLabel = { habis: 'Habis', rendah: 'Rendah', normal: 'Normal', open_po: 'Open PO' };
      [...reportRowsAll].sort((a, b) => b.nilai - a.nilai).forEach((r, i) => {
        const rowNum = 4 + i;
        const row = wsD.getRow(rowNum);
        row.getCell(1).value = r.product.name;
        row.getCell(2).value = catLabelFor(r.product.category);
        row.getCell(3).value = r.qty;
        row.getCell(4).value = r.costPrice;
        row.getCell(5).value = r.nilai;
        row.getCell(6).value = r.masuk;
        row.getCell(7).value = r.keluar;
        row.getCell(8).value = r.net;
        row.getCell(9).value = statusLabel[r.status];
        row.getCell(4).numFmt = '"Rp"#,##0';
        row.getCell(5).numFmt = '"Rp"#,##0';
        zebra(wsD, rowNum, i);
      });

      // ── Sheet 3: Riwayat Mutasi ──
      const wsM = wb.addWorksheet('Riwayat Mutasi');
      wsM.columns = [
        { key: 'tgl', width: 16 }, { key: 'tipe', width: 12 }, { key: 'produk', width: 28 },
        { key: 'lokasi', width: 30 }, { key: 'qty', width: 10 }, { key: 'ket', width: 30 },
      ];
      styleTitle(wsM, 'RIWAYAT MUTASI STOK — CEMILAN TEH RISMA', `${reportWhLabel} · Periode: ${reportPeriodLabel} (${reportFrom} s/d ${reportTo})`, 6);
      styleHeader(wsM, 3, ['Tanggal', 'Tipe', 'Produk', 'Lokasi', 'Qty', 'Keterangan']);
      const tipeLabel = { in: 'Masuk', out: 'Keluar', reject: 'Reject', transfer: 'Transfer' };
      reportLedgerSorted.forEach((e, i) => {
        const rowNum = 4 + i;
        const row = wsM.getRow(rowNum);
        const seconds = e.createdAt?.seconds ?? e.createdAt?._seconds;
        row.getCell(1).value = seconds ? new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
        row.getCell(2).value = tipeLabel[e.type];
        row.getCell(3).value = e.productName || products.find(p => p.id === e.productId)?.name || e.productId;
        row.getCell(4).value = e.type === 'transfer'
          ? `${e.fromWarehouseName || wName(e.fromWarehouseId)} → ${e.toWarehouseName || wName(e.toWarehouseId)}`
          : (e.warehouseName || wName(e.warehouseId));
        row.getCell(5).value = e.qty;
        row.getCell(6).value = e.note ?? '';
        zebra(wsM, rowNum, i);
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-stok-${reportFrom}-sd-${reportTo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally { setExportingReport(false); }
  };

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>

      {/* Sub-navigation */}
      <ScrollChips
        className="flex-shrink-0 px-4 pt-3.5 pb-3"
        style={{ borderBottom: '1px solid var(--border-2)' }}
      >
        {SUB_TABS.map(tab => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`tab-chip${active ? ' active' : ''}`}
            >
              <tab.Icon size={13} strokeWidth={active ? 2.3 : 1.8} />
              {tab.label}
            </button>
          );
        })}
      </ScrollChips>

      {/* Content */}
      <div className="flex-1 overflow-y-auto thin-scrollbar">

        {/* ════ STOK ════════════════════════════════════════════ */}
        {subTab === 'stok' && stokView === 'warehouses' && (
          <div className="p-4 lg:p-6 animate-fade-up">
            <TopbarPortal>
              <button onClick={loadWarehouses} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
                <RefreshCw size={14} />
              </button>
            </TopbarPortal>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { icon: <Warehouse   size={16} />, label: 'Total Gudang',        val: warehouses.length, color: 'var(--accent)' },
                { icon: <Package     size={16} />, label: 'Aktif',               val: warehouses.length, color: 'var(--success)' },
                { icon: <TrendingUp  size={16} />, label: 'Total Qty Gudang',    val: totalQtyAll,        color: '#0284C7' },
                { icon: <Clock       size={16} />, label: 'Item Open PO',        val: poProducts.length,  color: '#A84F10' },
              ].map((c, i) => (
                <div key={i} className="card p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--accent-bg)', color: c.color }}>
                    {c.icon}
                  </div>
                  <div>
                    <p className="text-xl font-extrabold tabular leading-none" style={{ color: c.color }}>{c.val}</p>
                    <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {warehouses.length === 0 ? (
              <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
                  <Warehouse size={28} style={{ color: 'var(--accent)' }} />
                </div>
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada gudang</p>
                <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>Tambahkan gudang untuk mulai mengelola stok per lokasi</p>
                <button onClick={openCreate} className="btn-primary mx-auto px-5 py-2.5 text-sm">
                  <Plus size={14} /> Tambah Gudang Pertama
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {warehouses.map(w => (
                  <div key={w.id} onClick={() => openWarehouse(w)}
                    onMouseEnter={() => setHoveredCard(w.id)}
                    onMouseLeave={() => setHoveredCard(null)}
                    className="card cursor-pointer overflow-hidden"
                    style={{
                      transition: 'box-shadow 0.18s, transform 0.18s',
                      boxShadow: hoveredCard === w.id ? '0 6px 24px rgba(0,0,0,0.09)' : '',
                      transform:  hoveredCard === w.id ? 'translateY(-2px)' : '',
                    }}
                  >
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-bg)' }}>
                          <Warehouse size={20} style={{ color: 'var(--accent)' }} />
                        </div>
                        <div className="flex items-center gap-1"
                          style={{ opacity: hoveredCard === w.id ? 1 : 0, transition: 'opacity 0.15s' }}
                          onClick={e => e.stopPropagation()}>
                          <button onClick={e => openEdit(w, e)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center"
                            style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                            title="Edit">
                            <Pencil size={12} />
                          </button>
                          <button onClick={e => deleteWarehouse(w.id, e)}
                            disabled={deletingId === w.id}
                            className="w-7 h-7 rounded-lg flex items-center justify-center"
                            style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
                            title="Hapus">
                            {deletingId === w.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </div>
                      <p className="font-bold text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>{w.name}</p>
                      {w.location ? (
                        <div className="flex items-center gap-1 mt-1.5">
                          <MapPin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{w.location}</p>
                        </div>
                      ) : (
                        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Tidak ada lokasi</p>
                      )}
                      {w.description && (
                        <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>{w.description}</p>
                      )}
                      <div className="flex items-center justify-between mt-4 pt-3.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                        <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Lihat Stok</span>
                        <ChevronRight size={14} style={{ color: 'var(--accent)' }} />
                      </div>
                    </div>
                  </div>
                ))}

                <button onClick={openCreate}
                  className="rounded-2xl flex flex-col items-center justify-center gap-2.5 p-6 min-h-[160px] transition-colors"
                  style={{ border: '2px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'var(--surface-2)'; el.style.borderColor = 'var(--accent)'; el.style.color = 'var(--accent)'; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent'; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text-muted)'; }}
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                    <Plus size={20} />
                  </div>
                  <span className="text-sm font-semibold">Tambah Gudang</span>
                </button>
              </div>
            )}

            {/* Item Open PO — lintas semua gudang */}
            {poProducts.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: '#FDF0E6', color: '#A84F10' }}>
                    <Clock size={15} />
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Item Open PO</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {poProducts.length} produk pre-order — berlaku di semua gudang
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {poProducts.map(p => (
                    <div key={p.id} className="card overflow-hidden flex flex-col">
                      <div className="relative w-full aspect-square" style={{ background: `${p.bgColor}22` }}>
                        <ImageCarousel
                          imageUrls={p.imageUrls}
                          emoji={p.emoji}
                          alt={p.name}
                          sizes="(max-width: 640px) 50vw, 200px"
                          emojiClassName="text-4xl"
                        />
                        <span className="badge badge-amber absolute top-2 right-2 text-[10px]">Open PO</span>
                      </div>
                      <div className="px-3 pt-2 pb-3">
                        <p className="text-[11px] font-bold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                          {p.name}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showWForm && (
              <WarehouseModal
                title={editWarehouse ? 'Edit Gudang' : 'Tambah Gudang Baru'}
                subtitle={editWarehouse ? 'Perbarui informasi gudang' : 'Isi detail gudang baru'}
                form={wForm} saving={savingW}
                onChange={setWForm}
                onClose={() => setShowWForm(false)}
                onSave={saveWarehouse}
                submitLabel={editWarehouse ? 'Simpan Perubahan' : 'Tambah Gudang'}
              />
            )}
          </div>
        )}

        {/* Stok per gudang */}
        {subTab === 'stok' && stokView === 'stock' && (
          <div className="p-4 lg:p-6 animate-fade-up">
            <div className="flex items-center gap-3 mb-6">
              <button onClick={backToWarehouses} className="btn-ghost p-2 flex-shrink-0" title="Kembali">
                <ArrowLeft size={16} />
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-extrabold truncate" style={{ color: 'var(--text-primary)' }}>
                  {selectedWarehouse?.name}
                </h2>
                {selectedWarehouse?.location && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin size={10} style={{ color: 'var(--text-muted)' }} />
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{selectedWarehouse.location}</p>
                  </div>
                )}
              </div>
              {stocks.length > 0 && (
                <button onClick={clearAllStock} disabled={clearingAll}
                  className="btn-ghost px-3 py-2 text-xs font-semibold flex-shrink-0" style={{ color: 'var(--danger)' }}>
                  {clearingAll ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Kosongkan Semua Stok
                </button>
              )}
            </div>

            <TopbarPortal>
              <button onClick={() => selectedWarehouse && loadStock(selectedWarehouse.id)}
                className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
                <RefreshCw size={14} className={stockLoading ? 'animate-spin' : ''} />
              </button>
            </TopbarPortal>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { icon: <Package      size={16} />, label: 'Jenis Produk', val: mergedStocks.length,                        color: 'var(--accent)'  },
                { icon: <TrendingUp   size={16} />, label: 'Total Unit',   val: stocks.reduce((s, x) => s + x.stockQty, 0), color: 'var(--success)' },
                { icon: <TrendingDown size={16} />, label: 'Stok Rendah',  val: stocks.filter(x => x.stockQty < 10).length, color: 'var(--danger)'  },
                { icon: <Clock        size={16} />, label: 'Item Open PO', val: poProducts.length,                          color: '#A84F10'        },
              ].map((c, i) => (
                <div key={i} className="card p-4">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3"
                    style={{ background: 'var(--accent-bg)', color: c.color }}>
                    {c.icon}
                  </div>
                  <p className="text-xl font-extrabold tabular" style={{ color: c.color }}>{c.val}</p>
                  <p className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                </div>
              ))}
            </div>

            {stockLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : mergedStocks.length === 0 ? (
              <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <Package size={24} style={{ color: 'var(--accent)', margin: '0 auto 10px', display: 'block' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada stok</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tambahkan stok lewat menu <strong>Masuk</strong>.</p>
              </div>
            ) : (() => {
              const withCat = mergedStocks.map(s => ({ ...s, category: products.find(p => p.id === s.productId)?.category ?? '' }));
              const catLabel = (id: string) => categories.find(c => c.id === id)?.label ?? id;
              const catEmoji = (id: string) => categories.find(c => c.id === id)?.emoji ?? '🏷️';
              const catIds = Array.from(new Set(withCat.map(s => s.category).filter(Boolean)));
              const catCounts = catIds.map(id => ({ id, label: catLabel(id), emoji: catEmoji(id), count: withCat.filter(s => s.category === id).length }));
              const visible = stockCatFilter === 'semua' ? withCat : withCat.filter(s => s.category === stockCatFilter);

              return (
                <>
                  {catCounts.length > 0 && (
                    <ScrollChips className="mb-4">
                      <button onClick={() => setStockCatFilter('semua')}
                        className={`tab-chip text-xs py-1.5 ${stockCatFilter === 'semua' ? 'active' : ''}`}>
                        Semua ({withCat.length})
                      </button>
                      {catCounts.map(c => (
                        <button key={c.id} onClick={() => setStockCatFilter(c.id)}
                          className={`tab-chip text-xs py-1.5 ${stockCatFilter === c.id ? 'active' : ''}`}>
                          {c.emoji} {c.label} ({c.count})
                        </button>
                      ))}
                    </ScrollChips>
                  )}

                  {visible.length === 0 ? (
                    <div className="rounded-2xl p-12 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Tidak ada produk di kategori ini.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {visible.map(s => {
                        const prod    = products.find(p => p.id === s.productId);
                        const hasImg  = !!prod?.imageUrls?.length;
                        const emoji   = prod?.emoji   ?? '📦';
                        const bgColor = prod?.bgColor ?? '#F5F0E9';
                        const qty     = s.stockQty;
                        const isPO    = poIds.has(s.productId);
                        const qtyStyle = qty === 0
                          ? { bg: '#FEF2F2', color: '#DC2626', border: '#FECACA' }
                          : qty < 10
                            ? { bg: '#FDF0E6', color: '#A84F10', border: 'rgba(212,105,30,0.25)' }
                            : { bg: '#F0FDF4', color: '#15803D', border: '#D1FAE5' };
                        return (
                          <div key={s.productId} className="card overflow-hidden flex flex-col select-none">
                            <div className="relative w-full aspect-square" style={{ background: `${bgColor}22` }}>
                              <ImageCarousel
                                imageUrls={prod?.imageUrls}
                                emoji={emoji}
                                alt={s.productName}
                                sizes="(max-width: 640px) 50vw, 200px"
                                emojiClassName="text-4xl"
                              />
                              <div className="absolute top-2 right-2 text-[10px] font-black px-2 py-0.5 rounded-full"
                                style={{ background: qtyStyle.bg, color: qtyStyle.color, border: `1px solid ${qtyStyle.border}` }}>
                                {qty} unit
                              </div>
                              {isPO ? (
                                <span className="badge badge-amber absolute top-2 left-2 text-[10px]">Open PO</span>
                              ) : !hasImg && (
                                <div className="absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center"
                                  style={{ background: 'rgba(0,0,0,0.35)' }} title="Belum ada foto">
                                  <ImageIcon size={10} color="#fff" />
                                </div>
                              )}
                            </div>
                            <div className="px-3 pt-2 pb-3">
                              <p className="text-[11px] font-bold leading-snug line-clamp-2"
                                style={{ color: 'var(--text-primary)' }}>
                                {s.productName}
                              </p>
                              <div className="flex items-center justify-between gap-1.5 mt-1.5">
                                {s.category ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                    style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                                    <span style={{ fontSize: 9, lineHeight: 1 }}>{catEmoji(s.category)}</span>
                                    {catLabel(s.category)}
                                  </span>
                                ) : <span />}
                                {qty > 0 && (
                                  <button onClick={() => clearProductStock(s.productId, s.productName)}
                                    disabled={clearingId === s.productId}
                                    className="btn-ghost p-1 flex-shrink-0" style={{ color: 'var(--danger)' }}
                                    title="Kosongkan Stok">
                                    {clearingId === s.productId ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* ════ MASUK ═══════════════════════════════════════════ */}
        {subTab === 'masuk' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {inTx.length > 0 && (
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={masukSearch}
                    onChange={e => { setMasukSearch(e.target.value); setMasukPage(1); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari produk, gudang, atau catatan…"
                  />
                </div>
              )}
              <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0 w-full sm:w-auto">
                <div className="flex items-center gap-2">
                  <button onClick={loadTx} className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }} title="Refresh">
                    <RefreshCw size={14} className={txLoading ? 'animate-spin' : ''} />
                  </button>
                  {inTx.length > 0 && <ViewToggle mode={historyView} onChange={setHistoryView} height={HEADER_BTN_H} />}
                </div>
                <button onClick={() => openTxModal('in')} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Stok Masuk</span><span className="sm:hidden">Tambah</span>
                </button>
              </div>
            </div>

            {txLoading && inTx.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : inTx.length === 0 ? (
              <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <TrendingUp size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada transaksi stok masuk</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Catat penerimaan barang dari supplier atau penambahan stok</p>
              </div>
            ) : paginatedMasuk.length === 0 ? (
              <div className="card py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada transaksi yang cocok.</p>
              </div>
            ) : (
              <>
                <TxList entries={paginatedMasuk} loading={false} emptyLabel="Belum ada transaksi stok masuk"
                  warehouses={warehouses} products={products} view={historyView}
                  startIndex={(safeMasukPage - 1) * masukPageSize} />
                <Pagination total={filteredMasuk.length} safePage={safeMasukPage} totalPages={totalMasukPages}
                  pageSize={masukPageSize} onPageSize={n => { setMasukPageSize(n); setMasukPage(1); }}
                  onGoPage={goMasukPage} unit="transaksi" />
              </>
            )}
          </div>
        )}

        {/* ════ KELUAR ══════════════════════════════════════════ */}
        {subTab === 'keluar' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {outTx.length > 0 && (
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={keluarSearch}
                    onChange={e => { setKeluarSearch(e.target.value); setKeluarPage(1); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari produk, gudang, atau catatan…"
                  />
                </div>
              )}
              <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0 w-full sm:w-auto">
                <div className="flex items-center gap-2">
                  <button onClick={loadTx} className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }} title="Refresh">
                    <RefreshCw size={14} className={txLoading ? 'animate-spin' : ''} />
                  </button>
                  {outTx.length > 0 && <ViewToggle mode={historyView} onChange={setHistoryView} height={HEADER_BTN_H} />}
                </div>
                <button onClick={() => openTxModal('out')} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H, background: 'linear-gradient(135deg,#DC2626,#B91C1C)' }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Stok Keluar</span><span className="sm:hidden">Tambah</span>
                </button>
              </div>
            </div>

            {txLoading && outTx.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : outTx.length === 0 ? (
              <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <TrendingDown size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada transaksi stok keluar</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Catat pengurangan stok — rusak, terpakai, retur, dll.</p>
              </div>
            ) : paginatedKeluar.length === 0 ? (
              <div className="card py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada transaksi yang cocok.</p>
              </div>
            ) : (
              <>
                <TxList entries={paginatedKeluar} loading={false} emptyLabel="Belum ada transaksi stok keluar"
                  warehouses={warehouses} products={products} view={historyView}
                  startIndex={(safeKeluarPage - 1) * keluarPageSize} />
                <Pagination total={filteredKeluar.length} safePage={safeKeluarPage} totalPages={totalKeluarPages}
                  pageSize={keluarPageSize} onPageSize={n => { setKeluarPageSize(n); setKeluarPage(1); }}
                  onGoPage={goKeluarPage} unit="transaksi" />
              </>
            )}
          </div>
        )}

        {/* ════ TRANSFER ════════════════════════════════════════ */}
        {subTab === 'transfer' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {transferTx.length > 0 && (
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={transferSearch}
                    onChange={e => { setTransferSearch(e.target.value); setTransferPage(1); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari produk, gudang, atau catatan…"
                  />
                </div>
              )}
              <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0 w-full sm:w-auto">
                <div className="flex items-center gap-2">
                  <button onClick={loadTx} className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }} title="Refresh">
                    <RefreshCw size={14} className={txLoading ? 'animate-spin' : ''} />
                  </button>
                  {transferTx.length > 0 && <ViewToggle mode={historyView} onChange={setHistoryView} height={HEADER_BTN_H} />}
                </div>
                <button onClick={openTransferModal} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H, background: 'linear-gradient(135deg,#0284C7,#0369A1)' }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Transfer</span><span className="sm:hidden">Tambah</span>
                </button>
              </div>
            </div>

            {txLoading && transferTx.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : transferTx.length === 0 ? (
              <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <ArrowLeftRight size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada transaksi transfer</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Pindahkan stok dari satu gudang ke gudang lain</p>
              </div>
            ) : paginatedTransfer.length === 0 ? (
              <div className="card py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada transaksi yang cocok.</p>
              </div>
            ) : (
              <>
                <TxList entries={paginatedTransfer} loading={false} emptyLabel="Belum ada transaksi transfer"
                  warehouses={warehouses} products={products} view={historyView}
                  startIndex={(safeTransferPage - 1) * transferPageSize} />
                <Pagination total={filteredTransfer.length} safePage={safeTransferPage} totalPages={totalTransferPages}
                  pageSize={transferPageSize} onPageSize={n => { setTransferPageSize(n); setTransferPage(1); }}
                  onGoPage={goTransferPage} unit="transaksi" />
              </>
            )}
          </div>
        )}

        {/* ════ LAPORAN ═════════════════════════════════════════ */}
        {subTab === 'laporan' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            <TopbarPortal>
              <button onClick={exportReportExcel} disabled={exportingReport} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Export Excel">
                {exportingReport ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
              </button>
              <button onClick={() => { loadReportLedger(); loadAllWhStocks(); }}
                className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
                <RefreshCw size={14} className={(reportLedgerLoading || allWhStocksLoading) ? 'animate-spin' : ''} />
              </button>
            </TopbarPortal>

            {/* Pemilih periode */}
            <div className="flex flex-wrap items-center gap-2">
              {REPORT_PERIOD_OPTIONS.map(p => (
                <button key={p.id} onClick={() => setReportPeriod(p.id)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
                  style={reportPeriod === p.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  {p.label}
                </button>
              ))}
              {reportPeriod === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={reportCustomFrom} onChange={e => setReportCustomFrom(e.target.value)} className="input" style={{ height: 36 }} />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
                  <input type="date" value={reportCustomTo} onChange={e => setReportCustomTo(e.target.value)} className="input" style={{ height: 36 }} />
                </div>
              )}
            </div>

            {/* Filter gudang */}
            <ScrollChips>
              <button onClick={() => setReportWhFilter('semua')} className={`tab-chip text-xs py-1.5 ${reportWhFilter === 'semua' ? 'active' : ''}`}>
                <Warehouse size={11} /> Semua Gudang
              </button>
              {warehouses.map(w => (
                <button key={w.id} onClick={() => setReportWhFilter(w.id)} className={`tab-chip text-xs py-1.5 ${reportWhFilter === w.id ? 'active' : ''}`}>
                  {w.name}
                </button>
              ))}
            </ScrollChips>

            {/* Ringkasan stok saat ini */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                Ringkasan Stok Saat Ini — {reportWhLabel}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { icon: <Wallet size={16} />, label: 'Nilai Stok (HPP)', val: formatRp(reportTotalNilai), color: 'var(--accent)' },
                  { icon: <Boxes size={16} />, label: 'Total Unit', val: reportTotalUnit, color: '#0284C7' },
                  { icon: <Package size={16} />, label: 'Jenis Produk', val: reportJenisProduk, color: 'var(--success)' },
                  { icon: <AlertTriangle size={16} />, label: 'Stok Rendah', val: reportRendahCount, color: '#A84F10' },
                  { icon: <Ban size={16} />, label: 'Stok Habis', val: reportHabisCount, color: 'var(--danger)' },
                ].map((c, i) => (
                  <div key={i} className="card p-4">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3" style={{ background: 'var(--accent-bg)', color: c.color }}>
                      {c.icon}
                    </div>
                    <p className="text-xl font-extrabold tabular" style={{ color: c.color }}>{c.val}</p>
                    <p className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Ringkasan mutasi periode */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                Mutasi Periode {reportPeriodLabel} ({reportFrom} s/d {reportTo})
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { icon: <TrendingUp size={16} />, label: 'Stok Masuk', val: `+${reportMasukQty}`, color: 'var(--success)' },
                  { icon: <TrendingDown size={16} />, label: 'Stok Keluar', val: `–${reportKeluarQty}`, color: 'var(--danger)' },
                  { icon: <ArrowLeftRight size={16} />, label: 'Transfer', val: reportTransferCt, color: '#0284C7' },
                  { icon: reportNetQty >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />, label: 'Net Perubahan',
                    val: `${reportNetQty >= 0 ? '+' : ''}${reportNetQty}`, color: reportNetQty >= 0 ? 'var(--success)' : 'var(--danger)' },
                ].map((c, i) => (
                  <div key={i} className="card p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: c.color }}>
                      {c.icon}
                    </div>
                    <div>
                      <p className="text-lg font-extrabold tabular leading-none" style={{ color: c.color }}>{c.val}</p>
                      <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detail per produk */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-sm font-bold flex-1" style={{ color: 'var(--text-primary)' }}>Detail Stok per Produk</p>
                <div className="relative sm:max-w-xs">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input value={reportSearch} onChange={e => { setReportSearch(e.target.value); setReportPage(1); }}
                    className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder="Cari produk…" />
                </div>
              </div>

              {reportCatCounts.length > 0 && (
                <ScrollChips>
                  <button onClick={() => { setReportCatFilter('semua'); setReportPage(1); }}
                    className={`tab-chip text-xs py-1.5 ${reportCatFilter === 'semua' ? 'active' : ''}`}>
                    Semua ({reportRowsAll.length})
                  </button>
                  {reportCatCounts.map(c => (
                    <button key={c.id} onClick={() => { setReportCatFilter(c.id); setReportPage(1); }}
                      className={`tab-chip text-xs py-1.5 ${reportCatFilter === c.id ? 'active' : ''}`}>
                      {c.emoji} {c.label} ({c.count})
                    </button>
                  ))}
                </ScrollChips>
              )}

              {paginatedReportRows.length === 0 ? (
                <div className="card py-12 text-center">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada produk yang cocok.</p>
                </div>
              ) : (
                <>
                  <ReportTable rows={paginatedReportRows} categories={categories} startIndex={(safeReportPage - 1) * reportPageSize} />
                  <Pagination total={reportDisplayRows.length} safePage={safeReportPage} totalPages={totalReportPages}
                    pageSize={reportPageSize} onPageSize={n => { setReportPageSize(n); setReportPage(1); }}
                    onGoPage={goReportPage} unit="produk" />
                </>
              )}
            </div>

            {/* Riwayat mutasi periode */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Riwayat Mutasi — {reportWhLabel}</p>
                <ViewToggle mode={historyView} onChange={setHistoryView} height={HEADER_BTN_H} />
              </div>
              {reportLedgerLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
                </div>
              ) : (
                <>
                  <TxList entries={paginatedReportTx} loading={false} emptyLabel="Tidak ada mutasi stok di periode ini"
                    warehouses={warehouses} products={products} view={historyView}
                    startIndex={(safeReportTxPage - 1) * reportTxPageSize} />
                  <Pagination total={reportLedgerSorted.length} safePage={safeReportTxPage} totalPages={totalReportTxPages}
                    pageSize={reportTxPageSize} onPageSize={n => { setReportTxPageSize(n); setReportTxPage(1); }}
                    onGoPage={goReportTxPage} unit="mutasi" />
                </>
              )}
            </div>
          </div>
        )}

        {showTxModal && (
          <TxModal
            type={showTxModal}
            warehouseOptions={warehouseOptions}
            productOptions={productOptions}
            wId={txWId} pId={txPId} qty={txQty} note={txNote} noWarehouse={txNoWarehouse}
            onWId={setTxWId} onPId={setTxPId} onQty={setTxQty} onNote={setTxNote} onNoWarehouse={setTxNoWarehouse}
            submitting={txSubmitting}
            onClose={() => setShowTxModal(null)}
            onSubmit={() => submitTx(showTxModal)}
          />
        )}

        {showTransferModal && (
          <TransferModal
            warehouseOptions={warehouseOptions}
            productOptions={productOptions}
            fromWId={fromWId} toWId={toWId} pId={trPId} qty={trQty} note={trNote}
            onFromWId={setFromWId} onToWId={setToWId} onPId={setTrPId} onQty={setTrQty} onNote={setTrNote}
            submitting={trSubmitting}
            onClose={() => setShowTransferModal(false)}
            onSubmit={submitTransfer}
          />
        )}

      </div>
    </div>
  );
}
