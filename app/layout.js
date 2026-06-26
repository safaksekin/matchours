// app/layout.js
export const metadata = {
  title: "matchours",
  description: "Tum spor istatistikleri, tek ekranda.",
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