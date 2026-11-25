'use client';

import { useMemo, useState } from 'react';
import { Layers, LogOut, Monitor, Palette, Star, X } from 'lucide-react';
import { useEscapeLayer } from '@/components/Modal';
import type { UiLayout } from '@/lib/ui-layout';
import { AccountPopover } from './AccountMenu';
import AppTile from './AppTile';
import LayoutPicker from './LayoutPicker';
import StartPinned from './StartPinned';
import type { DesktopGroup, DesktopItem } from './types';

// Panel menu bersama: "Mulai" (Windows) dan "Launchpad" (Mac). Memuat SEMUA menu yang boleh dilihat pengguna;
// yang belum berjendela ditandai "Klasik". Esc / klik di luar menutup.
/** Data akun untuk baris pengguna + tombol Keluar di footer menu Mulai (Launchpad tidak memakainya). */
export interface PanelAccount {
  username: string;
  avatar: string | null;
  roleLabel: string;
  storeUrl: string;
  onEditProfile: () => void;
  onAbout: () => void;
  onLogout: () => void;
  fullscreen?: { isFullscreen: boolean; onToggle: () => void };
}

interface Props {
  variant: 'start' | 'launchpad';
  groups: DesktopGroup[];
  layout: UiLayout;
  hasWindows: boolean;
  layoutBusy?: boolean;
  onPick: (item: DesktopItem) => void;
  onClose: () => void;
  onArrange: () => void;
  onCloseAll: () => void;
  onChangeLayout: (next: UiLayout) => void;
  onAppearance?: () => void;
  /** Menu yang sedang disematkan ke ikon meja/dock dan pengubahnya (tanpa pengubah = tanpa bintang). */
  pins?: ReadonlySet<string>;
  onTogglePin?: (tab: string) => void;
  /** Hanya varian Mulai: baris pengguna (menu akun) dan tombol Keluar. */
  account?: PanelAccount;
}

