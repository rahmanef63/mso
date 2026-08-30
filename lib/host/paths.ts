// SERVER-ONLY. Path resolution + bounds for host filesystem access. mso runs
// as a host process, so /api/v1 talks to the FS directly (no agent). READ and
// WRITE roots are separate: reads can be wide (browse), writes are narrow so the
// browser shell can't clobber system files. Symlinks are realpath-resolved BEFORE the
// bounds check so a link can't escape a root. Configure with OS_FS_READ_ROOTS /
// OS_FS_WRITE_ROOTS (colon-separated; "~" = home, "/" = whole filesystem).
import { existsSync, promises as fs, readdirSync, realpathSync } from "fs";
import os from "os";
import path from "path";
import type { FsRoot } from "@/lib/os-api/types";
import { HostError } from "./host-error";

export function homeDir(): string {
  return os.homedir();
}

function expandHome(p: string): string {
  if (p === "~") return homeDir();
  if (p.startsWith("~/")) return path.join(homeDir(), p.slice(2));
  return p;
}

function rootsFromEnv(name: string, fallback: string[]): string[] {
  const env = process.env[name];
  if (env && env.trim())
    return env.split(":").map((s) => s.trim()).filter(Boolean).map(expandHome);
  return fallback;
}

export function readRootList(): string[] {
  const h = homeDir();
  return rootsFromEnv("OS_FS_READ_ROOTS", [h, path.join(h, "projects")]);
}

export function writeRootList(): string[] {
  const h = homeDir();
  return rootsFromEnv("OS_FS_WRITE_ROOTS", [h, path.join(h, "projects")]);
}

export function isUnderRoot(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

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
const SENSITIVE_HOME = [
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

/** The app's own secrets sitting UNDER `realBase` — empty when APP_DIR is not a
 *  descendant, or holds no secrets. The per-path gate is exact-or-under, so a
 *  recursive walk starting at a PARENT of APP_DIR never consults it for these. */
function appSecretsUnder(realBase: string): string[] {
  const dir = appDir();
  if (dir === realBase || !isUnderRoot(dir, realBase)) return [];
  try {
    return readdirSync(dir)
      .map((n) => path.join(dir, n))
      .filter((p) => isAppSecret(p));
  } catch {
    return [];
  }
}

// The per-path gate above is exact-or-under, so a PARENT of a denied entry never
// matches it — and the two recursive callers (`zip -r`, `fs.cp {recursive}`) walk
// straight past the gate into the children. Both need the nested locations named
// explicitly. Filtered by existence so the callers never refuse (or exclude) over
// a path that isn't on this box.
function sensitiveUnder(realBase: string): string[] {
  if (process.env.OS_FS_ALLOW_SENSITIVE === "1") return [];
  const h = homeDir();
  return [...SENSITIVE_HOME, ".mso"]
    .map((n) => path.join(h, n))
    .filter((p) => p !== realBase && isUnderRoot(p, realBase) && existsSync(p));
}

// Recursive READ (zip): NARROW the archive rather than refuse it — same shape as
// appSecretExcludes. Info-ZIP `*` spans `/` and entries are stored relative to the
// archive base, so `rel` drops a file and `rel/*` drops a whole dir.
export function sensitiveExcludes(realBase: string): string[] {
  return sensitiveUnder(realBase).flatMap((p) => {
    const rel = path.relative(realBase, p);
    return [rel, `${rel}/*`];
  });
}

// Recursive WRITE (copy/move): REFUSE. Filtering is wrong for move — its EXDEV
// branch is cp-then-rm, so a skipped file would be deleted instead of moved. And
// a completed move relocates credentials OUT of their denylisted path, which makes
// them plainly readable at the destination (relocate-then-read escalation).
export function assertNoSensitiveDescendants(real: string): void {
  const hit = sensitiveUnder(real)[0];
  if (hit)
    throw new HostError(
      `Refusing: this directory contains a credential path (${path.relative(real, hit)})`,
    );
}

/** Walk a recursive mutation source and apply the same credential predicate used
 * by per-path reads/writes to every descendant. Directory operations otherwise
 * let fs.cp/fs.rename/fs.rm walk past the top-level gate. Symlinks are inspected
 * by their own path/name but never followed, so this guard cannot escape the
 * already-resolved mutation root or traverse a cycle. */
export async function assertNoCredentialDescendants(
  realBase: string,
  options: { ignoreAppSecrets?: boolean } = {},
): Promise<void> {
  const rootStat = await fs.lstat(realBase).catch(() => null);
  if (!rootStat?.isDirectory()) return;

  const stack = [realBase];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      throw new HostError(`Refusing recursive mutation: cannot inspect ${path.relative(realBase, dir) || "."}`);
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      const credential = isCredentialPath(child);
      const ignoredAppSecret = options.ignoreAppSecrets === true && isAppSecret(child);
      if (credential && !ignoredAppSecret) {
        throw new HostError(
          `Refusing: this directory contains a credential path (${path.relative(realBase, child)})`,
        );
      }
      if (entry.isDirectory()) stack.push(child);
    }
  }
}

