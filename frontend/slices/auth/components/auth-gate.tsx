"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAppearance } from "@/lib/appearance";
import { IS_DEMO } from "@/lib/demo";
import { SessionModeBanner } from "./session-mode-banner";
import { useSession } from "../lib/use-session";

// The shell is PUBLIC: anyone can open it and browse on mock data — no sign-in
// wall. Sign-in is admin-only and unlocks live host access (files/terminal/
// monitor); every /api host route enforces the session server-side, so a
// signed-out visitor is confined to mock (see lib/os-api). Sign-in lives inside
// the shell (Settings → Server). This gate now only shows a brief splash while
// the session resolves (avoids a mock→live flash for the owner) + the DEMO badge.
export function AuthGate({ children }: { children: ReactNode }) {
  if (IS_DEMO) {
    return (
      <>
        {children}
        <DemoModeOverlay />
      </>
    );
  }
  return <GatedOS>{children}</GatedOS>;
}

function DemoModeOverlay() {
  const tasks = [
    "Open System Monitor",
    "Browse a sample project",
    "Open Terminal",
    "Switch to mobile view",
    "Ask Alfa about a mock server warning",
  ];
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] bg-amber-500 px-3 py-1.5 text-center text-xs font-bold text-amber-950 shadow">
        Demo Mode — Mock data only. No real server is connected.
      </div>
      <div className="pointer-events-none fixed bottom-3 left-3 z-[60] max-w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-border/70 bg-popover/95 p-3 text-xs text-popover-foreground shadow-lg backdrop-blur">
        <div className="mb-1 font-semibold">Guided demo</div>
        <ol className="space-y-0.5">
          {tasks.map((task, i) => (
            <li key={task}>{i + 1}. {task}</li>
          ))}
        </ol>
      </div>
    </>
  );
}

function GatedOS({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === "loading") return <Splash />;
  return (
    <>
      {children}
      <SessionModeBanner />
      {status === "in" && <FirstLoginOnboarding />}
    </>
  ); // signed-in AND signed-out → the shell (mock when out)
}

function Splash() {
  const { tweaks } = useAppearance();
  return (
    <div className="relative grid h-dvh w-screen place-items-center">
      <div
        className={cn(!tweaks.wallpaperStyle && `wp-${tweaks.wallpaper === "auto" ? "aurora" : tweaks.wallpaper}`, "absolute inset-0 -z-10 bg-cover bg-center")}
        style={tweaks.wallpaperStyle}
      />
      <Loader2 className="size-6 animate-spin text-white drop-shadow" />
    </div>
  );
}

const ONBOARDING_KEY = "mso:onboarding:v1";
const ONBOARDING_OPEN = "mso:onboarding:open";

type StatusInfo = {
  linuxUser: string;
  readRoots: string[];
  writeRoots: string[];
  currentAccess: string;
  publicExposureWarning: string | null;
};

function FirstLoginOnboarding() {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(ONBOARDING_KEY) !== "done";
  });
  const [info, setInfo] = useState<StatusInfo | null>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(ONBOARDING_OPEN, onOpen);
    return () => window.removeEventListener(ONBOARDING_OPEN, onOpen);
  }, []);

  useEffect(() => {
    if (!open || info) return;
    let alive = true;
    fetch("/api/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: StatusInfo | null) => {
        if (alive && body) setInfo(body);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, info]);

  function close() {
    localStorage.setItem(ONBOARDING_KEY, "done");
    setOpen(false);
  }

  if (!open) return null;

  const steps = [
    "Welcome to MSO",
    "Confirm security posture",
    "Check filesystem roots",
    "Check device approval",
    "Open System Monitor",
    "Open Files",
    "Launch Terminal",
    "Configure AI optionally",
  ];

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-background/65 p-4 backdrop-blur-sm">
      <div className="max-h-[min(42rem,calc(100dvh-2rem))] w-full max-w-xl overflow-auto rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl">
        <div className="space-y-1">
          <h2 className="text-lg font-bold">Welcome to MSO</h2>
          <p className="text-sm text-muted-foreground">
            MSO gives this browser terminal and file access as the Linux user below. Review this before using live mode.
          </p>
        </div>

        <div className="mt-4 grid gap-2 rounded-lg border border-border/70 bg-muted/35 p-3 text-sm">
          <InfoRow label="MSO is running as" value={info?.linuxUser ?? "Loading..."} />
          <InfoRow label="Read roots" value={info?.readRoots?.join(":") ?? "Loading..."} />
          <InfoRow label="Write roots" value={info?.writeRoots?.join(":") ?? "Loading..."} />
          <InfoRow label="Current access" value={info?.currentAccess ?? "Loading..."} />
          {info?.publicExposureWarning && (
            <p className="rounded-md bg-amber-500/15 p-2 text-xs font-medium text-amber-700 dark:text-amber-300">
              {info.publicExposureWarning}
            </p>
          )}
        </div>

        <ol className="mt-4 grid gap-2 text-sm">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-4 text-xs text-muted-foreground">
          AI setup is optional. This onboarding does not change security settings.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
            Skip
          </button>
          <button type="button" onClick={close} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_1fr]">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="break-words font-mono text-xs">{value}</span>
    </div>
  );
}

export function openOnboarding() {
  window.dispatchEvent(new Event(ONBOARDING_OPEN));
}
