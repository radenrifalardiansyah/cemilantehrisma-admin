// Pemuat halaman penuh — dipakai sebagai `if (loading) return <PageLoader />` di awal tab, SEBELUM
// header/tombol (Tambah, Export, dst) dirender, supaya tombol aksi tidak muncul sebelum datanya ada.
// `compact` untuk area yang lebih kecil (di dalam modal/bagian laporan), tanpa tinggi 60vh.
export default function PageLoader({ label = 'Memuat data', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className="page-loader" role="status" aria-live="polite" style={compact ? { minHeight: 200 } : undefined}>
      <div className="page-loader-ring" aria-hidden="true" />
      <p className="page-loader-label">
        {label}
        <span className="page-loader-dots" aria-hidden="true"><i /><i /><i /></span>
      </p>
    </div>
  );
}
