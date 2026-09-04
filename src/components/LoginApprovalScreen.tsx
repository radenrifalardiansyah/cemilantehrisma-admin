'use client';

import { useEffect, useRef } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';

const POLL_MS = 2500;

interface ApprovedResult {
  token: string;
  user: { username: string; role: string; uid?: string; mustChangePassword?: boolean };
  mustChangePassword?: boolean;
}

interface Props {
  requestId: string;
  deviceLabel: string;
  onApproved: (result: ApprovedResult) => void;
  onRejected: (reason: string) => void;
  onExpired: () => void;
}

// Layar tunggu setelah /api/login melaporkan `pending: true` (akun sedang online di sesi lain)
// — poll /api/login-requests/[id] (endpoint publik, id-nya sendiri berfungsi sebagai capability
// token) sampai sesi yang aktif menerima/menolak, atau permintaannya kedaluwarsa.
export default function LoginApprovalScreen({ requestId, deviceLabel, onApproved, onRejected, onExpired }: Props) {
  const callbacksRef = useRef({ onApproved, onRejected, onExpired });
  useEffect(() => { callbacksRef.current = { onApproved, onRejected, onExpired }; });

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/login-requests/${requestId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as {
          status: 'pending' | 'approved' | 'rejected' | 'expired';
          token?: string; user?: ApprovedResult['user']; mustChangePassword?: boolean; rejectReason?: string;
        };
        if (cancelled) return;
        if (data.status === 'approved' && data.token && data.user) {
          callbacksRef.current.onApproved({ token: data.token, user: data.user, mustChangePassword: data.mustChangePassword });
        } else if (data.status === 'rejected') {
          callbacksRef.current.onRejected(data.rejectReason || 'Permintaan login Anda ditolak.');
        } else if (data.status === 'expired') {
          callbacksRef.current.onExpired();
        }
      } catch {
        // Abaikan — coba lagi di tick berikutnya.
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [requestId]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 lg:p-8" style={{ background: 'var(--ground)' }}>
      <div className="relative w-full rounded-[28px] overflow-hidden p-8 lg:p-10 text-center"
        style={{ maxWidth: 420, background: 'var(--surface)', boxShadow: '0 24px 70px -20px rgba(30,16,8,0.35), 0 4px 18px rgba(30,16,8,0.08)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center justify-center rounded-2xl relative" style={{ width: 56, height: 56, background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            <ShieldCheck size={24} />
            <Loader2 size={20} className="animate-spin absolute" style={{ top: -6, right: -6, color: 'var(--accent)' }} />
          </div>
          <h1 className="text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>Menunggu Persetujuan</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Akun ini sedang aktif di perangkat lain. Kami sudah mengirim notifikasi login dari{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{deviceLabel}</strong> ke sesi tersebut — mohon tunggu
            sampai diterima atau ditolak di sana.
          </p>
        </div>
      </div>
    </div>
  );
}
