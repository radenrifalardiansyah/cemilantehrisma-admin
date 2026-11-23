import { describe, expect, it } from 'vitest';
import { buildMitraDailyReport } from './mitra-daily-report';
import { loadInboundPriceRanges, priceAfterRemoval, weightedPriceAfterAdd } from './shipment-effect';

// Tes tambahan hasil review Transfer Stok Antar Mitra. Tiga hal yang belum dijaga tes bawaan:
//  1. hasil ekstraksi weightedPriceAfterAdd/priceAfterRemoval harus SAMA PERSIS dengan rumus inline lama di shipment-effect.ts;
//  2. teks SQL loadInboundPriceRanges (fake Postgres di tes lain hanya mencocokkan awalan teks, jadi union all tidak teruji);
//  3. invarian laporan harian dengan transfer (rekonsiliasi stok per baris, batas hari WIB).

// ── 1. Kesetaraan dengan rumus lama (disalin dari `git show HEAD:src/lib/shipment-effect.ts`) ──
function legacyRemoval(cur: { qty: number; harga: number }, qty: number, price: number, others?: { lo: number; hi: number }): number {
  const remaining = cur.qty - qty;
  let harga = 0;
  if (remaining > 0) {
    const raw = (cur.qty * cur.harga - qty * (Number(price) || 0)) / remaining;
    const clamp = (v: number) => others ? Math.min(others.hi, Math.max(others.lo, v)) : v;
    if (Number.isFinite(raw)) harga = others ? clamp(raw) : (raw > 0 ? raw : cur.harga);
    else harga = clamp(cur.harga);
    harga = clamp(Math.round(harga * 1e6) / 1e6);
    if (!Number.isFinite(harga) || harga <= 0) harga = others ? clamp(Math.max(0, cur.harga)) : Math.max(0, cur.harga);
    if (!(harga > 0)) harga = 0;
  }
  return harga;
}
const legacyAdd = (curQty: number, curHarga: number, addQty: number, addHarga: number) => {
  const newQty = curQty + addQty;
  return newQty > 0 ? (curQty * curHarga + addQty * addHarga) / newQty : 0;
};

describe('ekstraksi harga titip: identik dengan rumus lama kirim stok', () => {
  const qtys = [0, 1, 3, 10, 25];
  const hargas = [0, 1000, 4500, 6000];

  it('weightedPriceAfterAdd sama dengan rumus lama untuk semua kombinasi', () => {
    for (const cq of qtys) for (const ch of hargas) for (const aq of qtys) for (const ah of hargas) {
      expect(weightedPriceAfterAdd(cq, ch, aq, ah)).toBe(legacyAdd(cq, ch, aq, ah));
    }
  });

  it('priceAfterRemoval sama dengan rumus lama (tanpa others, others jepit, price NaN/negatif, qty melebihi stok)', () => {
    const othersList = [undefined, { lo: 4000, hi: 6000, wSum: 0, qSum: 0 }, { lo: 5000, hi: 5000, wSum: 0, qSum: 0 }, { lo: 0, hi: 0, wSum: 0, qSum: 0 }];
    const prices = [0, 4000, 6000, 9000, -500, Number.NaN];
    for (const cq of qtys) for (const ch of hargas) for (const q of qtys) for (const p of prices) for (const o of othersList) {
      const got = priceAfterRemoval({ qty: cq, harga: ch }, q, p, o);
      expect(got, `cur=${cq}@${ch} q=${q} p=${p} others=${JSON.stringify(o)}`).toBe(legacyRemoval({ qty: cq, harga: ch }, q, p, o));
    }
  });
});

