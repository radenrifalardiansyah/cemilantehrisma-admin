'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
}

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 8;
const ARROW_MARGIN = 12;

export default function Tooltip({ label, children, side = 'bottom' }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; arrowLeft: number; placement: 'top' | 'bottom' } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!show) return;

    const update = () => {
      const trigger = triggerRef.current;
      const bubble = bubbleRef.current;
      if (!trigger || !bubble) return;

      const triggerRect = trigger.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();

      let placement = side;
      if (placement === 'bottom' && triggerRect.bottom + TRIGGER_GAP + bubbleRect.height > window.innerHeight) {
        placement = 'top';
      } else if (placement === 'top' && triggerRect.top - TRIGGER_GAP - bubbleRect.height < 0) {
        placement = 'bottom';
      }

      const idealLeft = triggerRect.left + triggerRect.width / 2 - bubbleRect.width / 2;
      const left = Math.min(
        Math.max(idealLeft, VIEWPORT_MARGIN),
        Math.max(window.innerWidth - bubbleRect.width - VIEWPORT_MARGIN, VIEWPORT_MARGIN)
      );

      const top = placement === 'top'
        ? triggerRect.top - TRIGGER_GAP - bubbleRect.height
        : triggerRect.bottom + TRIGGER_GAP;

      const arrowLeft = Math.min(
        Math.max(triggerRect.left + triggerRect.width / 2 - left, ARROW_MARGIN),
        Math.max(bubbleRect.width - ARROW_MARGIN, ARROW_MARGIN)
      );

      setPos({ top, left, arrowLeft, placement });
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [show, side, label]);

  const visible = show && pos !== null;
  const placement = pos?.placement ?? side;

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {mounted && createPortal(
        <span
          ref={bubbleRef}
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-[260px] whitespace-normal rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            opacity: visible ? 1 : 0,
            transform: `translateY(${visible ? 0 : placement === 'top' ? 4 : -4}px) scale(${visible ? 1 : 0.92})`,
            transition: 'opacity 0.16s cubic-bezier(0.4,0,0.2,1), transform 0.16s cubic-bezier(0.4,0,0.2,1)',
            transformOrigin: placement === 'top' ? 'bottom center' : 'top center',
            background: '#1E1008',
            color: '#F5E6D3',
            boxShadow: '0 6px 18px rgba(30,16,8,0.30)',
          }}
        >
          {label}
          <span
            style={{
              position: 'absolute',
              left: pos?.arrowLeft ?? '50%',
              [placement === 'top' ? 'top' : 'bottom']: '100%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              [placement === 'top' ? 'borderTop' : 'borderBottom']: '5px solid #1E1008',
            }}
          />
        </span>,
        document.body
      )}
    </span>
  );
}
