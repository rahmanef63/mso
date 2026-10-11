import type { UpdateStatus } from "@/lib/host/self-update";

export async function readStatus(check: boolean): Promise<UpdateStatus> {
  const res = await fetch("/api/v1/sys/update", {
    ...(check ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "check" }) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403
    ? "Sign in as an Owner to check software updates."
    : `Could not read update status (HTTP ${res.status}). Try again.`);
  return (await res.json()) as UpdateStatus;
}

export function hasAvailableUpdate(status: Pick<UpdateStatus, "behind" | "pendingBuild" | "remoteChecked">): boolean {
  return status.pendingBuild === true || (status.remoteChecked === true && status.behind > 0);
}


let badgeCheck: Promise<boolean> | undefined;

export function readBadgeStatus(): Promise<boolean> {
  if (badgeCheck) return badgeCheck;
  try {
    const cached = JSON.parse(sessionStorage.getItem("mso:update-badge:v1") ?? "null") as { checkedAt?: unknown; available?: unknown } | null;
    if (typeof cached?.checkedAt === "number" && typeof cached.available === "boolean") {
      const age = Date.now() - cached.checkedAt;
      if (age >= 0 && age < 60_000) return Promise.resolve(cached.available);
    }
  } catch { /* unavailable storage must not prevent version discovery */ }
  // Background badges share a check across mounts/reloads; explicit checks stay fresh.
  badgeCheck = readStatus(true).then((status) => {
    const available = hasAvailableUpdate(status);
    try { sessionStorage.setItem("mso:update-badge:v1", JSON.stringify({ checkedAt: Date.now(), available })); }
    catch { /* keep the result usable when storage is unavailable */ }
    return available;
  }).finally(() => { badgeCheck = undefined; });
  return badgeCheck;
}