// ── 2. Bentuk SQL loadInboundPriceRanges ──
describe('loadInboundPriceRanges: bentuk query', () => {
  // rowsPerCall[i] = hasil query ke-i (query 0 = kiriman, query 1 = transfer masuk).
  function recordingTx(rowsPerCall: { items: unknown }[][] = []) {
    const calls: { text: string; values: unknown[] }[] = [];
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
      return Promise.resolve(rowsPerCall[calls.length - 1] ?? []);
    }) as never;
    return { tx, calls };
  }

  it('dua query terpisah (tanpa union all): kiriman approved ke lokasi + transfer MASUK approved ke lokasi, parameter benar, tanpa filter transfer asal', async () => {
    const { tx, calls } = recordingTx();
    await loadInboundPriceRanges(tx, { locationId: 'L1', productIds: ['P1'], excludeShipmentId: 'S1', excludeTransferId: 'T1' });
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toBe("select items from consignment_shipments where location_id = ? and status = 'approved' and id <> ?");
    expect(calls[0].values).toEqual(['L1', 'S1']);
    expect(calls[1].text).toBe("select items from consignment_transfers where to_location_id = ? and status = 'approved' and id <> ?");
    expect(calls[1].values).toEqual(['L1', 'T1']);
    expect(calls.map(c => c.text).join(' ')).not.toMatch(/union|from_location_id/);
  });

  it('tanpa id yang dikecualikan memakai string kosong (tidak null: "id <> null" akan membuang semua baris)', async () => {
    const { tx, calls } = recordingTx();
    await loadInboundPriceRanges(tx, { locationId: 'L1', productIds: ['P1'] });
    expect(calls[0].values).toEqual(['L1', '']);
    expect(calls[1].values).toEqual(['L1', '']);
  });

  it('productIds kosong atau lokasi kosong: tidak ada query', async () => {
    const { tx, calls } = recordingTx();
    expect((await loadInboundPriceRanges(tx, { locationId: 'L1', productIds: [] })).size).toBe(0);
    expect((await loadInboundPriceRanges(tx, { locationId: '', productIds: ['P1'] })).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('items jsonb sebagai array maupun string diparse; produk lain dan harga negatif/NaN dilewati', async () => {
    const { tx } = recordingTx([
      [{ items: [{ productId: 'P1', qty: 2, hargaTitip: 4000 }, { productId: 'PX', qty: 9, hargaTitip: 1 }] }],
      [{ items: JSON.stringify([{ productId: 'P1', qty: 3, hargaTitip: 6000 }, { productId: 'P1', qty: 1, hargaTitip: -1 }, { productId: 'P1', qty: 1, hargaTitip: 'abc' }]) }],
    ]);
    const r = await loadInboundPriceRanges(tx, { locationId: 'L1', productIds: ['P1'] });
    expect(r.get('L1_P1')).toEqual({ lo: 4000, hi: 6000, wSum: 2 * 4000 + 3 * 6000, qSum: 5 });
    expect(r.has('L1_PX')).toBe(false);
  });
});

// ── 3. Invarian laporan harian dengan transfer ──
describe('laporan harian mitra + transfer: invarian', () => {
  // seconds dari waktu WIB (UTC+7)
  const wib = (iso: string) => ({ seconds: Math.floor(new Date(`${iso}+07:00`).getTime() / 1000) });
  const item = (qty: number) => [{ productId: 'p', productName: 'Keripik', qty, hargaTitip: 5000 }];
  const locations = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }];
  const input = (transfers: Parameters<typeof buildMitraDailyReport>[0]['transfers']) => ({
    locations,
    stockByLocation: { A: [{ productId: 'p', productName: 'Keripik', stockQty: 20 }], B: [{ productId: 'p', productName: 'Keripik', stockQty: 30 }] },
    shipments: [], recaps: [], transfers, from: '2026-11-01', to: '2026-11-03',
  });

  it('tiap baris: stok awal + kirim + transfer masuk - transfer keluar - jual - retur - reject = stok akhir', () => {
    const sections = buildMitraDailyReport(input([
      { status: 'approved', fromLocationId: 'A', toLocationId: 'B', docDate: wib('2026-11-01T10:00:00'), items: item(10) },
      { status: 'approved', fromLocationId: 'B', toLocationId: 'A', docDate: wib('2026-11-03T10:00:00'), items: item(4) },
    ]));
    for (const s of sections) for (const d of s.days) for (const r of d.rows) {
      expect(r.stokAwal + r.kirim + r.transferMasuk - r.transferKeluar - r.jual - r.retur - r.reject, `${s.locationName} ${d.date}`).toBe(r.stokAkhir);
    }
    // A: sekarang 20; 3 Nov masuk 4 -> akhir 2 Nov = 16; 1 Nov keluar 10 -> akhir 31 Okt = 26.
    const a = sections[0];
    expect(a.days.map(d => [d.date, d.totals.stokAkhir])).toEqual([['2026-11-01', 16], ['2026-11-03', 20]]);
    expect(a.stokAwalPeriode).toBe(26);
    expect(a.stokAkhirPeriode).toBe(20);
  });

  it('transfer antar dua mitra bersih nol: jumlah stok awal periode semua mitra = jumlah stok akhir periode (tanpa kirim/rekap)', () => {
    const sections = buildMitraDailyReport(input([
      { status: 'approved', fromLocationId: 'A', toLocationId: 'B', docDate: wib('2026-11-02T09:00:00'), items: item(7) },
    ]));
    expect(sections.reduce((t, s) => t + s.stokAwalPeriode, 0)).toBe(sections.reduce((t, s) => t + s.stokAkhirPeriode, 0));
  });

  it('tanggal transfer memakai hari WIB dari tanggal dokumen: 00:30 WIB tanggal 2 jatuh ke 2 Nov walau masih 1 Nov di UTC', () => {
    const [a] = buildMitraDailyReport(input([
      { status: 'approved', fromLocationId: 'A', toLocationId: 'B', docDate: wib('2026-11-02T00:30:00'), items: item(5) },
      { status: 'approved', fromLocationId: 'A', toLocationId: 'B', docDate: wib('2026-11-01T23:30:00'), items: item(3) },
    ]));
    expect(a.days.map(d => [d.date, d.totals.transferKeluar])).toEqual([['2026-11-01', 3], ['2026-11-02', 5]]);
  });

  it('transfer approved tanpa docDate dilewati (tidak membuat tanggal "undefined")', () => {
    const [a] = buildMitraDailyReport(input([{ status: 'approved', fromLocationId: 'A', toLocationId: 'B', docDate: null, items: item(5) }]));
    expect(a.days).toHaveLength(0);
  });
});
