import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HostError } from "./host-error";
import { appDir } from "./path-credentials";
import { isUnderRoot } from "./path-roots";

function absolute(raw: string): string {
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(/* turbopackIgnore: true */ raw);
}

async function canonicalProspective(raw: string): Promise<string> {
  const target = absolute(raw);
  let probe = target;
  for (;;) {
    try {
      const real = await fs.realpath(/* turbopackIgnore: true */ probe);
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
  const requested = absolute(raw);
  const target = await canonicalProspective(raw);
  const controls = [appDir(), ...[".config/systemd/user", ".local/bin", ".bun/bin", ".hermes", ".openclaw"].map(dir => path.join(/* turbopackIgnore: true */ os.homedir(), dir))];
  const canonical = await Promise.all(controls.map(canonicalProspective));
  if (
    containsGitControl(target) ||
    containsGitControl(requested) ||
    [...controls, ...canonical].some(control =>
      [requested, target].some(candidate => isUnderRoot(candidate, control) || isUnderRoot(control, candidate)))
  ) {
    throw new HostError("write scope cannot modify executable control-plane inputs; exec authority required");
  }
}
