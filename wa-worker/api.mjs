// Klien HTTP ke aplikasi admin (/api/wa-worker/*). Worker tidak memegang kredensial database — hanya WA_WORKER_SECRET.
const BASE = (process.env.ADMIN_BASE_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.WA_WORKER_SECRET ?? '';

export function assertEnv() {
  if (!BASE || !SECRET) {
    console.error('GAGAL: isi ADMIN_BASE_URL dan WA_WORKER_SECRET di wa-worker/.env (lihat .env.example).');
    process.exit(1);
  }
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${SECRET}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// Heartbeat + konfigurasi dalam satu panggilan.
export const getConfig = state => call('GET', `/api/wa-worker/config?state=${encodeURIComponent(state)}`);
export const postGroups = groups => call('POST', '/api/wa-worker/groups', { groups });
export const postLog = entry => call('POST', '/api/wa-worker/log', entry);
export const patchLog = (id, status, error) => call('PATCH', '/api/wa-worker/log', { id, status, error });
