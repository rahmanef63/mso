import type { ServerTarget, SshServerTarget } from "@/lib/appearance";

/** Pure presentation helpers for the Devices host card. Kept out of the component
 *  so that file stays inside the 220-line architecture cap. */

export function targetSubtitle(target: ServerTarget): string {
  if (target.kind === "mock") return "Safe demo data; no host access.";
  if (target.kind === "local") return "Same-origin MSO host API on this VPS.";
  return target.host
    ? `SSH over Tailscale: ${target.user ? `${target.user}@` : ""}${target.host}`
    : "Configure a Tailscale SSH host.";
}

/** Friendly kind label — never the raw enum ("ssh"/"mock"). */
export function kindLabel(target: ServerTarget): string {
  if (target.kind === "local") return "Live";
  if (target.kind === "mock") return "Mock";
  return "SSH: not connected";
}

export function isSsh(target: ServerTarget): target is SshServerTarget {
  return target.kind === "ssh";
}
