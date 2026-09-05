// Local-owner maintenance only. Never follow an external target while removing MSO state.
import fs from "node:fs";
import path from "node:path";

export function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function statOrNull(target) {
  try { return fs.lstatSync(target); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export function safeParents(root, target) {
  if (!inside(root, target)) throw new Error("Maintenance target is outside its ownership root");
  const rootStat = statOrNull(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink() || fs.realpathSync(root) !== root || (rootStat.mode & 0o022)) throw new Error(`Unsafe ownership root: ${root}`);
  let current = root;
  for (const part of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = statOrNull(current);
    if (!stat) break;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe parent: ${current}`);
    if (stat.mode & 0o022) throw new Error(`Writable-by-others parent: ${current}`);
  }
}
export function snapshot(root, target, { symlink = false, privileged = false } = {}) {
  safeParents(root, target);
  const stat = statOrNull(target);
  if (!stat) return null;
  if (stat.isSymbolicLink() && !symlink) throw new Error(`Refusing symlink state: ${target}`);
  if (!stat.isFile() && !stat.isDirectory() && !stat.isSymbolicLink()) throw new Error(`Unsupported entry: ${target}`);
  if (!privileged && stat.uid !== process.getuid()) throw new Error(`Not owned by the current user: ${target}`);
  if (!stat.isSymbolicLink() && (stat.mode & 0o022)) throw new Error(`Writable-by-others target: ${target}`);
  return { path: target, root, dev: stat.dev, ino: stat.ino, mode: stat.mode, size: stat.size, mtimeMs: stat.mtimeMs,
    kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", privileged };
}
export function revalidate(entry) {
  const now = snapshot(entry.root, entry.path, { symlink: entry.kind === "symlink", privileged: entry.privileged });
  if (!now || ["dev", "ino", "mode", "size", "mtimeMs"].some((key) => now[key] !== entry[key])) throw new Error(`Target changed since preview: ${entry.path}`);
}
export function ensurePrivateDirectory(root, target) {
  safeParents(root, path.join(target, ".check"));
  const stat = statOrNull(target);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077))) throw new Error(`Expected owner-only directory: ${target}`);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
}
export function ownedLink(root, target, repo) {
  const stat = statOrNull(target);
  if (!stat?.isSymbolicLink()) return null;
  safeParents(root, target);
  const linkTarget = path.resolve(path.dirname(target), fs.readlinkSync(target));
  if (!inside(repo, linkTarget)) return null;
  return snapshot(root, target, { symlink: true, privileged: stat.uid !== process.getuid() });
}
