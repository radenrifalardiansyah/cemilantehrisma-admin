import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import AdminSplashScreen from "@/components/AdminSplashScreen";
import KeyboardViewportFix from "@/components/KeyboardViewportFix";
import ToastProvider from "@/components/Toast";
import ConfirmProvider from "@/components/Confirm";
import { getCachedAdminBranding } from "@/lib/server/branding";
import { hexToShades } from "@/lib/color";

// Font di-host sendiri (bukan next/font/google) supaya build di Vercel tidak gagal kalau
// Google Fonts sedang tidak bisa dijangkau saat build.
const jakarta = localFont({
  src: [
    { path: "./fonts/plus-jakarta-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-jakarta",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getCachedAdminBranding();
  return {
    title: `Dashboard Admin — ${branding.storeName}`,
    description: `Admin dashboard ${branding.storeName}`,
    robots: { index: false, follow: false },
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: branding.appName,
    },
    icons: {
      icon: "/icon-192.png",
      apple: "/apple-touch-icon.png",
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getCachedAdminBranding();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: branding.themeColor,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = await getCachedAdminBranding();
  const shades = hexToShades(branding.themeColor);

  return (
    <html
      lang="id"
      className={jakarta.variable}
      style={{
        '--accent': shades.accent,
        '--accent-dark': shades.dark,
        '--accent-light': shades.light,
        '--accent-bg': shades.bg,
      } as React.CSSProperties}
    >
      <body>
        <KeyboardViewportFix />
        <AdminSplashScreen />
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
