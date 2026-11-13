// Pembatas laju sederhana (fixed window) di MEMORI instance. Tanpa dependensi/layanan baru.
// Keterbatasan: di serverless tiap instance punya Map sendiri dan hilang saat cold start, jadi ini hanya
// peredam best-effort (cukup untuk link yang dibuka berulang dari satu klien), BUKAN jaminan global.
// Pembatas yang tegas butuh penyimpanan bersama (WAF/Vercel Firewall rate limit, atau Redis).

const MAX_KEYS = 2000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult { allowed: boolean; retryAfterSec: number }

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      if (buckets.size >= MAX_KEYS) buckets.clear(); // di bawah serangan banyak kunci: memori dijaga, bukan akurasi
    }
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return { allowed: b.count <= limit, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}

export function clientIp(headers: Headers): string {
  return headers.get('x-real-ip')?.trim()
    || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

export const resetRateLimits = () => buckets.clear();
