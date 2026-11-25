// Pratinjau tempel ke tepi: area translusen yang menunjukkan ke mana jendela akan menempel saat titlebar dilepas.
// Elemen terpisah (pointer-events none, z-index di atas jendela tetapi di bawah taskbar/dock/menu bar), gaya di desktop.css (.dsk-snap).
export default function SnapPreview({ rect }: { rect: { x: number; y: number; w: number; h: number } }) {
  return <div className="dsk-snap" aria-hidden="true" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />;
}
