import type { MitraInvoiceData, MitraInvoiceRecap } from '@/lib/pdf/MitraInvoicePDF';
import type { RecapNoteItem } from '@/lib/pdf/RecapNotePDF';

// Penyusun data invoice tagihan mitra — dipakai di client (tombol Invoice di riwayat lokasi) dan di
// server (link publik invoice yang dikirim ke mitra lewat WhatsApp), supaya angkanya selalu sama.
export interface InvoiceShipment { createdAt?: { seconds: number } | null; items: { qty: number; subtotal: number }[] }
export interface InvoiceRecap {
  id: string; createdAt?: { seconds: number } | null; items: RecapNoteItem[];
  totalSold: number; totalRetur: number; totalReject?: number; totalRevenue: number; paymentStatus?: string | null;
}
export interface InvoiceLocation { id: string; name: string; code?: string | null; contactName?: string | null; contactPhone?: string | null; address?: string | null }

const TZ = 'Asia/Jakarta';
const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((q, r) => q + pick(r), 0);
const fmtDateTime = (sec?: number) => sec
  ? new Date(sec * 1000).toLocaleDateString('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '-';
const fmtDate = (d: Date) => d.toLocaleDateString('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });

export function buildMitraInvoiceData(input: {
  location: InvoiceLocation; shipments: InvoiceShipment[]; recaps: InvoiceRecap[];
  bank?: MitraInvoiceData['bank']; now?: Date;
  from?: string; to?: string; // YYYY-MM-DD (WIB), opsional — membatasi kirim & rekap pada periode ini
}): MitraInvoiceData {
  const { location, bank } = input;
  const fromSec = input.from ? new Date(`${input.from}T00:00:00+07:00`).getTime() / 1000 : -Infinity;
  const toSec = input.to ? new Date(`${input.to}T23:59:59+07:00`).getTime() / 1000 : Infinity;
  const inRange = (x: { createdAt?: { seconds: number } | null }) => { const s = x.createdAt?.seconds ?? 0; return s >= fromSec && s <= toSec; };
  const shipments = input.shipments.filter(inRange);
  const recaps = input.recaps.filter(inRange);
  const now = input.now ?? new Date();
  const sec = (x: { createdAt?: { seconds: number } | null }) => x.createdAt?.seconds ?? 0;
  const unpaidRecaps = recaps.filter(r => r.paymentStatus === 'belum_lunas').sort((a, b) => sec(a) - sec(b));
  const paidRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');
  const secs = [...shipments, ...recaps].map(sec).filter(Boolean).sort((a, b) => a - b);
  const ymd = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const stamp = `${ymd.getFullYear()}${String(ymd.getMonth() + 1).padStart(2, '0')}${String(ymd.getDate()).padStart(2, '0')}`;
  // Rekap lunas yang memuat retur/reject ikut dicantumkan (bertanda lunas) supaya transaksinya terlihat.
  const listed = recaps
    .filter(r => r.paymentStatus === 'belum_lunas' || r.totalRetur > 0 || (r.totalReject || 0) > 0)
    .sort((a, b) => sec(a) - sec(b));
  const unpaid: MitraInvoiceRecap[] = listed.map(r => ({
    date: fmtDateTime(sec(r)), docNo: `RKP-${r.id.slice(-6).toUpperCase()}`, items: r.items,
    totalSold: r.totalSold, totalRetur: r.totalRetur, totalReject: r.totalReject || 0, totalRevenue: r.totalRevenue,
    paid: r.paymentStatus !== 'belum_lunas',
  }));
  return {
    docNo: `INV-${(location.code || location.id.slice(-4)).toUpperCase()}-${stamp}`,
    date: now.toLocaleDateString('id-ID', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }),
    printedAt: now.toLocaleString('id-ID', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    periodText: (input.from || input.to)
      ? `${input.from ? fmtDate(new Date(`${input.from}T12:00:00+07:00`)) : 'Awal'} - ${input.to ? fmtDate(new Date(`${input.to}T12:00:00+07:00`)) : 'Sekarang'}`
      : secs.length ? `${fmtDate(new Date(secs[0] * 1000))} - ${fmtDate(new Date(secs[secs.length - 1] * 1000))}` : '-',
    locationName: location.name, locationCode: location.code || undefined,
    contactName: location.contactName || undefined, contactPhone: location.contactPhone || undefined, address: location.address || undefined,
    shipmentCount: shipments.length,
    shipmentQty: sum(shipments, sh => sum(sh.items, it => it.qty)),
    shipmentValue: sum(shipments, sh => sum(sh.items, it => it.subtotal)),
    recapCount: recaps.length,
    soldQty: sum(recaps, r => r.totalSold), returQty: sum(recaps, r => r.totalRetur), rejectQty: sum(recaps, r => r.totalReject || 0),
    revenueAll: sum(recaps, r => r.totalRevenue),
    paidValue: sum(paidRecaps, r => r.totalRevenue), paidCount: paidRecaps.length,
    unpaid, total: sum(unpaidRecaps, r => r.totalRevenue), bank,
  };
}
