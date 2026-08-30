import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const roots: string[] = [];

function copy(root: string, rel: string) {
  const dst = path.join(root, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dst);
  fs.chmodSync(dst, fs.statSync(path.join(ROOT, rel)).mode & 0o777);
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-cli-update-"));
  roots.push(dir);
  const repo = path.join(dir, "repo");
  const remote = path.join(dir, "remote.git");
  const fakebin = path.join(dir, "fakebin");
  const curlMarker = path.join(dir, "curl-called");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(fakebin, { mode: 0o700 });
  for (const rel of [
    "bin/mso",
    "scripts/mso-update",
    "scripts/lib/private-state.sh",
    "scripts/lib/update-state.sh",
    "scripts/lib/runtime-exclusion.sh",
    "scripts/lib/update-gateway-runtimes.sh",
  ]) copy(repo, rel);
  fs.writeFileSync(
    path.join(fakebin, "curl"),
    `#!/bin/sh\nprintf touched > ${JSON.stringify(curlMarker)}\nexit 91\n`,
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(fakebin, "systemctl"),
    `#!/bin/sh\nif [ "$1" = is-active ]; then exit 3; fi\nexit 1\n`,
    { mode: 0o700 },
  );
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "config", "user.name", "MSO Test");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "fixture");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main");
  return {
    repo,
    curlMarker,
    env: {
      ...process.env,
      HOME: dir,
      PATH: `${fakebin}:${process.env.PATH ?? ""}`,
      MSO_ENV: "/dev/null",
      MSO_UPDATE_NOTICE_DIR: path.join(dir, "notice"),
      MSO_UPDATE_STATE_DIR: path.join(dir, "update-state"),
      MSO_RUNTIME_EXCLUSION_DIR: path.join(dir, "runtime-exclusion"),
    },
  };
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("mso offline update dispatch", () => {
  it("runs update status without contacting the MSO HTTP API", () => {
    const f = fixture();
    const out = execFileSync(path.join(f.repo, "bin/mso"), ["update", "status"], {
      encoding: "utf8",
      env: f.env,
    });
    expect(out).toMatch(/up to date|offline deployment verification\/restart is pending/);
    expect(fs.existsSync(f.curlMarker)).toBe(false);
  });

  it("keeps `mso update run` as a local compatibility alias", () => {
    const cli = fs.readFileSync(path.join(ROOT, "bin/mso"), "utf8");
    const updater = fs.readFileSync(path.join(ROOT, "scripts/mso-update"), "utf8");
    expect(cli).toMatch(/update\).*scripts\/mso-update/);
    expect(updater).toMatch(/case "\$\{1:-run\}" in/);
    expect(updater).toMatch(/run\) case/);
  });
});
