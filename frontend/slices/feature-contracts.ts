// Declarative feature governance contract for every vertical slice under
// frontend/slices/. Checked 1:1 against the directory tree by scripts/check-features.mjs.

export type FeatureSurfaceKind = "frame" | "canvas" | "iframe" | "shell" | "utility";
export type FeatureMinRole = "viewer" | "operator" | "owner";
export type FeatureStateStrategy =
  | "feature-state"
  | "server-api"
  | "ephemeral"
  | "legacy-local-storage";
export type FeatureUpdatableTier = "core" | "bundled-feature" | "extractable-modular";

export type SliceContract = {
  surfaceKind: FeatureSurfaceKind;
  minRole: FeatureMinRole;
  stateStrategy: FeatureStateStrategy;
  updatableTier: FeatureUpdatableTier;
  e2e: readonly string[];
};

export const FEATURE_CONTRACTS: Readonly<Record<string, SliceContract>> = {
  "agent-group": { surfaceKind: "frame", minRole: "owner", stateStrategy: "server-api", updatableTier: "extractable-modular", e2e: [] },
  "agent-vault": { surfaceKind: "frame", minRole: "owner", stateStrategy: "legacy-local-storage", updatableTier: "extractable-modular", e2e: ["release"] },
  "app-store": { surfaceKind: "frame", minRole: "owner", stateStrategy: "legacy-local-storage", updatableTier: "core", e2e: ["release"] },
  appshell: { surfaceKind: "shell", minRole: "viewer", stateStrategy: "feature-state", updatableTier: "core", e2e: ["release", "shell-status", "bundle-performance", "macos-figma", "ios-lock"] },
  assistant: { surfaceKind: "frame", minRole: "owner", stateStrategy: "legacy-local-storage", updatableTier: "bundled-feature", e2e: ["assistant-chat-ux"] },
  auth: { surfaceKind: "utility", minRole: "viewer", stateStrategy: "legacy-local-storage", updatableTier: "core", e2e: ["release", "ios-lock"] },
  "bot-desktops": { surfaceKind: "frame", minRole: "owner", stateStrategy: "server-api", updatableTier: "extractable-modular", e2e: [] },
  "camoufox-browser": { surfaceKind: "iframe", minRole: "operator", stateStrategy: "server-api", updatableTier: "bundled-feature", e2e: ["release"] },
  channels: { surfaceKind: "frame", minRole: "owner", stateStrategy: "server-api", updatableTier: "extractable-modular", e2e: [] },
  "code-editor": { surfaceKind: "canvas", minRole: "owner", stateStrategy: "feature-state", updatableTier: "bundled-feature", e2e: [] },
  "create-app": { surfaceKind: "frame", minRole: "owner", stateStrategy: "feature-state", updatableTier: "core", e2e: [] },
  docs: { surfaceKind: "frame", minRole: "viewer", stateStrategy: "ephemeral", updatableTier: "core", e2e: ["release"] },
  extensions: { surfaceKind: "utility", minRole: "owner", stateStrategy: "legacy-local-storage", updatableTier: "core", e2e: ["release"] },
  "files-manager": { surfaceKind: "frame", minRole: "viewer", stateStrategy: "server-api", updatableTier: "bundled-feature", e2e: ["release"] },
  "icon-picker": { surfaceKind: "utility", minRole: "viewer", stateStrategy: "legacy-local-storage", updatableTier: "core", e2e: [] },
  "image-editor": { surfaceKind: "canvas", minRole: "owner", stateStrategy: "legacy-local-storage", updatableTier: "extractable-modular", e2e: [] },
  "image-picker": { surfaceKind: "utility", minRole: "viewer", stateStrategy: "ephemeral", updatableTier: "core", e2e: [] },
  infrastructure: { surfaceKind: "frame", minRole: "owner", stateStrategy: "server-api", updatableTier: "extractable-modular", e2e: ["integrations-shell"] },
  integrations: { surfaceKind: "iframe", minRole: "owner", stateStrategy: "server-api", updatableTier: "core", e2e: ["release", "integrations-shell", "integrations", "google-integrations"] },
  "managed-apps": { surfaceKind: "iframe", minRole: "operator", stateStrategy: "server-api", updatableTier: "bundled-feature", e2e: ["release"] },
  "media-studio": { surfaceKind: "canvas", minRole: "owner", stateStrategy: "legacy-local-storage", updatableTier: "extractable-modular", e2e: [] },
  "media-viewer": { surfaceKind: "frame", minRole: "viewer", stateStrategy: "ephemeral", updatableTier: "bundled-feature", e2e: [] },
  "memory-graph": { surfaceKind: "frame", minRole: "owner", stateStrategy: "legacy-local-storage", updatableTier: "extractable-modular", e2e: ["release"] },
  n8n: { surfaceKind: "frame", minRole: "operator", stateStrategy: "server-api", updatableTier: "extractable-modular", e2e: ["workflow-embeds"] },
  organization: { surfaceKind: "frame", minRole: "owner", stateStrategy: "server-api", updatableTier: "extractable-modular", e2e: ["release"] },
  "os-settings": { surfaceKind: "frame", minRole: "viewer", stateStrategy: "feature-state", updatableTier: "core", e2e: ["release", "shell-status"] },
  "os-shell": { surfaceKind: "shell", minRole: "viewer", stateStrategy: "ephemeral", updatableTier: "core", e2e: ["release", "shell-status", "bundle-performance", "macos-figma"] },
  "os-terminal": { surfaceKind: "canvas", minRole: "owner", stateStrategy: "server-api", updatableTier: "bundled-feature", e2e: [] },
  quicklinks: { surfaceKind: "frame", minRole: "viewer", stateStrategy: "server-api", updatableTier: "bundled-feature", e2e: [] },
  "reel-editor": { surfaceKind: "canvas", minRole: "owner", stateStrategy: "legacy-local-storage", updatableTier: "extractable-modular", e2e: [] },
  "shell-settings": { surfaceKind: "utility", minRole: "viewer", stateStrategy: "ephemeral", updatableTier: "core", e2e: [] },
  "system-monitor": { surfaceKind: "frame", minRole: "viewer", stateStrategy: "server-api", updatableTier: "core", e2e: ["shell-status"] },
  workflows: { surfaceKind: "frame", minRole: "owner", stateStrategy: "feature-state", updatableTier: "extractable-modular", e2e: ["release"] },
};
