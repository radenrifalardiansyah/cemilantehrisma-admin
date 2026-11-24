'use client';

import { useOnDataRevision } from '@/lib/data-sync';

// Menjembatani revisi data ke state level page (posCategories / posProducts) yang dibagi ke Kasir, Gudang, Laporan.
export default function DataSyncBridge({ onCategories, onProducts }: { onCategories: () => void; onProducts: () => void }) {
  useOnDataRevision('categories', onCategories);
  // Kasir ('pos') memuat stoknya sendiri setelah transaksi, jadi bump darinya dilewati.
  useOnDataRevision('products', onProducts, 'pos');
  return null;
}
