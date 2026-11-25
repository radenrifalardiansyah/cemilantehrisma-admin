import AppTile from './AppTile';
import type { DesktopItem } from './types';

// Ikon di meja (skin Windows): hanya menu berjendela; menu lain ada di menu Mulai.
export default function DesktopIcons({ items, onOpen, onItemContext }: {
  items: DesktopItem[]; onOpen: (item: DesktopItem) => void;
  /** Klik kanan / tombol Menu pada ikon: membuka menu konteks ikon. */
  onItemContext?: (item: DesktopItem, e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="dsk-icons">
      {items.map(i => (
        <button key={i.tab} type="button" className="dsk-ico" onClick={() => onOpen(i)} aria-label={`Buka ${i.label}`}
          onContextMenu={onItemContext ? e => { e.preventDefault(); onItemContext(i, e); } : undefined}>
          <AppTile Icon={i.Icon} color={i.color} />
          <span>{i.label}</span>
          {i.badge > 0 && <span className="dsk-badge" aria-hidden="true">{i.badge > 99 ? '99+' : i.badge}</span>}
        </button>
      ))}
    </div>
  );
}
