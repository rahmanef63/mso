export type DocsEntry = { title: string; body: string };
export type DocsGroup = { title: string; entries: DocsEntry[] };
export type DocsSectionId = "changelog" | "reference" | "shortcuts" | "architecture";

export type DocsSection = {
  id: DocsSectionId;
  label: string;
  summary: string;
  groups: DocsGroup[];
};

export const SHORTCUTS: DocsGroup[] = [
  {
    title: "Windows and apps",
    entries: [
      { title: "Open the app launcher", body: "Super or the dock button opens the app grid from any window." },
      { title: "Close the focused window", body: "Ctrl+W or Cmd+W closes the focused window when nothing is unsaved." },
      { title: "Cycle windows", body: "Alt+Tab or Cmd+Tab cycles focus through open windows in z-order." },
      { title: "Toggle maximise", body: "Double-click the title bar, or press Ctrl+Shift+M on the focused window." },
    ],
  },
  {
    title: "Files and editor",
    entries: [
      { title: "Save the active buffer", body: "Ctrl+S or Cmd+S writes the buffer in the Code Editor." },
      { title: "Open a path", body: "Enter submits a path lookup in Files, the Media Viewer, and picker forms." },
      { title: "Navigate a list", body: "Tab and Shift+Tab move through interactive controls in focus order." },
      { title: "Page through media", body: "ArrowLeft and ArrowRight move to the previous or next previewable file in the folder." },
    ],
  },
];

export const REFERENCE: DocsGroup[] = [
  {
    title: "Surface model",
    entries: [
      { title: "Windows are per-app", body: "Every app opens in its own window with independent state and an isolated scroll position." },
      { title: "Dock entries are registry driven", body: "The dock renders the shell app catalog. Custom shell apps appear alongside built-in slices." },
      { title: "Split origins stay split", body: "Remote app frames load from their own origin. MSO never proxies another origin's session cookie." },
    ],
  },
  {
    title: "Media and pickers",
    entries: [
      { title: "Media Viewer scope", body: "Images, audio, video, and text open inline. Everything else offers a download instead of a blank frame." },
      { title: "Icon Picker catalog", body: "Icons are 24x24 stroke SVGs with stable ids. Size and color are preview-only and never mutate the catalog." },
      { title: "Image Picker sources", body: "VPS Folder lists host directories over /api/v1/fs/list; Stock Search queries /api/v1/stock/search with attribution." },
    ],
  },
  {
    title: "Runtime apps",
    entries: [
      { title: "Camoufox viewer", body: "The remote browser streams from a separately authenticated noVNC origin. Power changes are two-step." },
      { title: "Bot Desktops", body: "Each card shows a live screenshot from /api/v1/desktop/screenshot. Lifecycle verbs require Operator or Owner." },
      { title: "n8n workspace", body: "n8n renders in a single-bar workspace. If the host refuses framing, use the external open action." },
    ],
  },
];

export const ARCHITECTURE: DocsGroup[] = [
  {
    title: "Authorization boundary",
    entries: [
      { title: "Server enforces roles", body: "MSO checks Viewer, Operator, and Owner on the server for every request." },
      { title: "UI is convenience only", body: "Hiding or disabling a control is not an authorization boundary, and unknown mutations fail to Owner." },
      { title: "Device roles are not Linux users", body: "Device roles map to approved devices, not to shell accounts or single sign-on identities." },
    ],
  },
  {
    title: "Host and data boundaries",
    entries: [
      { title: "Private state is guarded", body: "Runtime and credential state under the MSO private directory is refused by host-file guards." },
      { title: "Filesystem is authenticated", body: "Filesystem calls use authenticated no-store endpoints and return normalized error messages." },
      { title: "Shell bridge is explicit", body: "Local desktop and web clients stay same-origin unless the shell bridge declares an approved API origin." },
    ],
  },
  {
    title: "Change and release",
    entries: [
      { title: "Changelog is generated", body: "What's New reads the deployment's generated changelog endpoint. A fresh checkout may have none yet." },
      { title: "Feature contracts are ratcheted", body: "Each slice declares a contract entry and must pass the feature boundary check before shipping." },
      { title: "No raw HTML rendering", body: "Documentation renders as structured text. The shell never injects unescaped markup into the reader." },
    ],
  },
];

export const STATIC_SECTIONS: DocsSection[] = [
  { id: "reference", label: "Quick Reference", summary: "Surface model, media, pickers, and runtime apps", groups: REFERENCE },
  { id: "shortcuts", label: "Keyboard Shortcuts", summary: "Window, app, and editor key bindings", groups: SHORTCUTS },
  { id: "architecture", label: "Architecture and Security", summary: "Authorization, host boundaries, release rules", groups: ARCHITECTURE },
];

/** Case-insensitive filter that keeps group headings whose entries (or the heading
 *  itself) match. Empty query returns the input untouched. */
export function filterGroups(groups: readonly DocsGroup[], query: string): DocsGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups.map((group) => ({ title: group.title, entries: [...group.entries] }));
  return groups.flatMap((group): DocsGroup[] => {
    if (group.title.toLowerCase().includes(q)) return [{ title: group.title, entries: [...group.entries] }];
    const entries = group.entries.filter((entry) =>
      `${entry.title} ${entry.body}`.toLowerCase().includes(q));
    return entries.length > 0 ? [{ title: group.title, entries }] : [];
  });
}

export function countEntries(groups: readonly DocsGroup[]): number {
  return groups.reduce((sum, group) => sum + group.entries.length, 0);
}
