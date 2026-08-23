"use client";

import { Loader2, Power, ScanEye, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CamoufoxServiceStatus } from "./service-client";

/** The window's whole content whenever there is nothing to stream. This is the
 *  point of the app's power switch: the browser session is a real Firefox + Xvfb +
 *  x11vnc on the host, roughly a core and 1.5 GB while it lives, so leaving it up
 *  for a window nobody has open is pure waste — and before this panel existed the
 *  only way to stop it was a root shell. */
export function PowerPanel({
  status,
  busy,
  error,
  onStart,
}: {
  status: CamoufoxServiceStatus;
  busy: boolean;
  error: string | null;
  onStart: () => void;
}) {
  if (!status.installed) {
    return (
      <Shell icon={<TriangleAlert className="size-8 text-amber-500" />} title="No browser session on this host.">
        <p>
          The Browser app streams a real Firefox running on this server, published by the{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">camoufox-vnc</code> user service.
          That service is not installed here, so there is nothing to start.
        </p>
        {error && <Failure message={error} />}
      </Shell>
    );
  }

  return (
    <Shell icon={<ScanEye className="size-8 text-muted-foreground" />} title="The browser session is off.">
      <p>
        MSO&apos;s browser is a real Firefox running on this server and streamed here, so it renders
        the whole web — including the sites that refuse to be put in an iframe. It is switched off
        right now and using none of the server&apos;s memory or CPU.
      </p>
      <Button className="mt-1 [@media(pointer:coarse)]:min-h-[44px]" disabled={busy} onClick={onStart}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
        {busy ? "Starting the browser…" : "Turn the browser on"}
      </Button>
      <p className="text-[10px] text-muted-foreground">
        Takes a few seconds. It runs until you switch it off here, and stays off after a reboot. Your
        logins, history and open tabs are kept on the server&apos;s disk and come back next time.
      </p>
      {error && <Failure message={error} />}
    </Shell>
  );
}

function Shell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 overflow-auto bg-background px-4 py-6 text-center sm:px-6 sm:py-8">
      {icon}
      <p className="max-w-md text-sm font-medium">{title}</p>
      <div className="flex max-w-md flex-col items-center gap-3 text-[11px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
      {message}
    </p>
  );
}
