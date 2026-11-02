// The registry entries, kept apart from the loader so the loader stays under the line ratchet.
// Every entry here must have a real consumer: a setting that changes nothing is worse than no setting,
// because it teaches the user that the settings panel is decoration.
//
// Evaluated and refused diff settings from opencode (diffs.*):
// - diffs.wrap: diff lines are clipped by fitCells to pane width, never wrapped; wrap: word has no consumer.
// - diffs.view: side pane is 30-50 cols; split side-by-side view leaves 13-23 cols per side, unreadable.
// - diffs.tree: redundant because the files pane kind (/pane files) already lists changed files.
// - diffs.single: pane only ever displays the latest edit diff; multiple files cannot appear at once.

export const SETTINGS = [
  {
    category: "Session", key: "pane", path: "session.pane",
    description: "Side pane content to display", default: "off",
    values: ["todos", "diff", "files", "mcp", "context", "off"],
    keywords: ["sidebar", "panel", "paneKind"],
  },
  {
    category: "Session", key: "statusbar", path: "session.status_bar",
    description: "Dynamic status bar at bottom of prompt", default: "on",
    values: ["on", "off"], keywords: ["status", "bar", "statusbar"],
  },
  {
    category: "Tabs", key: "layout", path: "tabs.layout",
    description: "Tab bar layout orientation", default: "horizontal",
    values: ["horizontal", "vertical"],
    keywords: ["sidebar", "rail", "tabs", "tabLayout"],
  },
  {
    category: "Tabs", key: "indicators", path: "tabs.indicators",
    description: "Tab indicator style (numbers or status)", default: "numbers",
    values: ["status", "numbers"],
    keywords: ["tabs", "indicator", "indicators", "tabIndicators", "status icons"],
  },
  {
    category: "Tabs", key: "scope", path: "tabs.scope",
    description: "Tab bar session filtering scope (cwd or global)", default: "global",
    values: ["cwd", "global"],
    keywords: ["scope", "tabs", "directory", "cwd", "tabScope"],
  },
  {
    category: "Session", key: "minwidth", path: "session.pane_min_columns",
    description: "Minimum terminal width to show side pane", default: 100,
    min: 60, max: 200, keywords: ["minwidth", "min_columns", "pane_min_columns"],
  },
  {
    category: "Session", key: "grouping", path: "session.grouping",
    description: "Collapse repeated tool calls in transcript", default: "none",
    values: ["none", "auto"], keywords: ["group", "grouping", "collapse"],
  },
  {
    category: "Session", key: "verbosity", path: "session.verbosity",
    // Honesty rule: controls footer density only, not transcript detail
    description: "Status footer density (low, medium, high); does not affect transcript detail", default: "high",
    values: ["low", "medium", "high"], keywords: ["verbosity", "status", "footer", "density"],
  },
  {
    category: "Input", key: "speed", path: "scroll.speed",
    // Whole lines only: terminal row painting has no sub-line granularity
    description: "Lines to scroll per mouse wheel event", default: 3,
    min: 1, max: 10, keywords: ["scroll", "speed", "wheel"],
  },
  {
    category: "Input", key: "mouse", path: "mouse",
    description: "Terminal mouse reporting and interaction", default: "on",
    values: ["on", "off"], keywords: ["mouse", "click", "scroll"],
  },
];
