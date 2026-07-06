'use client';

import { useRef, useState, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ScrollChips({
  children, className = '', style, gap = 'gap-1.5',
}: {
  children: ReactNode; className?: string; style?: CSSProperties; gap?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft,  setCanLeft]  = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', update); };
  });

  const scrollByAmount = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * 140, behavior: 'smooth' });

  const arrowStyle: CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
  };

  return (
    <div className={`flex items-center gap-1 ${className}`} style={style}>
      {canLeft && (
        <button type="button" onClick={() => scrollByAmount(-1)} aria-label="Geser ke kiri"
          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={arrowStyle}>
          <ChevronLeft size={13} />
        </button>
      )}
      <div ref={ref} className={`flex ${gap} overflow-x-auto no-scrollbar flex-1 min-w-0`}>
        {children}
      </div>
      {canRight && (
        <button type="button" onClick={() => scrollByAmount(1)} aria-label="Geser ke kanan"
          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={arrowStyle}>
          <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}
