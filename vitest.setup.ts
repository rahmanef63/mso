import { mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// A shared host may point TMPDIR at a protected control-plane directory (Hermes
// uses ~/.hermes/cache/scratch), so fixture temp dirs inherit it and every
// write-scope test fails on the delegated-write guard instead of its own
// assertion. Move this worker's temp root somewhere harmless before any test
// module calls os.tmpdir().
const real = (candidate: string): string => {
  try {
    return realpathSync(/* turbopackIgnore: true */ candidate);
  } catch {
    return path.resolve(/* turbopackIgnore: true */ candidate);
  }
};
const under = (target: string, root: string): boolean =>
  target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const protectedRoots = [
  ...["/.hermes", "/.config/systemd/user", "/.local/bin", "/.bun/bin", "/.openclaw"].map((dir) =>
    real(os.homedir() + dir),
  ),
  real(process.cwd()),
];

if (protectedRoots.some((root) => under(real(os.tmpdir()), root))) {
  const usable = [path.join(process.cwd(), "node_modules", ".mso-test-tmp"), "/tmp"]
    .map((candidate) => {
      try {
        mkdirSync(/* turbopackIgnore: true */ candidate, { recursive: true });
        return real(candidate);
      } catch {
        return "";
      }
    })
    .find((candidate) => candidate && !protectedRoots.some((root) => under(candidate, root)));
  if (usable) {
    process.env.TMPDIR = usable;
    process.env.TMP = usable;
    process.env.TEMP = usable;
  }
}
