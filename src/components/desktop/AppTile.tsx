import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

// Ikon squircle bergradasi; ikon diambil dari data menu (resolveIcon), warna per modul.
export default function AppTile({ Icon, color, size }: { Icon: LucideIcon; color: string; size?: number }) {
  const style = { '--c': color, ...(size ? { width: size, height: size } : {}) } as CSSProperties;
  return (
    <span className="dsk-tile" style={style} aria-hidden="true">
      <Icon strokeWidth={2} />
    </span>
  );
}
