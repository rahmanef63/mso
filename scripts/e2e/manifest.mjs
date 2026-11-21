// Single source of truth for MSO's release E2E journeys and which domains/slices
// each journey covers. Consumed by scripts/ci/affected.mjs and scripts/verify-build.sh.

export const RELEASE_E2E_JOURNEYS = Object.freeze([
  {
    id: "release",
    script: "scripts/e2e/release.mjs",
    label: "mandatory release E2E",
    domains: ["core", "auth", "mcp", "workflows", "organization", "agent-vault", "integrations", "store", "camoufox", "memory-graph", "os-settings"],
    slices: ["auth", "os-settings", "integrations", "workflows", "organization", "agent-vault", "app-store", "extensions", "camoufox-browser", "memory-graph", "managed-apps"],
    parallelSafe: false,
  },
  {
    id: "integrations-shell",
    script: "scripts/e2e/integrations-shell.mjs",
    label: "native Integrations shell journey",
    domains: ["integrations", "infra"],
    slices: ["integrations", "infrastructure"],
    parallelSafe: true,
  },
  {
    id: "integrations",
    script: "scripts/e2e/integrations.mjs",
    label: "Integrations credential actions (synthetic accounts)",
    domains: ["integrations", "infra"],
    slices: ["integrations"],
    parallelSafe: true,
  },
  {
    id: "google-integrations",
    script: "scripts/e2e/google-integrations.mjs",
    label: "native Google Integrations UI (synthetic accounts)",
    domains: ["integrations", "infra"],
    slices: ["integrations"],
    parallelSafe: true,
  },
  {
    id: "shell-status",
    script: "scripts/e2e/shell-status.mjs",
    label: "shell-native server status",
    domains: ["core", "os-shell", "appshell", "system-monitor"],
    slices: ["os-shell", "appshell", "system-monitor", "os-settings"],
    parallelSafe: true,
  },
  {
    id: "assistant-chat-ux",
    script: "scripts/e2e/assistant-chat-ux.mjs",
    label: "Assistant chat UX (synthetic tools and provider)",
    domains: ["assistant", "ai", "agent"],
    slices: ["assistant"],
    parallelSafe: true,
  },
  {
    id: "bundle-performance",
    script: "scripts/e2e/bundle-performance.mjs",
    label: "deferred shell performance",
    domains: ["core", "appshell", "os-shell"],
    slices: ["appshell", "os-shell"],
    parallelSafe: true,
  },
  {
    id: "macos-figma",
    script: "scripts/e2e/macos-figma.mjs",
    label: "reviewed macOS chrome",
    domains: ["core", "appshell", "os-shell"],
    slices: ["appshell", "os-shell"],
    parallelSafe: true,
  },
  {
    id: "ios-lock",
    script: "scripts/e2e/ios-lock.mjs",
    label: "privacy-safe iOS lock",
    domains: ["core", "appshell", "auth"],
    slices: ["appshell", "auth"],
    parallelSafe: true,
  },
]);

/**
 * @param {{ core?: boolean; slices?: string[]; domains?: string[] }} [options]
 * @returns {string[]}
 */
export function selectJourneys({ core = false, slices = [], domains = [] } = {}) {
  if (core) return RELEASE_E2E_JOURNEYS.map((j) => j.id);
  const sliceSet = new Set(slices);
  const domainSet = new Set(domains);
  const matched = RELEASE_E2E_JOURNEYS.filter(
    (j) =>
      j.slices.some((s) => sliceSet.has(s)) ||
      j.domains.some((d) => domainSet.has(d)),
  ).map((j) => j.id);
  if (matched.length === 0) return ["shell-status"];
  return matched;
}
