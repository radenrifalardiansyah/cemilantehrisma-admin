import { approvedShipments } from '@/lib/shipment-status';
import { approvedTransfers } from '@/lib/consignment-transfer-status';

// Laporan harian mitra: per mitra, per hari, per produk — kirim, jual, retur, reject, dan stok
// akhir hari itu. Stok akhir dihitung mundur dari stok titip SAAT INI: kirim dan transfer masuk sesudah hari itu
// dikurangkan, transfer keluar dan rekap (jual + retur + reject, semuanya mengurangi stok titip) ditambahkan kembali.
// Transfer stok antar mitra (approved) dilaporkan di kolom sendiri (transferMasuk/transferKeluar), TIDAK dicampur ke kirim.

export interface DailyReportLocation { id: string; name: string }
export interface DailyReportStockItem { productId: string; productName: string; stockQty: number; hargaTitip?: number }
export interface DailyReportShipment {
  status?: string | null; // hanya 'approved' (atau kosong = data lama) yang dihitung; draft/ditolak diabaikan
  locationId?: string | null; createdAt?: { seconds: number } | null;
  items: { productId: string; productName: string; qty: number; hargaTitip?: number; subtotal?: number }[];
}
export interface DailyReportTransfer {
  status?: string | null; // hanya 'approved' yang dihitung; draft/ditolak/dibatalkan diabaikan
  fromLocationId?: string | null; toLocationId?: string | null;
  docDate?: { seconds: number } | null; // tanggal dokumen (bukan tanggal approve)
  items: { productId: string; productName: string; qty: number; hargaTitip?: number }[];
}
export interface DailyReportRecap {
  locationId?: string | null; createdAt?: { seconds: number } | null;
  items: { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject: number; hargaTitip?: number; revenue?: number }[];
}

// Nilai (Rp) memakai harga titip yang tercatat di kirim/rekap itu sendiri. Selisih = nilai kirim − nilai
// rekap (sama dengan tile "Selisih" di halaman Mitra): barang yang sudah dikirim tapi belum terealisasi.
export interface DailyProductRow {
  productId: string; productName: string;
  harga: number; // harga satuan (harga titip)
  kirim: number; nilaiKirim: number;
  jual: number; nilaiJual: number;
  retur: number; reject: number;
  selisih: number;
  transferMasuk: number; nilaiTransferMasuk: number;   // pindahan masuk dari mitra lain (qty, Rp harga titip saat approve)
  transferKeluar: number; nilaiTransferKeluar: number; // pindahan keluar ke mitra lain
  stokAwal: number;  // stok di awal hari (atau awal periode untuk rekap produk)
  stokAkhir: number; // stok di akhir hari (atau akhir periode)
}
export interface DailyTotals {
  kirim: number; nilaiKirim: number; jual: number; nilaiJual: number;
  retur: number; reject: number; selisih: number; stokAwal: number; stokAkhir: number;
  transferMasuk: number; transferKeluar: number;
}
export interface DailyBlock {
  date: string; // YYYY-MM-DD (WIB)
  rows: DailyProductRow[];
  totals: DailyTotals;
}
export interface MitraDailyReportSection {
  locationId: string; locationName: string;
  days: DailyBlock[];
  totals: { kirim: number; nilaiKirim: number; jual: number; nilaiJual: number; retur: number; reject: number; selisih: number; transferMasuk: number; transferKeluar: number };
  products: DailyProductRow[]; // rekap per produk selama periode (stokAkhir = stok di akhir periode)
  realisasiPct: number | null; // nilai rekap / nilai kirim (%), null kalau tidak ada kirim di periode
  stokAwalPeriode: number;     // pcs, total stok mitra di awal periode (sebelum `from`)
  stokAkhirPeriode: number;    // pcs, total stok mitra di akhir periode (akhir `to`)
  currentStock: number;        // pcs
  currentStockValue: number;   // Rp, stok × harga titip
}

