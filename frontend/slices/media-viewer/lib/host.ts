// Single host seam — re-exports the mso raw-bytes URL helper via the shell
// barrel (a legal alias). Lifting the slice swaps this file for an injected one;
// no other file in the slice imports host I/O directly.
export { useOsApi } from "@/features/appshell";
export { rawUrl } from "@/lib/os-api";
// Pure string math, not host I/O — same category as `cn`, so it comes straight
// from lib rather than through the seam above (and keeps a plain helper module
// out of the shell barrel's module graph).
export { joinPath, parentPath } from "@/lib/path";
