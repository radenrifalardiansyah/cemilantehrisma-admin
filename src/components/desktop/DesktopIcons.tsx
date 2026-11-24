import AppTile from './AppTile';
import type { DesktopItem } from './types';

// Ikon di meja (skin Windows): hanya menu berjendela; menu lain ada di menu Mulai.
export default function DesktopIcons({ items, onOpen }: { items: DesktopItem[]; onOpen: (item: DesktopItem) => void }) {
  return (
    <div className="dsk-icons">
      {items.map(i => (
        <button key={i.tab} type="button" className="dsk-ico" onClick={() => onOpen(i)} aria-label={`Buka ${i.label}`}>
          <AppTile Icon={i.Icon} color={i.color} />
          <span>{i.label}</span>
          {i.badge > 0 && <span className="dsk-badge" aria-hidden="true">{i.badge > 99 ? '99+' : i.badge}</span>}
        </button>
      ))}
    </div>
  );
}
