export function rawUrl(path: string): string {
  if (path.startsWith("/demo-media/")) return path;
  return "/api/v1/fs/raw?path=" + encodeURIComponent(path);
}

export function zipUrl(base: string, names: string[], filename: string, exclude: string[] = []): string {
  const params = new URLSearchParams({ base, name: filename });
  for (const name of names) params.append("n", name);
  for (const value of exclude) params.append("x", value);
  return "/api/v1/fs/zip?" + params.toString();
}
