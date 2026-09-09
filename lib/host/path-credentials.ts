import { realpathSync } from "fs";
import path from "path";
import { homeDir, isUnderRoot } from "./path-roots";

// Credential denylist: even inside a legal root, the app's OWN secret files are
// off-limits to the FS API. Reading .env.local would leak OS_SESSION_SECRET —
// turning one stolen session into the ability to mint cookies forever — and
// ~/.mso holds the device allowlist, BYOK key and browser profile (cookies).
// Other projects' .env files stay readable (session = owner, their call).
const APP_DIR = (() => {
  try {
    return realpathSync(process.cwd());
  } catch {
    return process.cwd();
  }
})();

// The app's own dir (realpath'd). Exposed so the zip stream can force-strip its
// `.env*` secrets when a PARENT of it is archived — `zip -r` recurses past the
// per-name credential gate, so that one blind spot needs an explicit exclude.
export function appDir(): string {
  return APP_DIR;
}

// Defense-in-depth: high-value credential material in $HOME is blocked even
// though the session belongs to the owner — a hijacked session shouldn't walk
// away with SSH keys or shell history. Override with OS_FS_ALLOW_SENSITIVE=1
// (or narrow the roots entirely via OS_FS_READ_ROOTS).
export const SENSITIVE_HOME = [
  ".ssh", ".gnupg", ".secrets", ".npmrc", "vault",
  // shell + REPL history (the host shell may be zsh/fish, not just bash)
  ".bash_history", ".zsh_history", ".python_history", ".mysql_history",
  // cloud / infra credentials
  ".aws", ".config/gcloud", ".kube", ".docker", ".config/rclone",
  ".git-credentials", ".netrc", ".config/git/credentials",
  // AI/dev-tool + OS keyring credentials (account tokens = full account access)
  ".claude", ".claude.json", ".config/gh", ".config/anthropic", ".local/share/keyrings",
  ".config/claude", ".config/GitHub", ".codex", ".gemini", ".copilot", ".mcp-auth",
  ".convex", ".openclaw/credentials", ".openclaw/identity",
  // Camoufox browser profile + its session snapshots. cookies.sqlite there holds a
  // LIVE Google session (SID/__Secure-1PSID/SAPISID) and LinkedIn's li_at — replaying
  // those is account takeover with no password and no 2FA prompt. OS_FS_READ_ROOTS is
  // ~, so without this an fs/read or an fs/zip of $HOME walks off with all of it, and
  // assistant read-tools run with no approval gate. .vnc holds the VNC password file.
  ".local/share/camoufox", ".local/state/camoufox", ".vnc",
  // database creds + password-manager CLIs
  ".pgpass", ".config/op", ".config/lpass",
  // SHELL RC + PROFILE FILES. Not config-shaped paranoia: `export FOO_TOKEN=…` in
  // ~/.bashrc is how most people (and this box — 8 of them the day this was added)
  // keep API keys for CLIs, and every installer that says "add this to your shell
  // profile" puts one there. The list already blocks shell HISTORY for the same
  // reason; the file that DEFINES the environment is the richer target of the two.
  // Editing them from the cockpit is a real loss — that is what OS_FS_ALLOW_SENSITIVE
  // is for, and a terminal window is right there.
  ".bashrc", ".bash_profile", ".bash_login", ".bash_aliases", ".profile",
  ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".kshrc",
  ".config/fish/config.fish", ".config/fish/conf.d",
  // root-level loose private keys; nested copies are caught by basename below too.
  "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
];

// Loose private keys are identified by BASENAME anywhere inside a legal read root.
// Keeping these in SENSITIVE_HOME only protected ~/id_rsa, while the common deploy-key
// shape ~/projects/app/id_rsa stayed readable to a session/read-scope MCP bearer.
const PRIVATE_KEY_BASENAMES = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"] as const;
const PRIVATE_KEY_NAMES = new Set<string>(PRIVATE_KEY_BASENAMES);

export function isSensitivePath(real: string): boolean {
  if (process.env.OS_FS_ALLOW_SENSITIVE === "1") return false;
  const h = homeDir();
  return SENSITIVE_HOME.some((n) => {
    const p = path.join(h, n);
    return real === p || isUnderRoot(real, p);
  });
}

/** The app's OWN `.env*` — `.env.local` holds OS_SESSION_SECRET, so a copy of one
 *  into a readable spot turns one stolen session into forever-mintable cookies. */
export function isAppSecret(real: string): boolean {
  const base = path.basename(real);
  return path.dirname(real) === APP_DIR && base.startsWith(".env") && base !== ".env.example";
}

/** Exported for the project/skill enumerators: they walk directory TREES the
 *  per-path resolvers never see, and must drop a credential directory themselves
 *  rather than discover it one `resolveReadable` too late. */
export function isCredentialPath(real: string): boolean {
  const store = path.join(homeDir(), ".mso");
  if (real === store || isUnderRoot(real, store)) return true;
  if (isSensitivePath(real)) return true;
  const base = path.basename(real);
  // Private keys land anywhere (heredoc dumps, deploy keys, downloaded service
  // accounts). Their basename/extension is the reliable marker outside fixed ~/ paths.
  if (PRIVATE_KEY_NAMES.has(base) && process.env.OS_FS_ALLOW_SENSITIVE !== "1") return true;
  if (base.toLowerCase().endsWith(".pem")) return true;
  return isAppSecret(real);
}

// `zip -r` validates the selected top-level names, then walks descendants itself.
// These patterns enforce the same basename-anywhere private-key rule inside that
// recursive walk. Info-ZIP `*` spans `/`; explicit root forms cover the no-slash case.
export function looseCredentialExcludes(): string[] {
  const privateNames = process.env.OS_FS_ALLOW_SENSITIVE === "1"
    ? []
    : PRIVATE_KEY_BASENAMES.flatMap((name) => [name, `*/${name}`]);
  // *.pem has historically been a hard credential boundary, independent of the
  // SENSITIVE_HOME escape hatch; keep that contract while extending id_* safely.
  return ["*.pem", ...privateNames];
}

