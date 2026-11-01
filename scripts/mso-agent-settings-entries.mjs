// The registry entries, kept apart from the loader so the loader stays under the line ratchet.
// Every entry here must have a real consumer: a setting that changes nothing is worse than no setting,
// because it teaches the user that the settings panel is decoration.

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
];
