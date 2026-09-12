import type { UpdateStatus } from "@/lib/host/self-update";

export async function readStatus(check: boolean): Promise<UpdateStatus> {
  const res = await fetch(`/api/v1/sys/update${check ? "" : "?check=0"}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403
    ? "Sign in as an Owner to check software updates."
    : `Could not read update status (HTTP ${res.status}). Try again.`);
  return (await res.json()) as UpdateStatus;
}

