'use client';

import { useState } from 'react';

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
}

export default function Tooltip({ label, children, side = 'bottom' }: TooltipProps) {
  const [show, setShow] = useState(false);
  const edge = side === 'top' ? 'bottom' : 'top';
  const restY = side === 'top' ? 4 : -4;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 z-50 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
        style={{
          [edge]: 'calc(100% + 8px)',
          transform: `translateX(-50%) translateY(${show ? 0 : restY}px) scale(${show ? 1 : 0.92})`,
          opacity: show ? 1 : 0,
          transition: 'opacity 0.16s cubic-bezier(0.4,0,0.2,1), transform 0.16s cubic-bezier(0.4,0,0.2,1)',
          transformOrigin: side === 'top' ? 'bottom center' : 'top center',
          background: '#1E1008',
          color: '#F5E6D3',
          boxShadow: '0 6px 18px rgba(30,16,8,0.30)',
        }}
      >
        {label}
        <span
          style={{
            position: 'absolute', left: '50%', [side === 'top' ? 'top' : 'bottom']: '100%',
            transform: 'translateX(-50%)', width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            [side === 'top' ? 'borderTop' : 'borderBottom']: '5px solid #1E1008',
          }}
        />
      </span>
    </span>
  );
}
