import type { RecapNoteData, RecapNoteItem } from '@/lib/pdf/RecapNotePDF';

// Rekap harian yang mau digabung — dipakai baik di client (tab Rekap: cetak/kirim WA gabungan)
// maupun di server (route publik yang dibuka mitra dari link WhatsApp), jadi shape-nya generik
// (tidak terikat tipe `Recap` React state atau `RecapRow` Postgres).
export interface MergeableRecap {
  id:            string;
  locationId?:   string | null;
  locationName:  string;
  items:         RecapNoteItem[];
  note?:         string | null;
  paymentStatus?: string | null;
  warehouseName?: string | null;
  createdAt?:    { seconds: number };
}

export interface MergedRecapGroup {
  locationId: string;
  recapIds:   string[];
  merged:     boolean;
  data:       RecapNoteData;
}

function formatDateOnly(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Kelompokkan rekap per lokasi/mitra. Kalau satu mitra punya lebih dari satu rekap yang
// diproses bareng, qty & pendapatannya dijumlahkan per produk jadi satu ringkasan (bukan
// ditumpuk apa adanya) — dipakai untuk export PDF gabungan dan pesan WhatsApp reminder.
export function groupAndMergeRecaps(
  rows: MergeableRecap[],
  getLocationCode?: (locationId: string) => string | undefined,
): MergedRecapGroup[] {
  const groups = new Map<string, MergeableRecap[]>();
  rows.forEach(r => {
    const key = r.locationId ?? r.locationName;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  });

  return [...groups.entries()].map(([key, group]) => {
    const sorted = [...group].sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
    const first = sorted[0];
    const merged = sorted.length > 1;

    const itemMap = new Map<string, RecapNoteItem>();
    sorted.forEach(r => r.items.forEach(it => {
      const existing = itemMap.get(it.productName);
      if (existing) {
        existing.qtySold   += it.qtySold;
        existing.qtyRetur  += it.qtyRetur;
        existing.qtyReject += it.qtyReject;
        existing.revenue   += it.revenue;
      } else {
        itemMap.set(it.productName, { ...it });
      }
    }));
    const items = [...itemMap.values()];

    const dateLabel = merged
      ? `${formatDateOnly(sorted[0].createdAt?.seconds)} – ${formatDateOnly(sorted[sorted.length - 1].createdAt?.seconds)} · ${sorted.length} rekap`
      : formatDateTime(first.createdAt?.seconds);
    const sourceDocs = sorted.map(r => `RKP-${r.id.slice(-6).toUpperCase()}`);
    const notes = sorted.map(r => r.note).filter((n): n is string => !!n?.trim());
    const noteParts = [
      ...(notes.length ? [notes.join(' · ')] : []),
      ...(merged ? [`Gabungan ${sorted.length} rekap: ${sourceDocs.join(', ')}`] : []),
    ];

    const data: RecapNoteData = {
      locationName:   first.locationName,
      locationCode:   first.locationId ? getLocationCode?.(first.locationId) : undefined,
      warehouseName:  first.warehouseName || undefined,
      date:           dateLabel,
      printedAt:      new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      docNo:          merged ? `RKP-GAB-${first.id.slice(-6).toUpperCase()}` : sourceDocs[0],
      paymentStatus:  sorted.every(r => (r.paymentStatus ?? 'lunas') === 'lunas') ? 'lunas' : 'belum_lunas',
      note:           noteParts.length ? noteParts.join('\n') : undefined,
      items,
      totalSold:      items.reduce((s, it) => s + it.qtySold, 0),
      totalRetur:     items.reduce((s, it) => s + it.qtyRetur, 0),
      totalReject:    items.reduce((s, it) => s + it.qtyReject, 0),
      totalRevenue:   items.reduce((s, it) => s + it.revenue, 0),
    };

    return { locationId: key, recapIds: sorted.map(r => r.id), merged, data };
  });
}
