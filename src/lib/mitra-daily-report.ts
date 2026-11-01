// Laporan harian mitra: per mitra, per hari, per produk — kirim, jual, retur, reject, dan stok
// akhir hari itu. Stok akhir dihitung mundur dari stok titip SAAT INI: kirim sesudah hari itu
// dikurangkan, rekap (jual + retur + reject, semuanya mengurangi stok titip) ditambahkan kembali.

export interface DailyReportLocation { id: string; name: string }
export interface DailyReportStockItem { productId: string; productName: string; stockQty: number }
export interface DailyReportShipment {
  locationId?: string | null; createdAt?: { seconds: number } | null;
  items: { productId: string; productName: string; qty: number }[];
}
export interface DailyReportRecap {
  locationId?: string | null; createdAt?: { seconds: number } | null;
  items: { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject: number }[];
}

export interface DailyProductRow {
  productId: string; productName: string;
  kirim: number; jual: number; retur: number; reject: number; stokAkhir: number;
}
export interface DailyBlock {
  date: string; // YYYY-MM-DD (WIB)
  rows: DailyProductRow[];
  totals: { kirim: number; jual: number; retur: number; reject: number; stokAkhir: number };
}
export interface MitraDailyReportSection {
  locationId: string; locationName: string;
  days: DailyBlock[];
  totals: { kirim: number; jual: number; retur: number; reject: number };
  currentStock: number;
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
  from: string; to: string; // YYYY-MM-DD (WIB), inklusif
}): MitraDailyReportSection[] {
  const { from, to } = input;
  return input.locations.map(loc => {
    const names = new Map<string, string>();
    // Perubahan stok bersih per (tanggal, produk): kirim menambah, rekap mengurangi.
    const byDay = new Map<string, Map<string, { kirim: number; jual: number; retur: number; reject: number }>>();
    const cell = (date: string, pid: string) => {
      let day = byDay.get(date);
      if (!day) { day = new Map(); byDay.set(date, day); }
      let c = day.get(pid);
      if (!c) { c = { kirim: 0, jual: 0, retur: 0, reject: 0 }; day.set(pid, c); }
      return c;
    };
    for (const it of input.stockByLocation[loc.id] ?? []) names.set(it.productId, it.productName);
    for (const s of input.shipments) {
      if (s.locationId !== loc.id || !s.createdAt?.seconds) continue;
      const date = wibDateKey(s.createdAt.seconds);
      for (const it of s.items) { names.set(it.productId, it.productName); cell(date, it.productId).kirim += it.qty; }
    }
    for (const r of input.recaps) {
      if (r.locationId !== loc.id || !r.createdAt?.seconds) continue;
      const date = wibDateKey(r.createdAt.seconds);
      for (const it of r.items) {
        names.set(it.productId, it.productName);
        const c = cell(date, it.productId);
        c.jual += it.qtySold; c.retur += it.qtyRetur; c.reject += it.qtyReject || 0;
      }
    }

    const current = new Map<string, number>();
    for (const it of input.stockByLocation[loc.id] ?? []) current.set(it.productId, it.stockQty);
    const dates = [...byDay.keys()].sort();

    // Stok akhir hari D = stok sekarang − Σ kirim setelah D + Σ (jual+retur+reject) setelah D.
    const stockAfterDay = (date: string, pid: string) => {
      let qty = current.get(pid) ?? 0;
      for (const d of dates) {
        if (d <= date) continue;
        const c = byDay.get(d)!.get(pid);
        if (c) qty += c.jual + c.retur + c.reject - c.kirim;
      }
      return qty;
    };

    const days: DailyBlock[] = dates.filter(d => d >= from && d <= to).map(date => {
      const rows = [...byDay.get(date)!.entries()].map(([pid, c]) => ({
        productId: pid, productName: names.get(pid) ?? pid, ...c, stokAkhir: stockAfterDay(date, pid),
      })).sort((a, b) => a.productName.localeCompare(b.productName, 'id'));
      const sum = (k: 'kirim' | 'jual' | 'retur' | 'reject' | 'stokAkhir') => rows.reduce((t, r) => t + r[k], 0);
      return { date, rows, totals: { kirim: sum('kirim'), jual: sum('jual'), retur: sum('retur'), reject: sum('reject'), stokAkhir: sum('stokAkhir') } };
    });

    const total = (k: 'kirim' | 'jual' | 'retur' | 'reject') => days.reduce((t, d) => t + d.totals[k], 0);
    return {
      locationId: loc.id, locationName: loc.name, days,
      totals: { kirim: total('kirim'), jual: total('jual'), retur: total('retur'), reject: total('reject') },
      currentStock: [...current.values()].reduce((t, q) => t + q, 0),
    };
  });
}

// "Senin, 2 November 2026" — tanggal laporan dalam WIB (dipakai PDF, tab laporan, dan modal preview).
export function formatReportDay(iso: string): string {
  return new Date(`${iso}T12:00:00+07:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
}
