export async function requestBackup<T>(body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
  const suffix = query ? `?${new URLSearchParams(query)}` : "";
  const response = await fetch(`/api/v1/sys/memory-backup${suffix}`, {
    cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Memory backup failed (${response.status})`);
  return value;
}
