'use client';

import { Star } from 'lucide-react';
import AppTile from './AppTile';
import type { DesktopItem } from './types';

// Bagian "Disematkan" menu Mulai (ala Windows 11): grid 6 kolom ubin ikon + label di bawah. Urutan = urutan disematkan.
// Klik ubin membuka menu (tidak mengubah pin); bintang kecil (muncul saat hover/fokus) melepas pin. `data-menu-tab` disediakan untuk menu klik kanan.
export default function StartPinned({ items, onPick, onTogglePin }: {
  items: DesktopItem[];
  onPick: (item: DesktopItem) => void;
  onTogglePin?: (tab: string) => void;
}) {
  return (
    <section className="dsk-pinned" aria-label="Disematkan">
      <h4>Disematkan</h4>
      {items.length === 0 ? (
        <p className="dsk-phint">Sematkan menu dengan bintang di daftar di bawah</p>
      ) : (
        <div className="dsk-pgrid">
          {items.map(i => (
            // Bintang = tombol SAUDARA dari tombol ubin (bukan bersarang): klik bintang hanya melepas, tidak membuka menu.
            <div key={i.tab} className="dsk-pt" data-menu-tab={i.tab}>
              <button type="button" className="dsk-pb" onClick={() => onPick(i)} title={i.label}>
                <AppTile Icon={i.Icon} color={i.color} />
                <span className="lbl">{i.label}</span>
                {i.badge > 0 && <span className="dsk-badge" aria-label={`${i.badge} baru`}>{i.badge > 99 ? '99+' : i.badge}</span>}
              </button>
              {onTogglePin && (
                <button type="button" className="dsk-pstar" aria-label={`Lepas ${i.label} dari desktop`} title="Lepas dari desktop" onClick={() => onTogglePin(i.tab)}>
                  <Star size={12} fill="currentColor" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
