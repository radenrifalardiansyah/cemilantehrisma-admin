'use client';

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { canPlace, clampToGrid, fitToGrid, gridDims, moveWidget, nudgeWidget, snapToCell, sizeCells, widgetBox, type Rect } from '@/lib/widget-layout';
import type { WinArea } from '../window-reducer';
import WidgetCard from './WidgetCard';
import { getWidgetDefinition, widgetAllowed, type DesktopWidgetsApi } from './registry';

export interface WidgetContextTarget { id: string; x: number; y: number; trigger: HTMLElement }

interface Props {
  api: DesktopWidgetsApi;
  area: WinArea;
  /** Wallpaper tertutup jendela maksimal (tidak dikecilkan): widget tidak terlihat, jadi `active` false (polling widget berdata berhenti). */
  covered?: boolean;
  /** Klik kanan kartu / tombol menu / Shift+F10 / Delete: DesktopShell membuka menu widget. */
  onContext: (t: WidgetContextTarget) => void;
}

const DRAG_THRESHOLD = 3;
const INTERACTIVE = 'textarea, input, select, button, a, [contenteditable="true"], [data-no-drag]';

// Widget yang melempar galat tidak boleh menjatuhkan seluruh desktop: tampilkan pesan kecil di kartunya.
// Pulih otomatis saat resetKey berubah (mis. config diubah); kartu yang di-mount ulang selalu mulai bersih.
export class WidgetBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error('Widget gagal dirender', err, info.componentStack); }
  render() { return this.state.failed ? <div className="dsk-wg-fail">Widget tidak dapat ditampilkan.</div> : this.props.children; }
}