export default function AppMenuPanel({ variant, groups, layout, hasWindows, layoutBusy, onPick, onClose, onArrange, onCloseAll, onChangeLayout, onAppearance, pins, onTogglePin, account }: Props) {
  const [q, setQ] = useState('');
  const [showLayouts, setShowLayouts] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  useEscapeLayer(onClose);
  const isStart = variant === 'start';

  const query = q.trim().toLowerCase();
  const visible = useMemo(() => groups
    .map(g => ({ ...g, items: g.items.filter(i => !query || i.label.toLowerCase().includes(query) || g.label.toLowerCase().includes(query)) }))
    .filter(g => g.items.length > 0), [groups, query]);
  const firstMatch = visible[0]?.items[0];
  // Disematkan = pin efektif berurutan (Set menjaga urutan sisip); hanya yang berjendela dan masih ada di nav.
  const pinned = useMemo(() => {
    if (!pins) return [];
    const byTab = new Map(groups.flatMap(g => g.items).map(i => [i.tab, i]));
    return Array.from(pins).flatMap(t => { const it = byTab.get(t); return it && it.windowed ? [it] : []; });
  }, [pins, groups]);
  const showPinned = isStart && !!pins && !query;
  // Aksi menu akun dari dalam panel: tutup popover dulu, aksi yang membuka dialog juga menutup panel.
  const acct = account && {
    ...account,
    onEditProfile: () => { onClose(); account.onEditProfile(); },
    onAbout: () => { onClose(); account.onAbout(); },
    onLogout: () => { onClose(); account.onLogout(); },
    fullscreen: account.fullscreen && { isFullscreen: account.fullscreen.isFullscreen, onToggle: () => { onClose(); account.fullscreen!.onToggle(); } },
  };

  return (
    <>
      <div className="dsk-scrim" data-kind={variant} onPointerDown={onClose} />
      <div className="dsk-menu" data-variant={variant} role="dialog" aria-label={isStart ? 'Menu Mulai' : 'Launchpad'}
        onPointerDownCapture={e => { if (acctOpen && !(e.target as Element).closest('.dsk-pop, .dsk-muser')) setAcctOpen(false); }}>
        <input type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Cari menu…" aria-label="Cari menu" autoComplete="off"
          onKeyDown={e => { if (e.key === 'Enter' && firstMatch) onPick(firstMatch); }} />
        <div className="dsk-mscroll">
          {showPinned && <StartPinned items={pinned} onPick={onPick} onTogglePin={onTogglePin} />}
          {isStart && !query && visible.length > 0 && <h3 className="dsk-mall">Semua menu</h3>}
          {visible.length === 0 && <p className="dsk-empty">Tidak ada menu</p>}
          {visible.map(g => (
            <section key={g.id} className="dsk-mgrp" aria-label={g.label}>
              <h4>{g.label}</h4>
              <div className="dsk-mitems">
                {g.items.map(i => {
                  const starred = !!pins?.has(i.tab);
                  const canStar = !!onTogglePin && i.windowed;
                  return (
                    // Bintang = tombol SAUDARA (bukan di dalam tombol menu): klik bintang hanya menyematkan/melepas, tidak membuka menu.
                    <div key={i.tab} className="dsk-mrow" data-menu-tab={i.tab}>
                      {canStar && (
                        <button type="button" className="dsk-star" data-on={starred} aria-pressed={starred}
                          aria-label={starred ? `Lepas ${i.label} dari desktop` : `Sematkan ${i.label} ke desktop`}
                          title={starred ? 'Lepas dari desktop' : 'Sematkan ke desktop'} onClick={() => onTogglePin(i.tab)}>
                          <Star size={14} fill={starred ? 'currentColor' : 'none'} />
                        </button>
                      )}
                      <button type="button" className="dsk-mi" data-star={canStar} onClick={() => onPick(i)} title={i.windowed ? i.label : `${i.label} (dibuka dengan tampilan Klasik)`}>
                        <AppTile Icon={i.Icon} color={i.color} />
                        <span className="lbl">{i.label}</span>
                        {!i.windowed && <span className="tag">Klasik</span>}
                        {i.badge > 0 && <span className="dsk-badge" aria-label={`${i.badge} baru`}>{i.badge > 99 ? '99+' : i.badge}</span>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="dsk-mfoot">
          {showLayouts && <LayoutPicker compact value={layout} disabled={layoutBusy} onChange={onChangeLayout} />}
          {isStart && acct && acctOpen && <AccountPopover {...acct} side="panel" onAppearance={onAppearance && (() => { onClose(); onAppearance(); })} onClose={() => setAcctOpen(false)} />}
          <div className="main">
            {isStart && acct && (
              <button type="button" className="dsk-muser" aria-haspopup="menu" aria-expanded={acctOpen} onClick={() => setAcctOpen(o => !o)}>
                <span className="dsk-avatar" aria-hidden="true">
                  {acct.avatar
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={acct.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (acct.username[0] ?? '?').toUpperCase()}
                </span>
                <span className="who"><b>{acct.username}</b><small>{acct.roleLabel}</small></span>
              </button>
            )}
            <div className="row">
              {isStart && acct && <button type="button" aria-label="Keluar" title="Keluar" onClick={acct.onLogout}><LogOut size={16} /></button>}
              {onAppearance && <button type="button" aria-label="Personalisasi" title="Personalisasi" onClick={() => { onClose(); onAppearance(); }}><Palette size={16} /></button>}
              <button type="button" aria-label="Ganti tampilan" title="Ganti tampilan" aria-expanded={showLayouts} onClick={() => setShowLayouts(s => !s)}><Monitor size={16} /></button>
              <button type="button" aria-label="Susun ulang jendela" title="Susun ulang jendela" disabled={!hasWindows} onClick={() => { onArrange(); onClose(); }}><Layers size={16} /></button>
              <button type="button" aria-label="Tutup semua" title="Tutup semua" disabled={!hasWindows} onClick={() => { onCloseAll(); onClose(); }}><X size={16} /></button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
