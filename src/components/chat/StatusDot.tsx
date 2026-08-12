'use client';

interface Props {
  online: boolean;
  size?: number;
}

export default function StatusDot({ online, size = 10 }: Props) {
  return (
    <span
      className={online ? 'status-dot-blink' : ''}
      style={{
        display: 'inline-block', width: size, height: size, borderRadius: '50%',
        background: online ? '#34D399' : '#9CA3AF',
        border: '2px solid var(--surface)',
      }}
    />
  );
}
