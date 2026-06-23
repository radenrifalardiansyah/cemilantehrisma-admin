import type { Metadata } from "next";
import "./globals.css";
import AdminSplashScreen from "@/components/AdminSplashScreen";

export const metadata: Metadata = {
  title: "Dashboard Admin — Cemilan Teh Risma",
  description: "Admin dashboard Cemilan Teh Risma",
  robots: { index: false, follow: false },
  appleWebApp: false,
  other: {
    "mobile-web-app-capable": "no",
    "apple-mobile-web-app-capable": "no",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <AdminSplashScreen />
        {children}
      </body>
    </html>
  );
}
