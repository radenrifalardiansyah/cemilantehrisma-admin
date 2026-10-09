'use client';

import { Plus, Minus } from 'lucide-react';
import ImageCarousel from '@/components/ImageCarousel';
import Tooltip from '@/components/Tooltip';
import { rupiah, qtyText } from '../titip-jual/shared';
import type { CatalogItem } from './types';

export const itemEmoji = (i: CatalogItem) => i.emoji || (i.kind === 'consign' ? '🛍️' : '📦');

// Kartu produk Kasir Lapak — bentuknya mengikuti kartu produk Kasir toko: gambar persegi, lencana
// stok, jumlah di keranjang, tombol plus, dan stepper.
export default function StallProductCard({ item, qty, disabled, onAdd, onMinus }: {
  item: CatalogItem; qty: number; disabled: boolean; onAdd: () => void; onMinus: () => void;
}) {
  const out = item.stock <= 0;
  const off = disabled || out || !!item.blocked;
  return (
    <div className={`card overflow-hidden flex flex-col select-none transition-transform ${off ? '' : 'active:scale-[0.97] cursor-pointer'}`}
      style={{ opacity: disabled && !out ? 0.6 : 1 }} onClick={off ? undefined : onAdd} title={item.blocked || item.description || undefined}>
      <div className="relative w-full aspect-square overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <ImageCarousel imageUrls={item.imageUrl ? [item.imageUrl] : []} emoji={itemEmoji(item)} alt={item.name}
          sizes="(max-width: 640px) 50vw, 200px" emojiClassName="text-4xl"
          innerStyle={{ filter: out ? 'grayscale(0.8) blur(3px)' : undefined, opacity: out ? 0.55 : 1, transition: 'filter 0.15s, opacity 0.15s' }} />
        {item.kind === 'consign' && <span className="absolute top-2 left-2 badge badge-amber" style={{ fontSize: 10 }}>Titipan</span>}
        {out && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="badge badge-red" style={{ fontSize: 11 }}>Stok Habis</span>
          </div>
        )}
        {qty > 0 && <div className="absolute inset-0 bg-black/15 pointer-events-none" />}
        {qty > 0 && (
          <div className="absolute top-2 right-2 min-w-[24px] h-6 rounded-full text-white text-[11px] font-black flex items-center justify-center px-1.5 shadow ring-2 ring-white" style={{ background: 'var(--accent)' }}>
            {qtyText(qty)}
          </div>
        )}
        {qty === 0 && !off && (
          <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
            <Plus size={13} className="text-white" strokeWidth={2.5} />
          </div>
        )}
      </div>
      <div className="px-3 pt-2 pb-3 flex flex-col flex-1 gap-1.5">
        <p className="text-[11px] font-bold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
        {(item.weight || item.consignorName) && (
          <p className="text-[10px] truncate -mt-1" style={{ color: 'var(--text-muted)' }}>
            {[item.weight, item.consignorName].filter(Boolean).join(' · ')}
          </p>
        )}
        {item.blocked
          ? <span className="badge badge-red self-start" style={{ fontSize: 10 }}>{item.blocked}</span>
          : !out && <span className="badge badge-green self-start" style={{ fontSize: 10 }}>Stok · {qtyText(item.stock)} {item.unit}</span>}
        <div className="flex items-center justify-between mt-auto">
          <span className="text-[13px] font-black tabular" style={{ color: 'var(--accent)' }}>{rupiah(item.price)}</span>
          {qty > 0 && (
            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              <Tooltip label="Kurangi jumlah">
                <button onClick={e => { e.stopPropagation(); onMinus(); }} className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}><Minus size={10} strokeWidth={2.5} /></button>
              </Tooltip>
              <span className="text-[13px] font-black w-5 text-center tabular" style={{ color: 'var(--text-primary)' }}>{qtyText(qty)}</span>
              <Tooltip label="Tambah jumlah">
                <button onClick={e => { e.stopPropagation(); onAdd(); }} disabled={qty >= item.stock} className="w-6 h-6 rounded-full text-white flex items-center justify-center disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}><Plus size={10} strokeWidth={2.5} /></button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
