type FileIconProps = { size?: number; className?: string };

export function ExcelIcon({ size = 16, className }: FileIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2C5.44772 2 5 2.44772 5 3V21C5 21.5523 5.44772 22 6 22H18C18.5523 22 19 21.5523 19 21V7L14 2H6Z" fill="#E8F3ED" />
      <path d="M14 2V6C14 6.55228 14.4477 7 15 7H19L14 2Z" fill="#C3E2D3" />
      <rect x="3" y="12" width="14" height="8" rx="1.4" fill="#21A366" />
      <text x="10" y="18" textAnchor="middle" fontSize="6.2" fontWeight="700" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif">X</text>
    </svg>
  );
}

export function PdfIcon({ size = 16, className }: FileIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2C5.44772 2 5 2.44772 5 3V21C5 21.5523 5.44772 22 6 22H18C18.5523 22 19 21.5523 19 21V7L14 2H6Z" fill="#FBEAEA" />
      <path d="M14 2V6C14 6.55228 14.4477 7 15 7H19L14 2Z" fill="#F2C6C6" />
      <rect x="2.5" y="12" width="15" height="8" rx="1.4" fill="#E23E30" />
      <text x="10" y="18" textAnchor="middle" fontSize="5.6" fontWeight="700" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif">PDF</text>
    </svg>
  );
}

// Laporan harian: dokumen dengan grafik batang pada badge biru.
export function DailyReportIcon({ size = 16, className }: FileIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2C5.44772 2 5 2.44772 5 3V21C5 21.5523 5.44772 22 6 22H18C18.5523 22 19 21.5523 19 21V7L14 2H6Z" fill="#E8F0FC" />
      <path d="M14 2V6C14 6.55228 14.4477 7 15 7H19L14 2Z" fill="#C5D8F5" />
      <rect x="2.5" y="11" width="15" height="10" rx="1.6" fill="#2F6FDE" />
      <rect x="5.3" y="16" width="2.1" height="3.2" rx="0.5" fill="#fff" />
      <rect x="8.9" y="13.4" width="2.1" height="5.8" rx="0.5" fill="#fff" />
      <rect x="12.5" y="14.8" width="2.1" height="4.4" rx="0.5" fill="#fff" />
    </svg>
  );
}

// Form/nota pengiriman: dokumen dengan truk pada badge kuning-oranye.
export function DeliveryFormIcon({ size = 16, className }: FileIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2C5.44772 2 5 2.44772 5 3V21C5 21.5523 5.44772 22 6 22H18C18.5523 22 19 21.5523 19 21V7L14 2H6Z" fill="#FDF2E3" />
      <path d="M14 2V6C14 6.55228 14.4477 7 15 7H19L14 2Z" fill="#F6D9AE" />
      <rect x="2.5" y="11" width="15" height="10" rx="1.6" fill="#E8890C" />
      <path d="M4.6 14.2h6.2v4.2H4.6z M10.8 15.4h2.2l1.5 1.6v1.4h-3.7z" fill="#fff" />
      <circle cx="6.6" cy="19" r="1.15" fill="#E8890C" stroke="#fff" strokeWidth="0.9" />
      <circle cx="12.6" cy="19" r="1.15" fill="#E8890C" stroke="#fff" strokeWidth="0.9" />
    </svg>
  );
}
