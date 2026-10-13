// Kondisi barang saat diterima (kolom Kondisi pada GR/DO). File terpisah tanpa import server
// supaya aman dipakai komponen browser.
export const GR_CONDITIONS = ['Baik', 'Rusak', 'Kurang', 'Lainnya'] as const;
export type GrCondition = typeof GR_CONDITIONS[number];