// The app's own `.env*` needed the narrower fix the ~/ list can't give: on the
// DEFAULT roots (~ and ~/projects) APP_DIR is a descendant of a copyable dir, so
// `copy(~/projects, ~/backup)` walked past the per-path gate and duplicated
// .env.local somewhere /api/v1/fs/read serves. Refusing outright would block
// copying ~/projects, which is an ordinary thing to do — so copy SKIPS them and
// only move refuses.
//
// Recursive COPY: a filter for `fs.cp`. Returns undefined when there is nothing
// to skip, so the ordinary copy path stays exactly as it was.
export function appSecretCopyFilter(realBase: string): ((src: string) => boolean) | undefined {
  const secrets = new Set(appSecretsUnder(realBase));
  return secrets.size ? (src: string) => !secrets.has(src) : undefined;
}

// Recursive MOVE: REFUSE, for the same reason the ~/ list does. A filter is wrong
// here — the EXDEV branch is cp-then-rm, so a skipped secret would be DELETED
// rather than moved, and a completed move relocates it out of its denylisted path
// and makes it plainly readable at the destination.
export function assertNoAppSecretDescendants(real: string): void {
  const hit = appSecretsUnder(real)[0];
  if (hit)
    throw new HostError(
      `Refusing: this directory contains the cockpit's own secrets (${path.relative(real, hit)})`,
    );
}

function assertNotCredential(real: string): void {
  if (isCredentialPath(real)) throw new HostError("Access to credential/sensitive files is blocked");
}

// Upload target guard — the write-side equivalent of safeWritePath for a file
// that will land at `full` inside the already-resolved `destReal`. Upload writers
// create intermediate dirs, so we can't realpath the (not-yet-existing) parent as
// safeWritePath does; instead: (1) `full` is lexically under destReal, (2) the
// DEEPEST EXISTING ancestor realpaths to still-under destReal (a symlinked
// intermediate dir can't redirect the write outside), and (3) `full` is not a
// credential/sensitive file — the same denylist writeFile/move/copy enforce but
// the upload path was skipping (a session could otherwise drop
// ~/.ssh/authorized_keys or ~/.mso/auth-devices.json via /api/v1/fs/upload).
export async function assertUploadTarget(full: string, destReal: string): Promise<void> {
  if (!isUnderRoot(full, destReal)) throw new HostError("Upload path escapes destination");
  for (let anc = path.dirname(full); ; ) {
    try {
      const real = await fs.realpath(anc);
      if (!isUnderRoot(real, destReal)) throw new HostError("Upload path escapes destination via symlink");
      break;
    } catch (e) {
      if (e instanceof HostError) throw e;
      const parent = path.dirname(anc);
      if (parent === anc) break; // walked to the fs root; nothing existed
      anc = parent;
    }
  }
  assertNotCredential(full);
}

async function realRoots(list: string[]): Promise<string[]> {
  return Promise.all(
    list.map(async (r) => {
      try {
        return await fs.realpath(r);
      } catch {
        return path.resolve(r);
      }
    }),
  );
}

function lexicalRoots(list: string[]): string[] {
  return list.map((root) => path.resolve(root));
}

