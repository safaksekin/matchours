// app/layout.js
import { SITE_URL } from "./_lib/routes";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "fikstür.com — Tüm Spor İstatistikleri, Canlı Skorlar ve Fikstür",
  description: "Futbol, basketbol, voleybol ve daha fazlası: canlı skorlar, fikstür, puan durumu, gol krallığı ve maç istatistikleri tek ekranda.",
};

// viewport-fit=cover lets env(safe-area-inset-*) work on iOS notch devices.
// maximumScale prevents the iOS auto-zoom on input focus.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#E8F3F5",
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}