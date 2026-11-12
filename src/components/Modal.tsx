'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Tumpukan lapisan yang menangani Esc (modal, lightbox, ...). Hanya lapisan paling atas yang bereaksi,
// jadi modal di atas modal menutup satu per satu. Popover pemilih (SearchSelect, DateInput, dst.) menangani
// Esc sendiri dan menandai panelnya dengan `data-popover-layer`; selama ada, Esc dibiarkan untuk popover.
// Urutan lapisan ditentukan `seq` yang diambil saat render pertama (render berjalan induk-sebelum-anak,
// berbeda dengan efek yang anak-sebelum-induk), jadi modal anak yang ter-mount sekommit dengan induknya tetap di atas.
interface Layer { seq: number }
const layers: Layer[] = []; // terurut menaik menurut seq; elemen terakhir = teratas
let layerSeq = 0;
const POPOVER_SELECTOR = '[data-popover-layer]';

/** Daftarkan lapisan Esc. `onEscape` undefined = lapisan tetap memblokir Esc untuk lapisan di bawahnya, tapi tidak menutup apa pun. */
export function useEscapeLayer(onEscape: (() => void) | undefined) {
  const handlerRef = useRef(onEscape);
  // Initializer render-time; render yang dibuang/dobel (StrictMode) hanya menyisakan celah nomor, urutan tetap benar.
  const [token] = useState<Layer>(() => ({ seq: ++layerSeq }));
  useLayoutEffect(() => { handlerRef.current = onEscape; });

  useEffect(() => {
    let i = layers.length;
    while (i > 0 && layers[i - 1].seq > token.seq) i--;
    layers.splice(i, 0, token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (layers[layers.length - 1] !== token) return;
      if (document.querySelector(POPOVER_SELECTOR)) return;
      handlerRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const j = layers.indexOf(token);
      if (j >= 0) layers.splice(j, 1);
    };
  }, [token]);

  /** true bila lapisan ini yang paling atas saat ini. */
  return () => layers[layers.length - 1] === token;
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

  // aria-labelledby mengikuti `.modal-title` yang ada saat ini: dihitung ulang tiap render Modal dan
  // tiap perubahan DOM di dalam sheet (judul muncul belakangan, atau elemennya diganti).
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const sync = () => {
      const title = sheet.querySelector<HTMLElement>('.modal-title');
      if (title) {
        if (!title.id) title.id = `${uid}-title`;
        if (sheet.getAttribute('aria-labelledby') !== title.id) sheet.setAttribute('aria-labelledby', title.id);
      } else if (sheet.hasAttribute('aria-labelledby')) {
        sheet.removeAttribute('aria-labelledby');
      }
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(sheet, { childList: true, subtree: true });
    return () => mo.disconnect();
  });

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (!sheet.contains(document.activeElement)) sheet.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if ((!active || active === document.body) && trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [trigger]);

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
