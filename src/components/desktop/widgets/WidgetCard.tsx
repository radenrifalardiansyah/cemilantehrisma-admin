'use client';

import type { HTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import type { WidgetSize } from '@/lib/widgets';

export interface WidgetCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  Icon: LucideIcon;
  title: string;
  size: WidgetSize;
  dragging?: boolean;
  /** Klik tombol titik tiga di header (membuka menu widget). */
  onMenu?: (e: MouseEvent<HTMLButtonElement>) => void;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

// Kerangka kartu widget: header kecil (ikon + judul + tombol menu) dan isi. Gaya kaca gelap konsisten dengan taskbar, aksen lewat var(--accent).
// Seret dimulai dari mana saja di kartu kecuali elemen interaktif (diatur WidgetLayer). Kartu fokusable (tabindex 0) untuk akses keyboard.
export default function WidgetCard({ Icon, title, size, dragging, onMenu, ref, children, className, ...rest }: WidgetCardProps) {
  return (
    <div ref={ref} className={`dsk-wg${className ? ` ${className}` : ''}`} data-size={size} data-dragging={dragging ? 'true' : undefined} tabIndex={0} role="group" aria-label={title} {...rest}>
      <div className="dsk-wg-head">
        <Icon size={13} aria-hidden="true" />
        <span className="dsk-wg-title">{title}</span>
        {onMenu && (
          <button type="button" className="dsk-wg-menu" aria-label={`Menu widget ${title}`} aria-haspopup="menu" onClick={onMenu}>
            <MoreHorizontal size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="dsk-wg-body">{children}</div>
    </div>
  );
}
