import localFont from "next/font/local";

// Same locally installed font and CSS variable, but only fetch when text uses it.
// Do not preload 71 KB of monospace on login/install or a sans-only shell.
export const GeistMono = localFont({
  src: "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Roboto Mono", "Menlo", "Monaco",
    "Liberation Mono", "DejaVu Sans Mono", "Courier New", "monospace"],
});
