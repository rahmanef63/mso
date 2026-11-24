// Crisp 24x24 stroke icons, one geometry per ICON_CATALOG id. Kept out of
// media-api.ts so the API surface stays data-only and the picker can render
// scalable SVG instead of font glyphs.
const PATHS: Record<string, string> = {
  home: "M3 10.6 12 3l9 7.6V21h-6v-6.5H9V21H3z",
  search: "M10.5 3a7.5 7.5 0 1 1 4.6 13.4L21 21M10.5 3a7.5 7.5 0 0 0 0 15",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M15.5 8.5l-2 5-5 2 2-5z",
  layers: "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  folder: "M3 6.5h6l2 2h10V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z",
  "file-text": "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  code: "M8.5 7 4 12l4.5 5M15.5 7 20 12l-4.5 5",
  archive: "M3 4h18v4H3zM4.5 8v11a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8M10 12h4",
  image: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6M8.5 9.5h.01",
  music: "M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  film: "M3 4h18v16H3zM3 9h18M3 15h18M8 4v16M16 4v16",
  camera: "M3 8h4l2-2h6l2 2h4v11H3zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
  terminal: "M4 5h16v14H4zM8 10l2.5 2.5L8 15M13 15h4",
  cpu: "M8 8h8v8H8zM4 10h4M4 14h4M16 10h4M16 14h4M10 4v4M14 4v4M10 16v4M14 16v4",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  shield: "M12 3 5 6v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6z",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c3 3.6 3 14.4 0 18M12 3c-3 3.6-3 14.4 0 18",
  link: "M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.5 6.3M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.3-1.3",
  cloud: "M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.5 3.5 0 0 0 7 18",
  bell: "M12 3a5.5 5.5 0 0 0-5.5 5.5c0 5-2 6.5-2 6.5h15s-2-1.5-2-6.5A5.5 5.5 0 0 0 12 3M10 19a2 2 0 0 0 4 0",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.9 2.1 2.1.9-2.1.9L18 22l-.9-2.1L15 19l2.1-.9z",
  check: "M4 12.5 9 17.5 20 6.5",
};

export function iconPath(id: string): string {
  return PATHS[id] ?? PATHS.image ?? "";
}

/** Standalone SVG source for clipboard copy. Catalog ids are a fixed internal
 *  set, so nothing user-supplied reaches this markup. */
export function iconSvgMarkup(id: string, size = 24, color = "currentColor"): string {
  const path = iconPath(id);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"`,
    ` fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="${path}"/></svg>`,
  ].join("");
}

export const ICON_CATEGORIES = ["all", "navigation", "files", "media", "system", "network", "communication", "actions"] as const;
