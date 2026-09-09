"use client";

import Link from "next/link";

import { AppearanceProvider } from "@/lib/appearance";
import { LoginCard } from "./login-screen";

export function ServerLoginPage({ returnTo }: { returnTo: string }) {
  return (
    <AppearanceProvider>
      <main className="grid h-dvh w-full place-items-center overflow-y-auto bg-background px-4 py-8 text-foreground">
        <div className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
          <LoginCard onAuthed={() => window.location.assign(returnTo)} />
          <p className="text-sm text-muted-foreground">Access follows this device’s approved role. Integrations require Owner access.</p>
          <Link prefetch={false} href="/" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
            Continue with demo data
          </Link>
        </div>
      </main>
    </AppearanceProvider>
  );
}
