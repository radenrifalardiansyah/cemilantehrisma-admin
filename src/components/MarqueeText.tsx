'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Teks satu baris yang BERJALAN (bergeser pelan ke kiri lalu kembali) hanya kalau teksnya lebih
// panjang dari ruang yang tersedia — teks pendek diam seperti biasa. Dipakai untuk label menu di
// sidebar supaya nama menu yang panjang tidak terpotong. Animasi dimatikan untuk pengguna yang
// memilih "kurangi gerakan" (prefers-reduced-motion), lihat .marquee-run di globals.css.
export default function MarqueeText({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => setShift(Math.max(0, Math.ceil(inner.scrollWidth - outer.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [children]);

  const run = shift > 0;
  const runStyle = run
    ? ({ '--marquee-shift': `-${shift + 6}px`, '--marquee-dur': `${Math.min(14, Math.max(6, shift / 14 + 4))}s` } as CSSProperties)
    : undefined;
  return (
    <span ref={outerRef} className={`block overflow-hidden whitespace-nowrap ${className}`} style={style}>
      <span ref={innerRef} className={run ? 'marquee-run' : 'inline-block'} style={runStyle}>{children}</span>
    </span>
  );
}
