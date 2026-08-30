const MAX_EMBED_URL = 2048;

/** External HTTPS only. Same-origin frames would share cockpit trust if sandbox flags drift. */
export function safeEmbedUrl(raw: string, cockpitOrigin?: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_EMBED_URL) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (cockpitOrigin) {
    try {
      if (url.origin === new URL(cockpitOrigin).origin) return null;
    } catch { return null; }
  }
  return url.toString();
}
