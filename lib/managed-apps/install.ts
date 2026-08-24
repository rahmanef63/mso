import "server-only";
import path from "node:path";
import { getManagedAppDefinition } from "./catalog";
import { startManagedAppJob } from "./jobs";
import { getManagedApp } from "./manager";
import { managedAppOrigin } from "./origin";
import { findProvider } from "./providers";
import type { ManagedAppId, ManagedAppJob } from "./types";

// Installing a managed app used to be something MSO showed you rather than did,
// on the grounds that both upstream installers were interactive. That stopped
// being true: `hermes setup --non-interactive` is documented as "use
// defaults/env vars", and `openclaw onboard --non-interactive` exists behind an
// `--accept-risk` acknowledgement. So this file is the missing verb — the same
// job machinery update/uninstall/restore already use, pointed at scripts/managed-app-install.
//
// The one rule that shapes everything here: THE KEY NEVER TOUCHES argv. A job's
// argv is persisted in its record, returned by the jobs API and written to the
// audit log; `options.env` is none of those things (it is merged over childEnv()
// inside job-child.ts and dropped). So the argv stays two elements long and the
// secret travels in the environment.

/** Where the sequence lives. Resolved against the server's cwd — mso runs
 *  with `WorkingDirectory` at the repo root, and the script ships with the repo,
 *  so a fresh clone on another machine needs no path configuration. */
const INSTALL_SCRIPT = path.join(process.cwd(), "scripts", "managed-app-install");

/** Hermes fetches uv, a Python, Node and ffmpeg before it does anything of its
 *  own, so it needs a budget several times OpenClaw's `npm i -g`. Both stay
 *  under the job layer's 1 h ceiling. */
const INSTALL_TIMEOUT_MS: Record<ManagedAppId, number> = { hermes: 2_700_000, openclaw: 900_000, "9router": 900_000 };

/** A key is never inspected beyond this: it is opaque upstream credential
 *  material, so the only questions worth asking are "could it break the
 *  environment block" and "is it plausibly a key at all". A control character
 *  cannot appear in a real one and is the only shape that could do damage. */
function assertKeyShape(key: string): void {
  if (key.length > 512 || /\p{Cc}/u.test(key)) throw new Error("that does not look like an API key");
}

export interface InstallOptions {
  /** Omitted = install with no provider configured. The app comes up and says so;
   *  the same panel can supply one afterwards. */
  provider?: string | null;
  apiKey?: string | null;
  /** `loopback` unless the operator asks otherwise. Only this host wants `lan`,
   *  and only because Traefik has to reach the gateway from a container. */
  bind?: string | null;
}

const BINDS = new Set(["loopback", "lan", "tailnet", "auto"]);

/** Start an install job. Refuses when the app is already installed: the upstream
 *  installers are re-runnable, but "install" arriving at a live app is a UI bug
 *  or a stale page, and re-running one restarts services under whoever is using
 *  them. Update is the verb for an app that is already there. */
export async function startInstall(id: ManagedAppId, options: InstallOptions = {}): Promise<ManagedAppJob> {
  const view = await getManagedApp(id);
  if (view.installed) throw new Error(`${getManagedAppDefinition(id).name} is already installed — use Update instead`);
  // Fail CLOSED on an unreadable reading. This guard's own reason for existing
  // (above) is that re-running an installer "restarts services under whoever is
  // using them" — and Hermes' upstream installer recreates the venv that the
  // RUNNING gateway is executing from. `installed: false` arriving because MSO
  // cannot see user services is exactly when that is most destructive, so
  // "I could not check" must not be treated as "it is not there".
  if (view.diagnostic) {
    throw new Error(`cannot determine whether ${getManagedAppDefinition(id).name} is installed — refusing to run the installer. ${view.diagnostic}`);
  }

  const env: Record<string, string> = {};
  const bind = options.bind ?? "loopback";
  if (!BINDS.has(bind)) throw new Error("unsupported gateway bind mode");
  env.MSO_INSTALL_GATEWAY_BIND = bind;

  // Where MSO will frame this app. OpenClaw's Control UI keeps its own origin
  // allowlist and rejects the socket before it opens otherwise — a healthy gateway
  // that the dashboard cannot talk to. Absent in single-origin deployments, where
  // the frame is same-origin with the cockpit and there is nothing to allow.
  const appOrigin = managedAppOrigin(id);
  if (appOrigin) env.MSO_INSTALL_APP_ORIGIN = appOrigin;

  const key = options.apiKey?.trim();
  if (key) {
    const provider = findProvider(options.provider);
    if (!provider) throw new Error("unsupported provider");
    if (!provider.apps.includes(id)) throw new Error(`${provider.label} is not supported by this application`);
    assertKeyShape(key);
    env.MSO_INSTALL_PROVIDER = provider.id;
    // Both hand-offs at once: the name the CLI reads on its own (Hermes takes it
    // straight from here and never sees a flag), and the generic pair the install
    // script uses to build OpenClaw's flag.
    env.MSO_INSTALL_API_KEY = key;
    env[provider.envVar] = key;
  }

  return startManagedAppJob({
    applicationId: id,
    kind: "install",
    argv: [INSTALL_SCRIPT, id],
    env,
    timeoutMs: INSTALL_TIMEOUT_MS[id],
  });
}
