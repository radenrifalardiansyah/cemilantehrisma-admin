import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requireWorker } from '@/lib/wa-worker-auth';

// Worker mengirim QR login terbaru ({ qr }) agar bisa di-scan dari admin; { qr: null } = hapus (sudah terhubung / dimatikan).
export async function PUT(req: NextRequest) {
  const denied = requireWorker(req);
  if (denied) return denied;
  const b = await req.json().catch(() => null) as { qr?: unknown } | null;
  const qr = typeof b?.qr === 'string' && b.qr.length > 0 && b.qr.length < 2000 ? b.qr : null;
  await getSql()`update wa_forward_settings set worker_qr = ${qr}, worker_qr_at = ${qr ? new Date() : null} where id = 1`;
  return Response.json({ ok: true });
}
