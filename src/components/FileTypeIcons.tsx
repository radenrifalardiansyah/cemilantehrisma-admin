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
