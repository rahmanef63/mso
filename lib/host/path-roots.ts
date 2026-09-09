import os from "os";
import path from "path";

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

