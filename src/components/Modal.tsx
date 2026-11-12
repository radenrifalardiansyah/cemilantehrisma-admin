'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Tumpukan lapisan yang menangani Esc (modal, lightbox, ...). Hanya lapisan paling atas yang bereaksi,
// jadi modal di atas modal menutup satu per satu. Popover pemilih (SearchSelect, DateInput, dst.) menangani
// Esc sendiri dan menandai panelnya dengan `data-popover-layer`; selama ada, Esc dibiarkan untuk popover.
const layers: object[] = [];
const POPOVER_SELECTOR = '[data-popover-layer]';

/** Daftarkan lapisan Esc. `onEscape` undefined = lapisan tetap memblokir Esc untuk lapisan di bawahnya, tapi tidak menutup apa pun. */
export function useEscapeLayer(onEscape: (() => void) | undefined) {
  const handlerRef = useRef(onEscape);
  const tokenRef = useRef<object | null>(null);
  useLayoutEffect(() => { handlerRef.current = onEscape; });

  useEffect(() => {
    const token = {};
    tokenRef.current = token;
    layers.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (layers[layers.length - 1] !== token) return;
      if (document.querySelector(POPOVER_SELECTOR)) return;
      handlerRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = layers.indexOf(token);
      if (i >= 0) layers.splice(i, 1);
    };
  }, []);

  /** true bila lapisan ini yang paling atas saat ini. */
  return () => tokenRef.current !== null && layers[layers.length - 1] === tokenRef.current;
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
const getFocusable = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && !(el instanceof HTMLInputElement && el.type === 'hidden') && el.getClientRects().length > 0,
  );

interface ModalProps {
  /** Dipanggil saat Esc / klik di luar. Berikan handler yang SAMA dengan penutup yang sudah ada (termasuk guard `!saving && ...`). Kosong = tidak bisa ditutup. */
  onClose?: () => void;
  children: ReactNode;
  /** Kelas tambahan pada sheet, mis. "modal-sm" / "modal-lg" (kelas `modal-sheet` otomatis). */
  className?: string;
  style?: CSSProperties;
  /** Kelas tambahan pada overlay, mis. "confirm-overlay". */
  overlayClassName?: string;
  overlayStyle?: CSSProperties;
  role?: 'dialog' | 'alertdialog';
  /** Dipakai bila modal tidak punya elemen `.modal-title`. */
  ariaLabel?: string;
}

// Overlay + sheet modal dengan aksesibilitas: role=dialog, aria-modal, aria-labelledby ke `.modal-title`,
// Esc menutup (lapisan teratas saja), fokus awal ke dialog (atau elemen autofocus di dalamnya),
// focus trap sederhana, dan fokus dikembalikan ke pemicu saat ditutup.
export default function Modal({ onClose, children, className, style, overlayClassName, overlayStyle, role = 'dialog', ariaLabel }: ModalProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  // Dibaca saat render pertama (sebelum autoFocus anak mengambil fokus) supaya pemicunya tidak hilang.
  const [trigger] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null));

  const isTop = useEscapeLayer(onClose);
  const isTopRef = useRef(isTop);
  useLayoutEffect(() => { isTopRef.current = isTop; });

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const title = sheet.querySelector<HTMLElement>('.modal-title');
    if (title) {
      if (!title.id) title.id = `${uid}-title`;
      sheet.setAttribute('aria-labelledby', title.id);
    }
    if (!sheet.contains(document.activeElement)) sheet.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if ((!active || active === document.body) && trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [uid, trigger]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      // Hanya modal teratas yang menjebak fokus (modal bertingkat).
      if (!isTopRef.current()) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(POPOVER_SELECTOR)) return;
      const items = getFocusable(sheet);
      if (items.length === 0) { e.preventDefault(); sheet.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (!active || !sheet.contains(active) || active === sheet) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`modal-overlay${overlayClassName ? ` ${overlayClassName}` : ''}`} style={overlayStyle} onClick={onClose ? () => onClose() : undefined}>
      <div
        ref={sheetRef}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`modal-sheet${className ? ` ${className}` : ''}`}
        style={style}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