const WIB_OFFSET_SEC = 7 * 3600;
export function wibDateKey(seconds: number): string {
  return new Date((seconds + WIB_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
}

export function buildMitraDailyReport(input: {
  locations: DailyReportLocation[];
  stockByLocation: Record<string, DailyReportStockItem[]>;
  shipments: DailyReportShipment[];
  recaps: DailyReportRecap[];
  transfers?: DailyReportTransfer[];
  from: string; to: string; // YYYY-MM-DD (WIB), inklusif
}): MitraDailyReportSection[] {
  const { from, to } = input;
  const shipments = approvedShipments(input.shipments);
  const transfers = approvedTransfers(input.transfers ?? []);
  return input.locations.map(loc => {
    const names = new Map<string, string>();
    // Perubahan stok bersih per (tanggal, produk): kirim menambah, rekap mengurangi.
    type Cell = {
      kirim: number; nilaiKirim: number; jual: number; nilaiJual: number; retur: number; reject: number; harga: number;
      tMasuk: number; nilaiTMasuk: number; tKeluar: number; nilaiTKeluar: number;
    };
    const byDay = new Map<string, Map<string, Cell>>();
    const cell = (date: string, pid: string) => {
      let day = byDay.get(date);
      if (!day) { day = new Map(); byDay.set(date, day); }
      let c = day.get(pid);
      if (!c) { c = { kirim: 0, nilaiKirim: 0, jual: 0, nilaiJual: 0, retur: 0, reject: 0, harga: 0, tMasuk: 0, nilaiTMasuk: 0, tKeluar: 0, nilaiTKeluar: 0 }; day.set(pid, c); }
      return c;
    };
    const lastPrice = new Map<string, number>(); // harga titip terakhir yang dikenal per produk (fallback tampilan)
    for (const it of input.stockByLocation[loc.id] ?? []) { names.set(it.productId, it.productName); if (it.hargaTitip) lastPrice.set(it.productId, it.hargaTitip); }
    for (const s of shipments) {
      if (s.locationId !== loc.id || !s.createdAt?.seconds) continue;
      const date = wibDateKey(s.createdAt.seconds);
      for (const it of s.items) {
        names.set(it.productId, it.productName);
        const c = cell(date, it.productId);
        c.kirim += it.qty;
        c.nilaiKirim += it.subtotal ?? it.qty * (it.hargaTitip ?? 0);
        if (it.hargaTitip) c.harga = it.hargaTitip;
      }
    }
    for (const t of transfers) {
      if (!t.docDate?.seconds) continue;
      const masuk = t.toLocationId === loc.id, keluar = t.fromLocationId === loc.id;
      if (!masuk && !keluar) continue;
      const date = wibDateKey(t.docDate.seconds);
      for (const it of t.items) {
        names.set(it.productId, it.productName);
        const c = cell(date, it.productId);
        const nilai = it.qty * (it.hargaTitip ?? 0);
        if (masuk) { c.tMasuk += it.qty; c.nilaiTMasuk += nilai; }
        if (keluar) { c.tKeluar += it.qty; c.nilaiTKeluar += nilai; }
        if (it.hargaTitip && !c.harga) c.harga = it.hargaTitip;
      }
    }
    for (const r of input.recaps) {
      if (r.locationId !== loc.id || !r.createdAt?.seconds) continue;
      const date = wibDateKey(r.createdAt.seconds);
      for (const it of r.items) {
        names.set(it.productId, it.productName);
        const c = cell(date, it.productId);
        c.jual += it.qtySold; c.retur += it.qtyRetur; c.reject += it.qtyReject || 0;
        c.nilaiJual += it.revenue ?? it.qtySold * (it.hargaTitip ?? 0);
        if (it.hargaTitip && !c.harga) c.harga = it.hargaTitip;
      }
    }

    const current = new Map<string, number>();
    for (const it of input.stockByLocation[loc.id] ?? []) current.set(it.productId, it.stockQty);
    const dates = [...byDay.keys()].sort();

    // Stok akhir hari D = stok sekarang − Σ kirim setelah D − Σ transfer masuk setelah D + Σ transfer keluar setelah D
    //                     + Σ (jual+retur+reject) setelah D.
    const stockAfterDay = (date: string, pid: string) => {
      let qty = current.get(pid) ?? 0;
      for (const d of dates) {
        if (d <= date) continue;
        const c = byDay.get(d)!.get(pid);
        if (c) qty += c.jual + c.retur + c.reject - c.kirim - c.tMasuk + c.tKeluar;
      }
      return qty;
    };

    const days: DailyBlock[] = dates.filter(d => d >= from && d <= to).map(date => {
      const rows: DailyProductRow[] = [...byDay.get(date)!.entries()].map(([pid, c]) => ({
        productId: pid, productName: names.get(pid) ?? pid,
        harga: c.harga || lastPrice.get(pid) || 0,
        kirim: c.kirim, nilaiKirim: c.nilaiKirim, jual: c.jual, nilaiJual: c.nilaiJual,
        retur: c.retur, reject: c.reject, selisih: c.nilaiKirim - c.nilaiJual,
        transferMasuk: c.tMasuk, nilaiTransferMasuk: c.nilaiTMasuk, transferKeluar: c.tKeluar, nilaiTransferKeluar: c.nilaiTKeluar,
        stokAkhir: stockAfterDay(date, pid),
        stokAwal: 0,
      })).map(r => ({ ...r, stokAwal: r.stokAkhir - r.kirim - r.transferMasuk + r.transferKeluar + r.jual + r.retur + r.reject })).sort((a, b) => a.productName.localeCompare(b.productName, 'id'));
      const sum = (k: keyof DailyTotals) => rows.reduce((t, r) => t + r[k], 0);
      return {
        date, rows,
        totals: { kirim: sum('kirim'), nilaiKirim: sum('nilaiKirim'), jual: sum('jual'), nilaiJual: sum('nilaiJual'), retur: sum('retur'), reject: sum('reject'), selisih: sum('selisih'), stokAwal: sum('stokAwal'), stokAkhir: sum('stokAkhir'), transferMasuk: sum('transferMasuk'), transferKeluar: sum('transferKeluar') },
      };
    });

    // Rekap per produk selama periode: produk apa saja yang dikirim/direkap mitra ini.
    const agg = new Map<string, DailyProductRow>();
    for (const day of days) {
      for (const r of day.rows) {
        const x = agg.get(r.productId);
        if (!x) { agg.set(r.productId, { ...r }); continue; }
        x.kirim += r.kirim; x.nilaiKirim += r.nilaiKirim; x.jual += r.jual; x.nilaiJual += r.nilaiJual;
        x.retur += r.retur; x.reject += r.reject; x.selisih += r.selisih;
        x.transferMasuk += r.transferMasuk; x.nilaiTransferMasuk += r.nilaiTransferMasuk;
        x.transferKeluar += r.transferKeluar; x.nilaiTransferKeluar += r.nilaiTransferKeluar;
        if (r.harga) x.harga = r.harga;
      }
    }
    const products = [...agg.values()].map(r => {
      const stokAkhir = stockAfterDay(to, r.productId);
      return { ...r, stokAkhir, stokAwal: stokAkhir - r.kirim - r.transferMasuk + r.transferKeluar + r.jual + r.retur + r.reject };
    })
      .sort((a, b) => a.productName.localeCompare(b.productName, 'id'));

    const total = (k: 'kirim' | 'nilaiKirim' | 'jual' | 'nilaiJual' | 'retur' | 'reject' | 'transferMasuk' | 'transferKeluar') => days.reduce((t, d) => t + d.totals[k], 0);
    const nilaiKirim = total('nilaiKirim');
    const nilaiJual = total('nilaiJual');
    const stockItems = input.stockByLocation[loc.id] ?? [];
    // Total stok mitra di awal & akhir periode — semua produk (termasuk yang tidak bergerak di periode ini).
    const dayBefore = (d: string) => new Date(new Date(`${d}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
    const allPids = new Set([...current.keys(), ...names.keys()]);
    let stokAwalPeriode = 0, stokAkhirPeriode = 0;
    for (const pid of allPids) { stokAwalPeriode += stockAfterDay(dayBefore(from), pid); stokAkhirPeriode += stockAfterDay(to, pid); }
    return {
      locationId: loc.id, locationName: loc.name, days, products,
      totals: { kirim: total('kirim'), nilaiKirim, jual: total('jual'), nilaiJual, retur: total('retur'), reject: total('reject'), selisih: nilaiKirim - nilaiJual, transferMasuk: total('transferMasuk'), transferKeluar: total('transferKeluar') },
      realisasiPct: nilaiKirim > 0 ? Math.round((nilaiJual / nilaiKirim) * 1000) / 10 : null,
      stokAwalPeriode, stokAkhirPeriode,
      currentStock: stockItems.reduce((t, it) => t + it.stockQty, 0),
      currentStockValue: stockItems.reduce((t, it) => t + it.stockQty * (it.hargaTitip ?? 0), 0),
    };
  });
}

// "Senin, 2 November 2026" — tanggal laporan dalam WIB (dipakai PDF, tab laporan, dan modal preview).
export function formatReportDay(iso: string): string {
  return new Date(`${iso}T12:00:00+07:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

// Keterangan periode laporan yang eksplisit: "1 November 2026 s/d 2 November 2026 (2 hari)".
export function describePeriod(from: string, to: string): { text: string; fromLong: string; toLong: string; days: number } {
  const short = (iso: string) => new Date(`${iso}T12:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
  const days = Math.max(1, Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000) + 1);
  return {
    text: from === to ? `${short(from)} (1 hari)` : `${short(from)} s/d ${short(to)} (${days} hari)`,
    fromLong: formatReportDay(from), toLong: formatReportDay(to), days,
  };
}
