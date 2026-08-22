// MSO app artwork.
//
// Raster app artwork is intentionally WebP. Toolbar/menu/control glyphs stay
// vector (Lucide), while app icons are allowed to carry richer platform-specific
// illustration. macOS and Windows do NOT share the same art direction: the shell
// chooses the correct image through data-shell CSS. Mobile intentionally reuses
// those families: iOS = macOS artwork, Android = Windows artwork.
import type { AppIconComponent } from "@/features/appshell";

/** One app identity with distinct native-looking artwork per desktop shell. */
function platformMark(fallback: string, macos: string, windows: string): AppIconComponent {
  const Mark: AppIconComponent = ({ className: cls }) => {
    const size = cls ?? "size-full";
    return (
      <span className={`shell-platform-mark relative block ${size}`} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fallback} alt="" className="shell-artwork shell-artwork-default" draggable={false} decoding="async" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={macos} alt="" className="shell-artwork shell-artwork-macos" draggable={false} decoding="async" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={windows} alt="" className="shell-artwork shell-artwork-windows" draggable={false} decoding="async" />
      </span>
    );
  };
  Mark.displayName = `PlatformArtwork(${macos},${windows})`;
  return Mark;
}

export const APP_MARKS: Record<string, AppIconComponent> = {
  "files-manager": platformMark(
    "/app-icons/files.webp",
    "/app-icons/macos/files.webp",
    "/app-icons/windows/files.webp",
  ),
  "camoufox-browser": platformMark("/brand/official/camoufox.webp", "/app-icons/macos/camoufox.webp", "/app-icons/windows/camoufox.webp"),
  "code-editor": platformMark(
    "/app-icons/code.webp",
    "/app-icons/macos/code.webp",
    "/app-icons/windows/code.webp",
  ),
  "os-terminal": platformMark(
    "/app-icons/terminal.webp",
    "/app-icons/macos/terminal.webp",
    "/app-icons/windows/terminal.webp",
  ),
  "claude-code": platformMark("/app-icons/claude.webp", "/app-icons/macos/claude.webp", "/app-icons/windows/claude.webp"),
  "media-studio": platformMark(
    "/app-icons/studio.webp",
    "/app-icons/macos/studio.webp",
    "/app-icons/windows/studio.webp",
  ),
  "reel-editor": platformMark("/app-icons/reel.webp", "/app-icons/macos/reel.webp", "/app-icons/windows/reel.webp"),
  "media-viewer": platformMark("/app-icons/viewer.webp", "/app-icons/macos/viewer.webp", "/app-icons/windows/viewer.webp"),
  "app-store": platformMark(
    "/app-icons/store.webp",
    "/app-icons/macos/store.webp",
    "/app-icons/windows/store.webp",
  ),
  "create-app": platformMark("/app-icons/create.webp", "/app-icons/macos/create.webp", "/app-icons/windows/create.webp"),
  "system-monitor": platformMark(
    "/app-icons/monitor.webp",
    "/app-icons/macos/monitor.webp",
    "/app-icons/windows/monitor.webp",
  ),
  assistant: platformMark(
    "/app-icons/assistant.webp",
    "/app-icons/macos/assistant.webp",
    "/app-icons/windows/assistant.webp",
  ),
  "os-settings": platformMark(
    "/app-icons/settings.webp",
    "/app-icons/macos/settings.webp",
    "/app-icons/windows/settings.webp",
  ),
  quicklinks: platformMark("/app-icons/links.webp", "/app-icons/macos/links.webp", "/app-icons/windows/links.webp"),
  docs: platformMark(
    "/app-icons/docs.webp",
    "/app-icons/macos/docs.webp",
    "/app-icons/windows/docs.webp",
  ),
  hermes: platformMark("/brand/official/hermes.webp", "/app-icons/macos/hermes.webp", "/app-icons/windows/hermes.webp"),
  openclaw: platformMark("/brand/official/openclaw.webp", "/app-icons/macos/openclaw.webp", "/app-icons/windows/openclaw.webp"),
};

export const HermesMark = APP_MARKS.hermes;
export const OpenClawMark = APP_MARKS.openclaw;
export const CamoufoxMark = APP_MARKS["camoufox-browser"];
