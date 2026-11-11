'use client';

// Pengganti <input type="datetime-local">: popup native-nya (kalender + kolom jam/menit) beda
// tampilannya dengan input tanggal lain di admin. Dipecah jadi type="date" + type="time" supaya
// popup tanggalnya seragam. Value & onChange tetap berformat "YYYY-MM-DDTHH:mm" (sama persis
// dengan datetime-local), jadi pemanggil tidak perlu mengubah logika apa pun.
interface DateTimeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function DateTimeInput({ value, onChange, disabled }: DateTimeInputProps) {
  const [date = '', time = ''] = (value || '').split('T');
  // Kalau jam dikosongkan, pakai 00:00 supaya value tetap valid; kalau tanggal dikosongkan, kosongkan semuanya.
  const emit = (d: string, t: string) => onChange(d ? `${d}T${t || '00:00'}` : '');
  return (
    <div className="flex gap-2">
      <input type="date" value={date} disabled={disabled} onChange={e => emit(e.target.value, time)}
        className="input" style={{ flex: 1, minWidth: 0 }} />
      <input type="time" value={time.slice(0, 5)} disabled={disabled} onChange={e => emit(date, e.target.value)}
        className="input" style={{ width: 120, flexShrink: 0 }} />
    </div>
  );
}
