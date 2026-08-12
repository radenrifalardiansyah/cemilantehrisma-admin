'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle, HelpCircle, Loader2 } from 'lucide-react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When provided, runs on confirm before the dialog closes — the confirm button shows a spinner while it's pending. */
  onConfirm?: () => Promise<void>;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}

export default function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [confirming, setConfirming] = useState(false);

  const confirm = useCallback<ConfirmFn>((options) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>(resolve => setState({ ...opts, resolve }));
  }, []);

  const close = (result: boolean) => {
    state?.resolve(result);
    setState(null);
  };

  const handleConfirm = async () => {
    if (state?.onConfirm) {
      setConfirming(true);
      await state.onConfirm();
      setConfirming(false);
    }
    close(true);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="modal-overlay confirm-overlay"
          onClick={() => !confirming && close(false)}
          style={{ zIndex: 10000 }}
        >
          <div className="modal-sheet confirm-sheet modal-sm" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-accent" style={state.danger ? { background: 'var(--danger)' } : undefined} />

            <div style={{ padding: '20px 22px 4px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div
                className="modal-icon"
                style={state.danger ? { background: 'var(--danger-bg)', color: 'var(--danger)' } : undefined}
              >
                {state.danger ? <AlertTriangle size={17} /> : <HelpCircle size={17} />}
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                <p className="modal-title">{state.title ?? (state.danger ? 'Konfirmasi Hapus' : 'Konfirmasi')}</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.5 }}>
                  {state.message}
                </p>
              </div>
            </div>

            <div className="modal-footer" style={{ borderTop: 'none', paddingTop: 18 }}>
              <button
                onClick={() => close(false)}
                className="btn-ghost"
                disabled={confirming}
                style={{ flex: 1, justifyContent: 'center', padding: '10px 0', opacity: confirming ? 0.5 : 1 }}
              >
                {state.cancelLabel ?? 'Batal'}
              </button>
              <button
                onClick={handleConfirm}
                className="btn-primary"
                disabled={confirming}
                style={{
                  flex: 1, justifyContent: 'center', padding: '10px 0',
                  ...(state.danger ? { background: 'var(--danger)', boxShadow: 'none' } : {}),
                  ...(confirming ? { opacity: 0.75, cursor: 'default' } : {}),
                }}
              >
                {confirming
                  ? <Loader2 size={15} className="animate-spin" />
                  : (state.confirmLabel ?? (state.danger ? 'Hapus' : 'Ya, Lanjutkan'))}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
