// URL tanda tangan pengguna hanya boleh hasil upload Cloudinary (https://res.cloudinary.com/...).
// Server mengambil gambar ini saat merender PDF PO publik, jadi URL bebas dari klien ditolak supaya
// tidak bisa dipakai untuk mengarahkan server ke alamat lain (SSRF).
export function isValidSignatureUrl(url: string): boolean {
  return /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_\-./%~+]+$/.test(url);
}