function usePageVisible(): boolean {
  const [v, setV] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setV(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return v;
}

interface DragState { id: string; pointerId: number; sx: number; sy: number; active: boolean; dx: number; dy: number; raf: number; el: HTMLElement; target: { col: number; row: number } | null }

// Lapisan widget di atas wallpaper, di bawah ikon meja dan jendela (z-index 0; jendela >= 1). Wadah pointer-events:none: klik di ruang kosong tembus ke
// wallpaper (menu klik kanan desktop tetap jalan); hanya kartu yang menangkap pointer. Posisi TAMPILAN dihitung fitToGrid dari posisi tersimpan.
export default function WidgetLayer({ api, area, covered = false, onContext }: Props) {
  const grid = useMemo(() => gridDims(area), [area]);
  const layout = useMemo(() => fitToGrid(api.widgets, grid.cols, grid.rows), [api.widgets, grid]);
  const pageVisible = usePageVisible();
  const [drag, setDrag] = useState<{ id: string; target: { col: number; row: number }; valid: boolean } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const latest = useRef({ layout, grid, area, api });
  useEffect(() => { latest.current = { layout, grid, area, api }; });

  // Hitung sel tujuan dari pergeseran piksel; valid bila bebas tabrakan di dalam grid.
  const evalTarget = useCallback((d: DragState) => {
    const { layout: lay, grid: g, area: a, api: ap } = latest.current;
    const w = ap.widgets.find(x => x.id === d.id);
    const cur = lay.get(d.id);
    if (!w || !cur) return null;
    const cells = sizeCells(w.size);
    const box = widgetBox(cur);
    const left = a.w - box.right - box.width + d.dx;
    const top = box.top + d.dy;
    const raw = snapToCell(left, top, cells, a.w);
    const rect = clampToGrid({ col: raw.col, row: raw.row, ...cells }, g.cols, g.rows);
    const others = [...lay.entries()].filter(([k, r]) => k !== d.id && r).map(([, r]) => r as Rect);
    return { col: rect.col, row: rect.row, valid: canPlace(rect, others, g.cols, g.rows) };
  }, []);

  const endDrag = useCallback((commit: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    cancelAnimationFrame(d.raf);
    d.el.style.transform = '';
    try { d.el.releasePointerCapture?.(d.pointerId); } catch { /* sudah dilepas */ }
    setDrag(null);
    if (commit && d.active) {
      const t = evalTarget(d);
      const cur = latest.current.layout.get(d.id);
      if (t && t.valid && cur && (t.col !== cur.col || t.row !== cur.row)) {
        const { grid: g, api: ap } = latest.current;
        ap.apply(list => { const r = moveWidget(list, d.id, t.col, t.row, g.cols, g.rows); return r.ok ? r.widgets : null; });
      }
    }
  }, [evalTarget]);

  // Esc membatalkan seretan; bersihkan rAF saat unmount.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') endDrag(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drag, endDrag]);
  useEffect(() => () => { const d = dragRef.current; if (d) cancelAnimationFrame(d.raf); dragRef.current = null; }, []);

  const frame = (d: DragState) => {
    d.raf = 0;
    if (dragRef.current !== d) return;
    d.el.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
    const t = evalTarget(d);
    if (!t) return;
    setDrag(prev => (prev && prev.id === d.id && prev.target.col === t.col && prev.target.row === t.row && prev.valid === t.valid ? prev : { id: d.id, target: { col: t.col, row: t.row }, valid: t.valid }));
  };

  const onPointerDown = (id: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || dragRef.current) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;   // textarea/tombol di dalam widget tidak memulai seret
    const el = e.currentTarget;
    dragRef.current = { id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, active: false, dx: 0, dy: 0, raf: 0, el, target: null };
    try { el.setPointerCapture?.(e.pointerId); } catch { /* pointer sintetis */ }
  };
  const onPointerMove = (id: string, e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== id || d.pointerId !== e.pointerId) return;
    d.dx = e.clientX - d.sx; d.dy = e.clientY - d.sy;
    if (!d.active) {
      if (Math.hypot(d.dx, d.dy) < DRAG_THRESHOLD) return;
      d.active = true;
      const cur = latest.current.layout.get(id);
      if (cur) setDrag({ id, target: { col: cur.col, row: cur.row }, valid: true });
    }
    if (!d.raf) d.raf = requestAnimationFrame(() => frame(d));
  };
  const onPointerUp = (id: string, e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== id || d.pointerId !== e.pointerId) return;
    d.dx = e.clientX - d.sx; d.dy = e.clientY - d.sy;
    endDrag(true);
  };
  const onCancel = (id: string, e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== id || d.pointerId !== e.pointerId) return;
    endDrag(false);
  };

  const openFrom = (id: string, el: HTMLElement, x: number, y: number) => onContext({ id, x, y, trigger: el });
  const onKeyDown = (id: string, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;   // hanya saat kartunya sendiri yang fokus (bukan textarea di dalamnya)
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.startsWith('Arrow')) {
      e.preventDefault();   // juga mencegah pintasan jendela Alt+panah (use-desktop-shortcuts menghormati defaultPrevented)
      const dCol = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;   // kolom dihitung dari kanan
      const dRow = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      const { grid: g } = latest.current;
      api.apply(list => { const r = nudgeWidget(list, id, dCol, dRow, g.cols, g.rows); return r.ok ? r.widgets : null; });
      return;
    }
    if (e.key === 'Delete' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      openFrom(id, e.currentTarget, r.left + 16, r.top + 40);
    }
  };

  const nodes = api.widgets.map(w => {
    const def = getWidgetDefinition(w.type);
    const rect = layout.get(w.id);
    if (!def || !rect || !widgetAllowed(def, api.can)) return null;   // tidak muat / tanpa izin: disembunyikan, data tetap
    const box = widgetBox(rect);
    const Body = def.Component;
    const config = def.sanitizeConfig(w.config);
    return (
      <WidgetCard
        key={w.id} Icon={def.icon} title={def.label} size={w.size} dragging={drag?.id === w.id}
        data-widget-id={w.id} data-type={w.type}
        style={{ right: box.right, top: box.top, width: box.width, height: box.height }}
        onPointerDown={e => onPointerDown(w.id, e)} onPointerMove={e => onPointerMove(w.id, e)} onPointerUp={e => onPointerUp(w.id, e)}
        onPointerCancel={e => onCancel(w.id, e)} onLostPointerCapture={e => onCancel(w.id, e)}
        onKeyDown={e => onKeyDown(w.id, e)}
        onContextMenu={e => {
          if ((e.target as HTMLElement).closest('textarea, input')) return;   // klik kanan di isian: menu bawaan peramban (salin/tempel)
          e.preventDefault();
          const x = e.clientX; const y = e.clientY;
          const r = e.currentTarget.getBoundingClientRect();
          openFrom(w.id, e.currentTarget, x || r.left + 16, y || r.top + 40);
        }}
        onMenu={e => { const r = e.currentTarget.getBoundingClientRect(); openFrom(w.id, e.currentTarget, r.left, r.bottom); }}
      >
        <WidgetBoundary resetKey={JSON.stringify(config)}>
          <Body id={w.id} size={w.size} config={config} active={pageVisible && !covered} creds={api.creds} can={api.can}
            onConfigChange={next => api.setConfig(w.id, def.sanitizeConfig(next))} />
        </WidgetBoundary>
      </WidgetCard>
    );
  });

  const ghost = drag ? (() => {
    const w = api.widgets.find(x => x.id === drag.id);
    if (!w) return null;
    const b = widgetBox({ col: drag.target.col, row: drag.target.row, ...sizeCells(w.size) });
    return <div className="dsk-wg-ghost" data-valid={drag.valid ? 'true' : 'false'} aria-hidden="true" style={{ right: b.right, top: b.top, width: b.width, height: b.height }} />;
  })() : null;

  return (
    <div className="dsk-wg-layer" role="group" aria-label="Widget desktop">
      {ghost}
      {nodes}
    </div>
  );
}
