import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "../../app/mono-font";
import "../../app/globals.css";

export const metadata: Metadata = {
  title: "Manef Shell OS Demo",
  description: "Explore the MSO interface with sample data.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="antialiased overflow-hidden select-none">{children}</body>
    </html>
  );
}
