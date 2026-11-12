// Format tampilan bersama (client & server): Rupiah dan tanggal/jam, selalu locale 'id-ID'.

const rpFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

/** "Rp 10.000" (spasi non-breaking dari Intl). */
export const formatRp = (n: number) => rpFormatter.format(n);

export type DateVariant =
  | 'short'       // 5 Nov 2026
  | 'shortNoYear' // 5 Nov
  | 'datetime'    // 5 Nov 2026 14.30
  | 'dayTime'     // 5 Nov 14.30 (tanpa tahun, 24 jam)
  | 'time'        // 14.30
  | 'long'        // 5 November 2026 (PDF/cetak)
  | 'longDateTime'; // 5 November 2026 14.30 (PDF/cetak)

const HM = { hour: '2-digit', minute: '2-digit' } as const;
const VARIANTS: Record<DateVariant, Intl.DateTimeFormatOptions> = {
  short: { day: 'numeric', month: 'short', year: 'numeric' },
  shortNoYear: { day: 'numeric', month: 'short' },
  datetime: { day: 'numeric', month: 'short', year: 'numeric', ...HM },
  dayTime: { day: 'numeric', month: 'short', ...HM, hourCycle: 'h23' },
  time: HM,
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  longDateTime: { day: 'numeric', month: 'long', year: 'numeric', ...HM },
};

/** Format tanggal/jam 'id-ID'. `timeZone` opsional (mis. 'Asia/Jakarta' untuk kode sisi server). */
export function formatDate(d: Date | number | string, variant: DateVariant = 'short', timeZone?: string) {
  return new Date(d).toLocaleString('id-ID', timeZone ? { ...VARIANTS[variant], timeZone } : VARIANTS[variant]);
}
