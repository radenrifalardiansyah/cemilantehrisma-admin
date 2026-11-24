'use client';

import { useEffect, useState } from 'react';

const fmt = () => new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.') + ' WIB';

export default function Clock() {
  const [t, setT] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setT(fmt()), 20_000);
    return () => clearInterval(id);
  }, []);
  return <span aria-label="Jam">{t}</span>;
}
