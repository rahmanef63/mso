import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "./mono-font";
import { RegisterSW } from "./register-sw";
import { InstallPrompt } from "./install-prompt";
import "./globals.css";
import { publicMsoOrigin } from "@/lib/mcp/ui-config";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(publicMsoOrigin()),
    applicationName: "Manef Shell OS",
    title: "Manef Shell OS — browser-based server control plane",
    description:
      "A browser-based graphical shell for a Linux server you own — terminal, files, metrics, and AI in one mobile-first pane.",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "MSO",
      statusBarStyle: "black-translucent",
    },
    // Favicon + apple-touch + OG come from the file conventions (app/icon.svg,
    // app/apple-icon.tsx, app/opengraph-image.tsx) — no manual `icons` field.
    openGraph: {
      title: "Manef Shell OS — browser-based server control plane",
      description:
        "A browser-based graphical shell for a Linux server you own — terminal, files, metrics, and AI in one mobile-first pane.",
      siteName: "Manef Shell OS",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Manef Shell OS — browser-based server control plane",
      description:
        "A browser-based graphical shell for a Linux server you own — terminal, files, metrics, and AI in one mobile-first pane.",
    },
    // Owner-only tool behind client auth — keep it out of search indexes (every
    // catch-all slug returns 200 HTML). The GitHub repo is the discoverable surface.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch / home-bar so the shell's safe-area-inset padding
  // (--sai-*) actually has insets to work with in standalone mode.
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Per-request nonce (set by proxy.ts) so the pre-hydration theme script passes
  // the strict CSP script-src.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Geist variable classes MUST live on <html>: --font-ui/--font-mono-ui are
  // defined on :root and reference var(--font-geist-*) — defined only on
  // <body>, the :root custom property is invalid at computed-value time and
  // silently collapses to the Tailwind preflight stack (fonts never apply).
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="antialiased overflow-hidden select-none">
        {/* Pre-hydration theme: set data-theme from localStorage before the body
            paints (dark users otherwise get a light flash). A raw nonced <script>
            at body-top runs synchronously during parse; the nonce (proxy.ts →
            x-nonce header) satisfies the strict CSP script-src. */}
        {/* suppressHydrationWarning is REQUIRED here, not cosmetic. Browsers blank the
            `nonce` content attribute once CSP has consumed it — a deliberate
            anti-exfiltration measure — so the DOM reports nonce="" while the server
            HTML carried the real value. React compares the attribute and reports a
            mismatch on EVERY page load. Confirmed against a non-minified dev build:
              + nonce="NjA3NDAxNWIt…"   (server)
              - nonce=""                (client)
            The nonce itself must stay: proxy.ts mints it per request and the strict
            CSP script-src will not execute this script without it. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=JSON.parse(localStorage.getItem("mso:tweaks"));if(t&&t.theme)document.documentElement.dataset.theme=t.theme;var s=document.getElementById("mso-boot-splash");if(s&&t&&t.theme==="dark")s.style.background="linear-gradient(145deg,#161629 0%,#10152c 58%,#0b1223 100%)";}catch(e){}',
          }}
        />
        {/* Pre-paint boot splash (UX-02): wallpaper gradient + spinner so cold
            load is not blank grey while JS/CSS hydrate. Removed by OsRoot. */}
        <div
          id="mso-boot-splash"
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483000,
            display: "grid",
            placeItems: "center",
            background:
              "linear-gradient(145deg, #d3c5bd 0%, #d9dce7 56%, #b7c8dc 100%)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              border: "2px solid rgba(255,255,255,0.9)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "mso-boot-spin 0.8s linear infinite",
            }}
          />
          <style
            dangerouslySetInnerHTML={{
              __html: "@keyframes mso-boot-spin{to{transform:rotate(360deg)}}",
            }}
          />
        </div>
        {children}
        <RegisterSW />
        <InstallPrompt />
      </body>
    </html>
  );
}
