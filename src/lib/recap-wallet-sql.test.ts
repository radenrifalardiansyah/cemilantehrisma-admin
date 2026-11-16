import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Penjaga struktur (BUKAN uji terhadap Postgres): setiap pembaca saldo/kas berbasis kas yang menjumlah pendapatan rekap harus
// (1) tetap menghitung total rekap lunas HANYA untuk rekap tanpa pembayaran aktif, dan (2) menghitung pembayaran aktif per baris.
// Kalau salah satu hilang → dobel hitung (rekap lunas lewat cicilan terhitung total + cicilan) atau cicilan tak terhitung.
const read = (rel: string) => readFileSync(path.join(__dirname, '..', '..', rel), 'utf8').replace(/\s+/g, ' ');

const NO_ACTIVE = "not exists (select 1 from consignment_recap_payments p where p.recap_id = r.id and not p.voided)";

describe('pembaca saldo kas: rekap ber-cicilan dihitung per pembayaran, bukan total (hindari dobel)', () => {
  it('computeWalletBalance (lib/wallet-balance.ts)', () => {
    const s = read('src/lib/wallet-balance.ts');
    expect(s).toContain(`from consignment_recaps r where r.wallet_id = \${walletId} and r.payment_status != 'belum_lunas' and ${NO_ACTIVE}`);
    expect(s).toContain('from consignment_recap_payments where wallet_id = ${walletId} and not voided');
    expect(s).toContain('or exists(select 1 from consignment_recap_payments where wallet_id = ${walletId})'); // dompet berreferensi tak boleh dihapus
  });
  it('GET /api/wallets/balances', () => {
    const s = read('src/app/api/wallets/balances/route.ts');
    expect(s).toContain(`from consignment_recaps r where payment_status != 'belum_lunas' and ${NO_ACTIVE} \${byCreatedAt}`);
    expect(s).toContain("from consignment_recap_payments where not voided ${byPaidAt}");
  });
  it('getAllTimeCash (analytics/overview)', () => {
    const s = read('src/app/api/analytics/overview/route.ts');
    expect(s).toContain(`from consignment_recaps r where payment_status != 'belum_lunas' and ${NO_ACTIVE}`);
    expect(s).toContain('from consignment_recap_payments where not voided');
  });
  it('pembaca berbasis kas lain mengecualikan rekap ber-cicilan dari jalur total rekap (diakui lewat pembayaran)', () => {
    expect(read('src/app/api/analytics/monthly/route.ts')).toContain('if (r.payment_status === \'belum_lunas\' || r.has_payments) continue;');
    expect(read('src/app/api/analytics/overview/route.ts')).toContain('recapDocs.filter(r => !r.hasPayments)');
    expect(read('src/components/tabs/FinanceReportTab.tsx')).toContain("r.paymentStatus !== 'belum_lunas' && !r.hasPayments");
  });
});
