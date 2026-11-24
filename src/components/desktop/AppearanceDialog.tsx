'use client';

import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Palette, Rows2, Rows3, Rows4, X } from 'lucide-react';
import Modal from '@/components/Modal';
import {
  ACCENTS, ACCENT_META, DENSITIES, DENSITY_LABELS, TEXT_SIZES, TEXT_SIZE_LABELS, WALLPAPER_IDS, WALLPAPER_LABELS,
  type Appearance,
} from '@/lib/appearance';
import { wallpaperBackground } from '@/lib/wallpapers';

export interface AppearanceDialogProps {
  /** Nilai yang sedang dipratinjau. */
  value: Appearance;
  /** Nilai yang tersimpan; Simpan nonaktif bila sama dengan `value`. */
  saved: Appearance;
  busy?: boolean;
  /** Pratinjau langsung; ditangani induk. */
  onChange: (patch: Partial<Appearance>) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
}

const DENSITY_ICONS = { compact: Rows4, standard: Rows3, relaxed: Rows2 } as const;
const TEXT_SIZE_PX = { small: 12, standard: 15, large: 19 } as const;

const sectionLabel: CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10,
};

// Radiogroup dengan roving tabindex: hanya pilihan terpilih yang dapat di-Tab, panah memindah + memilih.
function RadioGroup<T extends string>({ label, ids, value, onPick, className, children }: {
  label: string; ids: readonly T[]; value: T; onPick: (id: T) => void; className: string;
  children: (id: T, selected: boolean, props: {
    role: 'radio'; 'aria-checked': boolean; tabIndex: number; onClick: () => void; type: 'button';
  }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = ids[(ids.indexOf(value) + dir + ids.length) % ids.length];
    onPick(next);
    requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[ids.indexOf(next)]?.focus());
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={className} onKeyDown={onKeyDown}>
      {ids.map(id => children(id, id === value, {
        type: 'button', role: 'radio', 'aria-checked': id === value, tabIndex: id === value ? 0 : -1, onClick: () => onPick(id),
      }))}
    </div>
  );
}

const optionBase: CSSProperties = {
  minHeight: 44, borderRadius: 12, cursor: 'pointer', transition: 'border-color .15s, background .15s, box-shadow .15s',
  color: 'var(--text-primary)', fontFamily: 'inherit',
};
const borderOf = (on: boolean) => `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`;

export default function AppearanceDialog({ value, saved, busy, onChange, onSave, onCancel, onReset }: AppearanceDialogProps) {
  const unchanged = (Object.keys(value) as (keyof Appearance)[]).every(k => value[k] === saved[k]);
  const accentSwatch = ACCENT_META[value.accent].swatch;

  return (
    <Modal onClose={busy ? undefined : onCancel} className="modal-md dsk-ap-dialog">
      <div className="modal-accent" />
      <span className="modal-handle" />
      <div className="modal-header">
        <div className="modal-header-left">
          <div className="modal-icon"><Palette size={17} aria-hidden /></div>
          <div style={{ minWidth: 0 }}>
            <div className="modal-title">Tampilan</div>
            <div className="modal-subtitle">Berlaku untuk akun Anda di mode Desktop</div>
          </div>
        </div>
        <button type="button" onClick={onCancel} disabled={busy} className="modal-close" aria-label="Tutup"><X size={14} /></button>
      </div>

      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <section>
          <div style={sectionLabel} id="dsk-ap-accent">WARNA DASAR</div>
          <RadioGroup label="Warna dasar" ids={ACCENTS} value={value.accent} onPick={accent => onChange({ accent })} className="grid grid-cols-2 min-[420px]:grid-cols-3 gap-2">
            {(id, on, p) => (
              <button key={id} {...p} style={{ ...optionBase, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: borderOf(on), background: on ? 'var(--accent-bg)' : 'var(--surface)', fontSize: 13, fontWeight: on ? 700 : 500 }}>
                <span aria-hidden style={{ width: 22, height: 22, borderRadius: '50%', background: ACCENT_META[id].swatch, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)' }}>
                  {on && <Check size={13} strokeWidth={3} />}
                </span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ACCENT_META[id].label}</span>
              </button>
            )}
          </RadioGroup>
        </section>

        <section>
          <div style={sectionLabel}>LATAR DESKTOP</div>
          <RadioGroup label="Latar desktop" ids={WALLPAPER_IDS} value={value.wallpaper} onPick={wallpaper => onChange({ wallpaper })} className="grid grid-cols-3 gap-x-2.5 gap-y-3">
            {(id, on, p) => (
              <button key={id} {...p} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit', minHeight: 44 }}>
                <span style={{ position: 'relative', display: 'block', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: wallpaperBackground(id, id === 'gradient' ? undefined : accentSwatch), boxShadow: on ? '0 0 0 2px var(--surface), 0 0 0 4px var(--accent)' : 'inset 0 0 0 1px var(--border)', transition: 'box-shadow .15s' }}>
                  {on && (
                    <span aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.28)' }}>
                      <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={14} strokeWidth={3} /></span>
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', marginTop: 6, fontSize: 12, fontWeight: on ? 700 : 500, color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}>{WALLPAPER_LABELS[id]}</span>
              </button>
            )}
          </RadioGroup>
        </section>

        <section>
          <div style={sectionLabel}>KERAPATAN</div>
          <RadioGroup label="Kerapatan" ids={DENSITIES} value={value.density} onPick={density => onChange({ density })} className="grid grid-cols-3 gap-2">
            {(id, on, p) => {
              const Icon = DENSITY_ICONS[id];
              return (
                <button key={id} {...p} style={{ ...optionBase, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 6px', border: borderOf(on), background: on ? 'var(--accent-bg)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--text-primary)', fontSize: 13, fontWeight: on ? 700 : 500 }}>
                  <Icon size={15} aria-hidden /> {DENSITY_LABELS[id]}
                </button>
              );
            }}
          </RadioGroup>
        </section>

        <section>
          <div style={sectionLabel}>UKURAN TEKS</div>
          <RadioGroup label="Ukuran teks" ids={TEXT_SIZES} value={value.textSize} onPick={textSize => onChange({ textSize })} className="grid grid-cols-3 gap-2">
            {(id, on, p) => (
              <button key={id} {...p} style={{ ...optionBase, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0, padding: '6px', minHeight: 56, border: borderOf(on), background: on ? 'var(--accent-bg)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--text-primary)' }}>
                <span aria-hidden style={{ fontSize: TEXT_SIZE_PX[id], fontWeight: 700, lineHeight: 1.2 }}>Aa</span>
                <span style={{ fontSize: 11, fontWeight: on ? 700 : 500, color: on ? 'var(--accent)' : 'var(--text-muted)' }}>{TEXT_SIZE_LABELS[id]}</span>
              </button>
            )}
          </RadioGroup>
        </section>

        <p role="note" style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border-2)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Warna &amp; latar langsung terlihat. Pengaturan tersimpan di akun Anda.
        </p>
      </div>

      <div className="modal-footer" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={onReset} disabled={busy} className="dsk-ap-reset" style={{ background: 'none', border: 0, padding: '10px 4px', minHeight: 40, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textDecoration: 'underline', textUnderlineOffset: 3, opacity: busy ? 0.4 : 1 }}>
          Kembalikan default
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost" style={{ minHeight: 40 }}>Batal</button>
          <button type="button" onClick={onSave} disabled={busy || unchanged} className="btn-primary" style={{ minHeight: 40 }}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
        </div>
      </div>
    </Modal>
  );
}
