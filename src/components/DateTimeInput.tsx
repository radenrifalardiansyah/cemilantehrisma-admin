'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react';

// Pengganti <input type="datetime-local">: popup native-nya (kalender + kolom jam/menit) beda
// tampilannya dengan input tanggal lain di admin. Dipecah jadi pemilih tanggal + pemilih jam sendiri
// (popup native <input type="date"/"time"> tidak bisa di-styling & tampil jelek) supaya seragam.
// Value & onChange tetap berformat "YYYY-MM-DDTHH:mm" (sama persis dengan datetime-local),
// jadi pemanggil tidak perlu mengubah logika apa pun.
interface DateTimeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const PANEL_W = 160;
const PANEL_H = 240;

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const CAL_W = 280;
const CAL_H = 320;
const pad = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function usePopover(open: boolean, setOpen: (v: boolean) => void, w: number, h: number) {
  const btnRef   = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 6);
      setPos({ top, left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) });
    };
    updatePos();
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen, w, h]);
  return { btnRef, panelRef, pos };
}

function DatePicker({ value, onChange, disabled, min, max, height, clearable, id }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  height?: number | string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { btnRef, panelRef, pos } = usePopover(open, setOpen, CAL_W, CAL_H);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : null;
  const [view, setView] = useState(() => { const d = parsed ?? new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const toggle = () => {
    if (!open) { const d = parsed ?? new Date(); setView({ y: d.getFullYear(), m: d.getMonth() }); }
    setOpen(o => !o);
  };
  const shift = (delta: number) => setView(v => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const offset = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // minggu mulai Senin
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayYmd = toYmd(new Date());
  const todayBlocked = (!!min && todayYmd < min) || (!!max && todayYmd > max);
  const pick = (ymd: string) => { onChange(ymd); setOpen(false); };

  const navBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        id={id}
        disabled={disabled}
        onClick={toggle}
        className="input disabled:opacity-50"
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left', ...(height != null ? { height, boxSizing: 'border-box' as const, paddingTop: 0, paddingBottom: 0 } : null) }}
      >
        <span className="tabular" style={{ color: parsed ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {parsed ? `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}` : 'dd/mm/yyyy'}
        </span>
        <Calendar size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          data-popover-layer=""
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: CAL_W, zIndex: 10000, padding: 12,
            background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 14,
            boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button type="button" aria-label="Bulan sebelumnya" onClick={() => shift(-1)} style={navBtn}><ChevronLeft size={16} /></button>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{MONTHS[view.m]} {view.y}</span>
            <button type="button" aria-label="Bulan berikutnya" onClick={() => shift(1)} style={navBtn}><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {WEEKDAYS.map(w => (
              <span key={w} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0' }}>{w}</span>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <span key={`e${i}`} />;
              const ymd = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
              const active = ymd === value;
              const isToday = ymd === todayYmd;
              const blocked = (!!min && ymd < min) || (!!max && ymd > max);
              return (
                <button
                  key={ymd}
                  type="button"
                  disabled={blocked}
                  onClick={() => pick(ymd)}
                  style={{
                    height: 32, borderRadius: 8, fontSize: 12.5, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.35 : 1, fontWeight: active || isToday ? 700 : 500,
                    border: isToday && !active ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#fff' : isToday ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                  onMouseEnter={e => { if (!active && !blocked) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: clearable ? 'space-between' : 'flex-end', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-2)' }}>
            {clearable && (
              <button type="button" disabled={!value} onClick={() => pick('')} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: value ? 'pointer' : 'default', padding: '4px 8px', opacity: value ? 1 : 0.35 }}>
                Hapus
              </button>
            )}
            <button type="button" disabled={todayBlocked} onClick={() => pick(todayYmd)} style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'transparent', border: 'none', cursor: todayBlocked ? 'not-allowed' : 'pointer', padding: '4px 8px', opacity: todayBlocked ? 0.35 : 1 }}>
              Hari ini
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function TimeColumn({ items, selected, onPick }: { items: string[]; selected: string; onPick: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Gulir ke nilai terpilih saat popup dibuka.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-selected="true"]');
    if (el && ref.current) ref.current.scrollTop = el.offsetTop - ref.current.clientHeight / 2 + el.clientHeight / 2;
  }, []);
  return (
    <div ref={ref} className="thin-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
      {items.map(v => {
        const active = v === selected;
        return (
          <button
            key={v}
            type="button"
            data-selected={active}
            onClick={() => onPick(v)}
            style={{
              flexShrink: 0, height: 30, borderRadius: 8, fontSize: 13, fontWeight: active ? 700 : 500, border: 'none', cursor: 'pointer',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--text-secondary)',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

function TimePicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { btnRef, panelRef, pos } = usePopover(open, setOpen, PANEL_W, PANEL_H);
  const [hh = '', mm = ''] = value.split(':');

  const pick = (h: string, m: string) => onChange(`${h || '00'}:${m || '00'}`);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="input disabled:opacity-50"
        style={{ width: 120, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left' }}
      >
        <span className="tabular" style={{ color: value ? 'var(--text-primary)' : 'var(--text-muted)' }}>{value ? `${hh}:${mm}` : '--:--'}</span>
        <Clock size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          data-popover-layer=""
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: PANEL_W, height: PANEL_H, zIndex: 10000,
            background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 14,
            boxShadow: '0 12px 40px rgba(0,0,0,0.22)', overflow: 'hidden', display: 'flex',
          }}
        >
          <TimeColumn items={HOURS} selected={hh} onPick={h => pick(h, mm)} />
          <div style={{ width: 1, background: 'var(--border-2)' }} />
          <TimeColumn items={MINUTES} selected={mm} onPick={m => pick(hh, m)} />
        </div>,
        document.body
      )}
    </>
  );
}

// Pengganti <input type="date"> dengan kalender kustom yang sama seperti DateTimeInput.
// Value & onChange berformat "YYYY-MM-DD" (sama dengan type="date"). `min` opsional ("YYYY-MM-DD"):
// tanggal sebelumnya tidak bisa dipilih. `style` dipakai di pembungkus (mis. untuk lebar tetap).
// Default lebar 100% seperti `.input`; ubah lewat `style`/`className` pembungkus. `height` mengatur tinggi tombol.
// Tanggal bisa dikosongkan lewat tombol "Hapus" (sama seperti input native), kecuali `clearable={false}`.
export function DateInput({ value, onChange, disabled, min, max, height, clearable = true, className, style, id }: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  height?: number | string;
  clearable?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={className} style={{ display: 'flex', width: '100%', minWidth: 0, ...style }}>
      <DatePicker id={id} value={value} onChange={onChange} disabled={disabled} min={min} max={max} height={height} clearable={clearable} />
    </div>
  );
}

// Pengganti <input type="month">: popup grid 12 bulan + navigasi tahun, tampilan seragam dengan DateInput.
// Value & onChange berformat "YYYY-MM"; `min`/`max` juga "YYYY-MM". Tidak ada tombol hapus (sama seperti pemakaian type="month" di sini).
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTH_W = 260;
const MONTH_H = 220;

export function MonthInput({ value, onChange, disabled, min, max, height, className, style, id }: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const { btnRef, panelRef, pos } = usePopover(open, setOpen, MONTH_W, MONTH_H);
  const parsed = /^\d{4}-\d{2}$/.test(value) ? { y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 } : null;
  const [year, setYear] = useState(() => parsed?.y ?? new Date().getFullYear());

  const toggle = () => {
    if (!open) setYear(parsed?.y ?? new Date().getFullYear());
    setOpen(o => !o);
  };
  const now = new Date();
  const thisYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const isBlocked = (ym: string) => (!!min && ym < min) || (!!max && ym > max);
  const pick = (ym: string) => { onChange(ym); setOpen(false); };
  const navBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const prevBlocked = !!min && year <= Number(min.slice(0, 4));
  const nextBlocked = !!max && year >= Number(max.slice(0, 4));

  return (
    <div className={className} style={{ display: 'flex', width: '100%', minWidth: 0, ...style }}>
      <button
        type="button"
        ref={btnRef}
        id={id}
        disabled={disabled}
        onClick={toggle}
        className="input disabled:opacity-50"
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left', ...(height != null ? { height, boxSizing: 'border-box' as const, paddingTop: 0, paddingBottom: 0 } : null) }}
      >
        <span className="tabular" style={{ color: parsed ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {parsed ? `${MONTHS[parsed.m]} ${parsed.y}` : 'Pilih bulan'}
        </span>
        <Calendar size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          data-popover-layer=""
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: MONTH_W, zIndex: 10000, padding: 12,
            background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 14,
            boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button type="button" aria-label="Tahun sebelumnya" disabled={prevBlocked} onClick={() => setYear(y => y - 1)} style={{ ...navBtn, opacity: prevBlocked ? 0.35 : 1, cursor: prevBlocked ? 'not-allowed' : 'pointer' }}><ChevronLeft size={16} /></button>
            <span className="tabular" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{year}</span>
            <button type="button" aria-label="Tahun berikutnya" disabled={nextBlocked} onClick={() => setYear(y => y + 1)} style={{ ...navBtn, opacity: nextBlocked ? 0.35 : 1, cursor: nextBlocked ? 'not-allowed' : 'pointer' }}><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {MONTHS_SHORT.map((label, i) => {
              const ym = `${year}-${pad(i + 1)}`;
              const active = ym === value;
              const isNow = ym === thisYm;
              const blocked = isBlocked(ym);
              return (
                <button
                  key={ym}
                  type="button"
                  disabled={blocked}
                  onClick={() => pick(ym)}
                  style={{
                    height: 36, borderRadius: 8, fontSize: 12.5, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.35 : 1, fontWeight: active || isNow ? 700 : 500,
                    border: isNow && !active ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#fff' : isNow ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                  onMouseEnter={e => { if (!active && !blocked) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-2)' }}>
            <button type="button" disabled={isBlocked(thisYm)} onClick={() => pick(thisYm)} style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'transparent', border: 'none', cursor: isBlocked(thisYm) ? 'not-allowed' : 'pointer', padding: '4px 8px', opacity: isBlocked(thisYm) ? 0.35 : 1 }}>
              Bulan ini
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function DateTimeInput({ value, onChange, disabled, id }: DateTimeInputProps) {
  const [date = '', time = ''] = (value || '').split('T');
  // Kalau jam dikosongkan, pakai 00:00 supaya value tetap valid; kalau tanggal dikosongkan, kosongkan semuanya.
  const emit = (d: string, t: string) => onChange(d ? `${d}T${t || '00:00'}` : '');
  return (
    <div className="flex gap-2">
      <DatePicker id={id} value={date} disabled={disabled} onChange={d => emit(d, time)} />
      <TimePicker value={time.slice(0, 5)} disabled={disabled} onChange={t => emit(date, t)} />
    </div>
  );
}
