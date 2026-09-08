import type { ShipmentNoteData, ShipmentNoteItem, ShipmentNoteSection } from '@/lib/pdf/ShipmentNotePDF';

// Pengiriman stok yang mau digabung — dipakai di tab Kirim (cetak PDF gabungan sesuai ceklis),
// sama seperti `groupAndMergeRecaps` di tab Rekap.
export interface MergeableShipment {
  id:            string;
  locationId?:   string | null;
  locationName:  string;
  items:         ShipmentNoteItem[];
  note?:         string | null;
  warehouseName?: string | null;
  createdAt?:    { seconds: number };
}

export interface ShipmentLocationInfo {
  code?:         string;
  contactName?:  string;
  contactPhone?: string;
  address?:      string;
}

export interface MergedShipmentGroup {
  locationId:   string;
  shipmentIds:  string[];
  merged:       boolean;
  data:         ShipmentNoteData;
}

function formatDateOnly(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Kelompokkan pengiriman per lokasi/mitra. Kalau satu mitra punya lebih dari satu pengiriman
// yang diceklis bareng, qty & subtotalnya dijumlahkan per produk jadi satu ringkasan (bukan
// ditumpuk apa adanya) — dipakai untuk cetak PDF gabungan sesuai ceklis di tab Kirim.
export function groupAndMergeShipments(
  rows: MergeableShipment[],
  getLocationInfo?: (locationId: string) => ShipmentLocationInfo | undefined,
): MergedShipmentGroup[] {
  const groups = new Map<string, MergeableShipment[]>();
  rows.forEach(r => {
    const key = r.locationId ?? r.locationName;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  });

  return [...groups.entries()].map(([key, group]) => {
    const sorted = [...group].sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
    const first = sorted[0];
    const merged = sorted.length > 1;
    const locationInfo = first.locationId ? getLocationInfo?.(first.locationId) : undefined;

    const itemMap = new Map<string, ShipmentNoteItem>();
    sorted.forEach(r => r.items.forEach(it => {
      const existing = itemMap.get(it.productName);
      if (existing) {
        existing.qty      += it.qty;
        existing.subtotal += it.subtotal;
      } else {
        itemMap.set(it.productName, { ...it });
      }
    }));
    const items = [...itemMap.values()];

    // Rincian per tanggal — tiap pengiriman sumber tampil sebagai blok sendiri di halaman
    // gabungan (bukan ikut dijumlah ke `items` di atas), supaya rinciannya tetap terlihat
    // sebelum total keseluruhan di bawahnya.
    const sections: ShipmentNoteSection[] = merged
      ? sorted.map(r => ({
          date:  formatDateTime(r.createdAt?.seconds),
          docNo: `KRM-${r.id.slice(-6).toUpperCase()}`,
          items: r.items,
          total: r.items.reduce((s, it) => s + it.subtotal, 0),
        }))
      : [];

    const dateLabel = merged
      ? `${formatDateOnly(sorted[0].createdAt?.seconds)} – ${formatDateOnly(sorted[sorted.length - 1].createdAt?.seconds)} · ${sorted.length} pengiriman`
      : formatDateTime(first.createdAt?.seconds);
    const sourceDocs = sorted.map(r => `KRM-${r.id.slice(-6).toUpperCase()}`);
    const notes = sorted.map(r => r.note).filter((n): n is string => !!n?.trim());
    const noteParts = [
      ...(notes.length ? [notes.join(' · ')] : []),
      ...(merged ? [`Gabungan ${sorted.length} pengiriman: ${sourceDocs.join(', ')}`] : []),
    ];

    const data: ShipmentNoteData = {
      locationName:   first.locationName,
      locationCode:   locationInfo?.code,
      contactName:    locationInfo?.contactName,
      contactPhone:   locationInfo?.contactPhone,
      address:        locationInfo?.address,
      warehouseName:  first.warehouseName || undefined,
      date:           dateLabel,
      printedAt:      new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      docNo:          merged ? `KRM-GAB-${first.id.slice(-6).toUpperCase()}` : sourceDocs[0],
      note:           noteParts.length ? noteParts.join('\n') : undefined,
      items,
      sections:       merged ? sections : undefined,
      total:          items.reduce((s, it) => s + it.subtotal, 0),
    };

    return { locationId: key, shipmentIds: sorted.map(r => r.id), merged, data };
  });
}