// Realpath-resolved WRITE roots — shared by safeWritePath/assertNotRoot here and
// exec.ts's cwd bounds, so the realpath-fallback strategy lives in one place.
export async function resolveWriteRoots(): Promise<string[]> {
  return realRoots(writeRootList());
}

// READ: "/" is the filesystem root (browse-anywhere if a read root allows it);
// "~"/"" = home. Resolves symlinks, then asserts inside a read root.
export async function resolveReadable(requested: string): Promise<string> {
  const h = homeDir();
  let absolute: string;
  if (!requested || requested === "~") absolute = h;
  else if (requested.startsWith("~/")) absolute = path.join(h, requested.slice(2));
  else absolute = path.resolve(requested);
  const normalized = path.resolve(absolute);
  const configured = lexicalRoots(readRootList());

  // Keep each filesystem sink inside the SAFE branch of CodeQL's documented
  // path.relative sanitizer. Runtime-equivalent flags/helpers hide the proof from
  // the analyzer. The second check uses real paths, so symlinks cannot escape.
  for (const root of configured) {
    const relative = path.relative(root, normalized);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      continue;
    } else {
      const real = await fs.realpath(normalized);
      const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
      const realRelative = path.relative(realRoot, real);
      if (
        realRelative === ".." ||
        realRelative.startsWith(".." + path.sep) ||
        path.isAbsolute(realRelative)
      ) {
        throw new HostError("Path outside readable roots");
      }
      assertNotCredential(real);
      return real;
    }
  }
  throw new HostError("Path outside readable roots");
}

// WRITE: "/" collapses to home (never the FS root). When !mustExist the parent
// is checked (target doesn't exist yet). Asserts inside a write root.
export async function safeWritePath(requested: string, mustExist: boolean): Promise<string> {
  const h = homeDir();
  let absolute: string;
  if (!requested || requested === "~" || requested === "/") absolute = h;
  else if (requested.startsWith("~/")) absolute = path.join(h, requested.slice(2));
  else absolute = path.resolve(requested);
  const normalized = path.resolve(absolute);
  const configured = lexicalRoots(writeRootList());
  const lexicalTarget = mustExist ? normalized : path.dirname(normalized);

  for (const root of configured) {
    // Use the canonical absolute-prefix containment pattern CodeQL recognizes.
    // `root + path.sep` prevents sibling-prefix tricks such as /safe vs /safe-evil.
    const lexicalPrefix = root === path.parse(root).root ? root : root + path.sep;
    if (lexicalTarget !== root && !lexicalTarget.startsWith(lexicalPrefix)) continue;

    const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
    const realPrefix = realRoot === path.parse(realRoot).root ? realRoot : realRoot + path.sep;
    if (mustExist) {
      const real = await fs.realpath(normalized);
      if (real !== realRoot && !real.startsWith(realPrefix)) {
        throw new HostError("Path outside writable roots");
      }
      assertNotCredential(real);
      return real;
    }

    const parent = await fs.realpath(lexicalTarget);
    if (parent !== realRoot && !parent.startsWith(realPrefix)) {
      throw new HostError("Path outside writable roots");
    }
    const joined = path.join(parent, path.basename(normalized));
    assertNotCredential(joined);
    return joined;
  }
  throw new HostError("Path outside writable roots");
}

export async function assertNotRoot(p: string): Promise<void> {
  const rr = await realRoots(writeRootList());
  if (rr.some((r) => r === p)) throw new HostError("Refusing to modify a root directory");
}

function labelFor(p: string): string {
  const h = homeDir();
  if (p === "/") return "Filesystem";
  if (p === h) return "Home";
  if (p === path.join(h, "projects")) return "Projects";
  return path.basename(p) || p;
}

// Sidebar jump-points: Home + Projects, plus any extra read roots (e.g. "/").
export function resolveRoots(): FsRoot[] {
  const h = homeDir();
  const base: FsRoot[] = [
    { label: "Home", path: h },
    { label: "Projects", path: path.join(h, "projects") },
  ];
  const extra = readRootList()
    .filter((p) => p !== h && p !== path.join(h, "projects"))
    .map((p) => ({ label: labelFor(p), path: p }));
  return [...base, ...extra];
}
