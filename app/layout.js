// app/layout.js
import { Manrope } from "next/font/google";
import { SITE_URL } from "./_lib/routes";

// Modern geometric sans, self-hosted. latin-ext carries Turkish glyphs (ğ ş ı İ ç ö ü).
const appFont = Manrope({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-app",
  display: "swap",
});

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
    <html lang="tr" className={appFont.variable}>
      <body style={{ margin: 0, fontFamily: "var(--font-app), 'Helvetica Neue', Helvetica, Arial, sans-serif", WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale", fontVariantNumeric: "tabular-nums", fontFeatureSettings: "'tnum' 1, 'cv11' 1" }}>{children}</body>
    </html>
  );
}