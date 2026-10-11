// MSO app artwork.
//
// Raster app artwork is intentionally WebP. Toolbar/menu/control glyphs stay
// vector (Lucide), while app icons are allowed to carry richer platform-specific
// illustration. macOS and Windows do NOT share the same art direction: the shell
// chooses one image through the active-shell context. Mobile intentionally reuses
// those families: iOS = macOS artwork, Android = Windows artwork.
import { useActiveShell, type AppIconComponent } from "@/features/appshell";

/** An official third-party brand mark is shell-invariant by definition. */
function officialMark(src: string): AppIconComponent {
  const Mark: AppIconComponent = ({ className: cls }) => (
    // Small fixed local brand asset; image optimization adds no value here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" aria-hidden className={cls ?? "size-full object-contain"} draggable={false} decoding="async" fetchPriority="low" />
  );
  Mark.displayName = `OfficialArtwork(${src})`;
  return Mark;
}

/** One app identity with distinct native-looking artwork per desktop shell. */
function platformMark(fallback: string, macos: string, windows: string): AppIconComponent {
  const Mark: AppIconComponent = ({ className: cls }) => {
    const { id } = useActiveShell();
    // Let the browser match artwork to its rendered width, including dock magnification.
    const src = id === "macos" || id === "ios" ? macos : id === "windows" || id === "android" ? windows : fallback;
    const width = src === fallback ? 192 : 256;
    const size = cls ?? "size-full";
    return (
      <span className={`shell-platform-mark relative block ${size}`} aria-hidden>
        <picture>
          {/* Dense screens share full-resolution art; AVIF reduces bytes with a WebP fallback. */}
          {width === 256 && <source media="(resolution > 2dppx)" type="image/avif" srcSet={src.replace(".webp", ".avif")} />}
          <source media="(resolution > 2dppx)" srcSet={src} />
          <img src={src} srcSet={`${src.replace(".webp", "-128.webp")} 128w, ${src} ${width}w`} sizes="auto, 256px" width={width} height={width} loading="lazy" alt="" className="shell-artwork" draggable={false} decoding="async" fetchPriority="low" />
        </picture>
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
  "camoufox-browser": officialMark("/brand/official/camoufox.webp"),
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
  hermes: officialMark("/brand/official/hermes.webp"),
  n8n: officialMark("/brand/official/n8n.svg"),
  openclaw: officialMark("/brand/official/openclaw.webp"),
  "9router": officialMark("/brand/official/9router.webp"),
};

export const HermesMark = APP_MARKS.hermes;
export const OpenClawMark = APP_MARKS.openclaw;
export const NineRouterMark = APP_MARKS["9router"];
export const CamoufoxMark = APP_MARKS["camoufox-browser"];
