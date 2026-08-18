// Tag cache per-shipment untuk nota kirim (lihat src/app/api/consignment/send/[id]/pdf/route.ts).
// Dipanggil lagi lewat revalidateTag() saat shipment diedit/dihapus, supaya link nota WhatsApp
// yang sudah pernah dibuka tidak terus menyajikan versi lama.
export function shipmentPdfTag(id: string) {
  return `consignment-shipment-pdf-${id}`;
}
