// SERVER-ONLY. Builds a zip of selected entries via the host `zip` binary
// (Info-ZIP 3.0, already on the box) — no archive dependency. zip writes to a
// SEEKABLE temp file, then we stream that file to the HTTP response and delete it.
// We can't pipe zip's stdout straight to the response: Info-ZIP aborts when a
// stored/symlink entry has to go to a NON-seekable pipe ("zip -0 not supported for
// I/O on pipes"), which with `-y` (below) breaks any tree containing a symlink
// (e.g. pnpm node_modules) → a truncated, unextractable archive. A temp file is
// seekable, so the central directory is written correctly. Each name is a plain
// basename inside `base`; `base` and every child are realpath'd + bounds-checked
// inside the READ roots (and credential-blocked) before zip runs. Names are
// `./`-prefixed so a file literally named "-x" can't be read as a flag — we can't
// use `--` because it also disables the TRAILING `-x` exclude options (host-verified).
// `exclude` (heavy dirs like node_modules/.git) → `-x name/* */name/*`; Info-ZIP `*`
// spans `/`, so the second drops that dir at any depth below the root and the first
// covers the root itself, where there is nothing before the slash to match. Excludes
// only NARROW the archive (never widen access), so they're low-risk, but each is
// still a safe basename.
import { spawn } from "child_process";
import { createReadStream, promises as fsp } from "fs";
import os from "os";
import path from "path";
import type { Readable } from "stream";
import { HostError } from "./host-error";
import { appDir, looseCredentialExcludes, resolveReadable, sensitiveExcludes } from "./paths";

// A selectable item is a single basename in the listed dir — never a path. Reject
// separators/traversal/NUL so a name can't escape `base` (defense-in-depth; the
// per-child resolveReadable below also realpaths + bounds-checks each one).
export function assertSafeName(name: string): void {
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name))
    throw new HostError("Invalid item name");
}

// Forced excludes that guard the app's OWN secrets no matter what the user picks:
// when APP_DIR is nested inside the archived base, `zip -r` would recurse into it
// past the per-name credential gate, so strip its `.env*` (OS_SESSION_SECRET).
// Returns [] when base is APP_DIR itself or unrelated to it.
export function appSecretExcludes(realBase: string): string[] {
  const rel = path.relative(realBase, appDir());
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return [];
  return [`${rel}/.env`, `${rel}/.env.*`];
}

export async function zipStream(
  base: string,
  names: string[],
  exclude: string[] = [],
): Promise<Readable> {
  if (!names.length) throw new HostError("No items to archive");
  const real = await resolveReadable(base);
  for (const n of names) {
    assertSafeName(n);
    await resolveReadable(path.join(real, n)); // realpath + read-root + credential gate
  }
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "os-zip-"));
  const out = path.join(tmpDir, "archive.zip");
  // `-y` = store symlinks AS links, never follow. Without it `zip -r` archives a
  // link's TARGET content, escaping the realpath/credential bounds checked above
  // (a link to ~/.ssh/id_rsa inside a zipped dir would otherwise leak).
  const args = ["-r", "-y", "-q", out, ...names.map((n) => `./${n}`)];
  const patterns: string[] = [];
  for (const name of exclude) {
    assertSafeName(name); // a dir basename, never a raw pattern from the client
    // BOTH forms are needed. Info-ZIP `*` spans `/`, so `*/name/*` drops the dir at
    // any depth BELOW the archive root — but it cannot match at the root itself,
    // where the entry is `name/…` with nothing before the slash. Selecting
    // node_modules directly (or any sibling set containing it) with "skip
    // node_modules" ticked therefore archived it in full. Host-verified both ways.
    patterns.push(`${name}/*`, `*/${name}/*`);
  }
  patterns.push(...appSecretExcludes(real)); // forced credential guard, see above
  patterns.push(...sensitiveExcludes(real)); // same, for ~/ credential dirs nested under `base`
  patterns.push(...looseCredentialExcludes()); // basename-anywhere private keys / *.pem
  if (patterns.length) args.push("-x", ...patterns);

  // All stdio ignored — zip writes to the temp FILE, not a pipe, so there's no
  // stream to drain (and nothing can deadlock on an unread stderr). Wait for it to
  // finish before streaming, so the archive is complete + the central dir is sound.
  //
  // 18 = "could not open a specified file to read". Info-ZIP still writes a COMPLETE,
  // valid archive of everything else and only skips what it could not read, so this is
  // a partial success, not a failure — and on a real VPS home dir (root-owned files,
  // sockets, other users' dirs) it fires constantly. Rejecting it deletes the tmpdir and
  // hands the user nothing over one unreadable file. Verified on this host:
  // `zip -r -y -q out.zip ./good.txt ./nope.txt` with nope.txt chmod 000 → exit 18,
  // archive contains good.txt.
  const PARTIAL_OK = 18;
  // 12 = "Nothing to do" — every selected entry was excluded, and NO file is written
  // (verified), so streaming would ENOENT. It is the one code that needs its own words.
  const NOTHING_TO_DO = 12;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("zip", args, { cwd: real, stdio: "ignore" });
      child.on("error", reject); // missing binary / spawn fail
      child.on("close", (code) => {
        if (code === 0 || code === PARTIAL_OK) return resolve();
        if (code === NOTHING_TO_DO)
          return reject(new HostError("Nothing to archive: everything selected was excluded"));
        reject(new HostError(`zip exited ${code}`));
      });
    });
  } catch (e) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    throw e;
  }
  // ponytail: staged on disk, not streamed as zip runs — correctness over the
  // buffer-free ideal, since a piped zip won't extract. The ceiling is DISK, not
  // latency: the excludes bound what goes IN, they do not bound the total, so N
  // concurrent archives of a big tree cost N copies of it in /tmp (the /fs/zip rate
  // limit is the only thing holding that down). Switch to a streaming-zip lib if
  // that bites.
  // Opened, then unlinked BEFORE the stream is handed back: the open fd keeps the
  // bytes readable while the directory entry is already gone, so the tmpdir cannot
  // outlive this call under any exit path — including a request abandoned before
  // the body is consumed, which fires neither `close` nor `error` and used to
  // strand the directory. The handle closes itself when the stream ends.
  const handle = await fsp.open(out, "r");
  await fsp.rm(tmpDir, { recursive: true, force: true });
  return handle.createReadStream({ autoClose: true });
}
