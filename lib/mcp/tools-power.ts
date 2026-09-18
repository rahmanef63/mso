import { setCamoufoxEnabled } from "@/lib/camoufox/service";
import { performManagedAppAction } from "@/lib/managed-apps/manager";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { MANAGED_APP_ACTIONS, type ManagedAppAction } from "@/lib/managed-apps/types";
import { type McpTool, str, S } from "./tool-kit";

// Powering long-lived host state on and off: managed daemons and the Camoufox
// session. Split from tools.ts, which is the fs write tier plus the catalog
// assembly — both files stay readable and under the 200-line ceiling.
export const POWER_TOOLS: McpTool[] = [
  {
    name: "apps_power",
    limit: { key: "managed-app", max: 12, windowMs: 60_000, keyArg: "id" },
    audit: { action: "managed-app.action" as const, targetArg: "id" },
    description:
      "Start, stop, restart or back up a managed application on the VPS. Bounded to the known apps and " +
      "those four verbs — restarting a daemon should not require handing over a shell, so this sits at " +
      "write scope rather than exec. Check apps_list or apps_logs first.",
    scope: "write",
    annotations: { destructiveHint: true },
    // The verb list is READ from MANAGED_APP_ACTIONS, never retyped. It was retyped,
    // and `backup` — a real action with a real route, taken automatically before
    // every update — was missing from the enum AND from the guard below, so an MCP
    // client could not take one and was told the tool only did three things.
    inputSchema: S({
      id: { type: "string", description: "Managed app id from apps_list." },
      action: { type: "string", enum: [...MANAGED_APP_ACTIONS], description: MANAGED_APP_ACTIONS.join(" | ") },
    }, ["id", "action"]),
    run: (a) => {
      const id = str(a, "id");
      const action = str(a, "action");
      if (!isManagedAppId(id)) throw new Error(`unknown managed application "${id}" — call apps_list for valid ids`);
      if (!(MANAGED_APP_ACTIONS as readonly string[]).includes(action))
        throw new Error(`action must be one of ${MANAGED_APP_ACTIONS.join(", ")}`);
      // `{ app }`, matching POST /api/v1/managed-apps/[id]. Same capability, same
      // envelope — a client that learned the shape from the CLI or the route must
      // not have to learn a second one here.
      return performManagedAppAction(id, action as ManagedAppAction).then((app) => ({ app }));
    },
  },
  {
    name: "browser_power",
    limit: { key: "camoufox", max: 12, windowMs: 60_000 },
    audit: { action: "camoufox.power" as const, targetArg: "on" },
    description:
      "Start or stop the persistent Camoufox/noVNC session used by the human-facing MSO Browser app. Starting boots the saved-profile Firefox on a headless " +
      "X display; the session self-terminates after 2h. Do not start it merely for automated public-site inspection: use the verified camoufox-browse skill with a disposable profile instead. " +
      "If an agent explicitly starts this persistent session for a task and it was previously off, stop it when done — it holds a live logged-in profile.",
    scope: "exec",
    annotations: { destructiveHint: true },
    inputSchema: S({ on: { type: "boolean", description: "true = start, false = stop." } }, ["on"]),
    run: async (a) => {
      const s = await setCamoufoxEnabled(a.on === true);
      return { installed: s.installed, running: s.running, autostart: s.enabled };
    },
  },
];
