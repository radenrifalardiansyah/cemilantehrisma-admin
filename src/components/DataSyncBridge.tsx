'use client';

import { useOnDataRevision } from '@/lib/data-sync';

// Menjembatani revisi data ke state level page (posCategories / posProducts) yang dibagi ke Kasir, Gudang, Laporan.
export default function DataSyncBridge({ onCategories, onProducts, onConsignment }: { onCategories: () => void; onProducts: () => void; onConsignment?: () => void }) {
  useOnDataRevision('categories', onCategories);
  // Kasir ('pos') memuat stoknya sendiri setelah transaksi, jadi bump darinya dilewati.
  useOnDataRevision('products', onProducts, 'pos');
  // Mitra menulis -> analitik Mitra di Dashboard (state level page) disegarkan. Bump dari ConsignmentTab sendiri ikut menyegarkan karena Dashboard bukan penulisnya.
  useOnDataRevision('consignment', () => onConsignment?.());
  return null;
}
