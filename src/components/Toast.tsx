'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';

interface ToastItem {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error:   (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  const push = useCallback((kind: ToastItem['kind'], message: string) => {
    const id = nextId.current++;
    setToasts(t => [...t, { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 4500 : 3000);
  }, [dismiss]);

  const value: ToastContextValue = {
    success: msg => push('success', msg),
    error:   msg => push('error', msg),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed top-4 right-4 z-[999] flex flex-col gap-2 items-end"
        style={{ pointerEvents: 'none' }}
      >
        {toasts.map(t => (
          <div
            key={t.id}
            role="status"
            className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium shadow-lg animate-toast-in"
            style={{
              pointerEvents: 'auto',
              maxWidth: 340,
              background: t.kind === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
              color: t.kind === 'success' ? 'var(--success)' : 'var(--danger)',
              border: `1px solid ${t.kind === 'success' ? 'var(--success)' : 'var(--danger)'}33`,
            }}
          >
            {t.kind === 'success'
              ? <CheckCircle2 size={17} className="flex-shrink-0 mt-0.5" />
              : <XCircle size={17} className="flex-shrink-0 mt-0.5" />}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <style jsx global>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-6px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-toast-in { animation: toast-in 0.18s ease-out; }
      `}</style>
    </ToastContext.Provider>
  );
}
