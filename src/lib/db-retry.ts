// Jaring pengaman untuk transaksi stok: kalau Postgres membatalkan transaksi karena deadlock
// (40P01) atau kegagalan serialisasi (40001), seluruh transaksi sudah di-rollback — aman diulang dari
// awal. Urutan kunci yang seragam (produk → stok gudang → stok titip) adalah perbaikan utamanya;
// ini hanya menangkap sisa kasus langka supaya kasir tidak melihat error untuk transaksi yang
// sebenarnya valid. HANYA bungkus isi transaksi database (`sql.begin(...)`), jangan efek di luar
// database (notifikasi, riwayat) — itu akan ikut terulang.
const RETRYABLE = new Set(['40P01', '40001']);

export async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : undefined;
      if (!code || !RETRYABLE.has(code) || i >= attempts) throw err;
      // Jeda acak singkat supaya dua transaksi yang baru saja bentrok tidak mengulang di detik yang sama.
      await new Promise(r => setTimeout(r, 40 + Math.random() * 120));
    }
  }
}
