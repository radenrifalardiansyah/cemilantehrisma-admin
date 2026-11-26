'use client';

import { useEffect, useState } from 'react';
import type { WidgetProps } from './registry';

const TZ = 'Asia/Jakarta';

export interface ClockParts { time: string; seconds: string; date: string }

// Jam 24 jam "HH:mm" (bukan format id-ID "HH.mm"), detik terpisah, dan tanggal "Kamis, 26 November 2026" (WIB). Murni, dipakai tes.
export function clockParts(now: Date): ClockParts {
  const t = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: TZ }).formatToParts(now);
  const d = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).formatToParts(now);
  const pick = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {
    time: `${pick(t, 'hour')}:${pick(t, 'minute')}`,
    seconds: pick(t, 'second'),
    date: `${pick(d, 'weekday')}, ${pick(d, 'day')} ${pick(d, 'month')} ${pick(d, 'year')}`,
  };
}

// Jam & tanggal. Satu timer 1 detik, hanya berjalan saat active (wallpaper terlihat: tab terlihat dan tidak tertutup jendela maksimal), dibersihkan saat tidak aktif/unmount.
export default function ClockWidget({ size, config, active }: WidgetProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    const first = setTimeout(() => setNow(new Date()), 0);   // segarkan segera saat kembali aktif (bukan menunggu 1 detik)
    return () => { clearInterval(id); clearTimeout(first); };
  }, [active]);
  const p = clockParts(now);
  const withSeconds = config.format === 'hms';
  return (
    <div className="dsk-wg-clock" data-size={size}>
      <div className="dsk-wg-time" aria-label="Jam">
        <span>{p.time}</span>
        {withSeconds && <span className="dsk-wg-sec">:{p.seconds}</span>}
      </div>
      <div className="dsk-wg-date">{p.date}</div>
    </div>
  );
}
