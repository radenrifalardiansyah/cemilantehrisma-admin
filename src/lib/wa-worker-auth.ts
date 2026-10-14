import { timingSafeEqual } from 'crypto';

// Guard route /api/wa-worker/* (dipanggil worker WhatsApp, bukan browser admin): Bearer WA_WORKER_SECRET.
// Tanpa secret terkonfigurasi → ditolak (bukan dibuka). Perbandingan konstan-waktu.
export function requireWorker(req: Request): Response | null {
  const secret = process.env.WA_WORKER_SECRET ?? '';
  const got = req.headers.get('authorization') ?? '';
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got); const b = Buffer.from(want);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
