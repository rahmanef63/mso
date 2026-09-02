// Single host seam — re-exports the mso raw-bytes URL helper via the shell
// barrel (a legal alias). Lifting the slice swaps this file for an injected one;
// no other file in the slice imports host I/O directly.
export { rawUrl } from "@/lib/os-api";
