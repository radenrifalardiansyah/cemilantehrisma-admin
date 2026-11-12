'use client';

interface PageSizeSelectProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}

const OPTIONS = [10, 20, 50, 100, 200, Infinity];

export default function PageSizeSelect({ value, onChange, label = 'Tampilkan' }: PageSizeSelectProps) {
  return (
    <label className="flex items-center gap-1.5 text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
      {label}
      <select
        value={value === Infinity ? 'all' : value}
        onChange={e => onChange(e.target.value === 'all' ? Infinity : Number(e.target.value))}
        className="input text-xs font-semibold"
        style={{ width: 'auto', padding: '6px 8px', color: 'var(--text-secondary)', cursor: 'pointer' }}
      >
        {OPTIONS.map(o => (
          <option key={o === Infinity ? 'all' : o} value={o === Infinity ? 'all' : o}>
            {o === Infinity ? 'Semua' : o}
          </option>
        ))}
      </select>
    </label>
  );
}
