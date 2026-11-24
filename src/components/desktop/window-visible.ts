'use client';

import { createContext, useContext } from 'react';

// true bila jendela yang memuat tab ini terlihat (tidak diminimalkan). Default true (Klasik / tanpa jendela). Dipakai tab yang memegang
// sumber daya perangkat (mis. kamera scanner) agar dihentikan saat jendela dikecilkan dan dinyalakan lagi saat terlihat.
export const WindowVisibleContext = createContext(true);
export const useWindowVisible = () => useContext(WindowVisibleContext);
