import type { Metadata, Viewport } from "next";
import "./globals.css";
import { geistSans, geistMono, instrumentSerif } from "@/lib/fonts";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { Marquee } from "@/components/site/Marquee";
import { site } from "@/data/site";

export const metadata: Metadata = {
  title: {
    default: `${site.longName} — ${site.product}`,
    template: `%s · ${site.longName} ${site.product}`,
  },
  description: site.lede,
  applicationName: `${site.longName} ${site.product}`,
  authors: [{ name: site.longName }],
  keywords: [
    "FlyLo",
    "FlyLo booking",
    "premium airline reservations",
    "Atlas Suite",
    "Prospect",
    "Linen",
  ],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F4F2EC",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <body className="min-h-dvh flex flex-col antialiased">
        <Marquee />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
