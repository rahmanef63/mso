import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HostError } from "./host-error";
import { appDir } from "./path-credentials";
import { isUnderRoot } from "./path-roots";

function absolute(raw: string): string {
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

async function canonicalProspective(raw: string): Promise<string> {
  const target = absolute(raw);
  let probe = target;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const remainder = path.relative(probe, target);
      return remainder ? path.join(real, remainder) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(probe);
      if (parent === probe) return target;
      probe = parent;
    }
  }
}

function containsGitControl(target: string): boolean {
  return target.split(path.sep).filter(Boolean).includes(".git");
}

export async function assertDelegatedWritePath(raw: string): Promise<void> {
  const target = await canonicalProspective(raw);
  const app = appDir();
  const systemdUser = path.join(os.homedir(), ".config", "systemd", "user");
  if (
    target === app ||
    isUnderRoot(target, app) ||
    containsGitControl(target) ||
    target === systemdUser ||
    isUnderRoot(target, systemdUser)
  ) {
    throw new HostError("write scope cannot modify executable control-plane inputs; exec authority required");
  }
}
