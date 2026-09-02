// Single integration seam between this slice and the host app (mso).
// EVERYTHING OS-specific funnels through here — shell services (toasts,
// inspector, activity), the fs/api client, and responsive detection — so
// lifting the slice to the rr catalog means swapping THIS file for injected
// capabilities. No other file in the slice imports from outside it (UI
// primitives `@/components/ui/*` + `@/lib/utils` excepted; rr installs those).

export {
  toast,
  usePublishInspector,
  setActivity,
  clearActivity,
  useContainer,
  type AppDescriptor,
} from "@/features/appshell";

export { useOsApi, type FsEntry, type FsList } from "@/features/appshell";
export { rawUrl } from "@/lib/os-api";

export { useIsMobile } from "@/hooks/use-mobile";

// Hidden-input file picker primitive (rr's audit:templates forbids raw
// native file inputs in slice source — the picker owns the hidden input).
export { FilePicker, type FilePickerHandle } from "@/components/ui/file-picker";
