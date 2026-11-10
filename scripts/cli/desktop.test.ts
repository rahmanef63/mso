// `mso desktop` contract: each subcommand is one fixed call to /api/v1/desktop/*,
// an injection attempt dies in the shell before it becomes a request, and no verb
// exists that would relay a bot command. Sourced the way bin/mso sources it, with
// the HTTP helpers replaced by recorders.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

interface Run {
  calls: string[];
  out: string;
  /** Set when the shell refused; empty when it ran. */
  refused: string;
}

/** Run `mso_cmd_runtime desktop …` with the transport replaced. */
function run(args: string[]): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-desktop-cli-"));
  const calls = path.join(dir, "calls");
  // Tab-separated so a JSON body is never re-split; the label is a fixed token.
  const script = `
set -euo pipefail
ROOT=${JSON.stringify(root)}
CALLS=${JSON.stringify(calls)}
B="https://mso.example"
die(){ echo "$*" >&2; exit 2; }
enc(){ jq -rn --arg v "$1" '$v|@uri'; }
U_desktop="desktop status"
record(){ printf '%s\\t%s\\n' "$1" "$2" >> "$CALLS"; }
jget(){ record GET "$1"; printf '{"containers":[]}'; }
jpost(){ record POST "$1 $(printf '%s' "$2" | tr -d '\\n')"; printf '{"logs":["a","b"]}'; }
reqraw(){ record RAW "$1"; printf 'PNG'; }
ENVF=/dev/null
source "$ROOT/scripts/cli/commands-runtime.sh"
mso_cmd_runtime desktop ${args.map((a) => JSON.stringify(a)).join(" ")}
`;
  let out = "";
  let refused = "";
  try {
    // `exit 0` in the screenshot arm ends the script, so the status is read from
    // the output rather than the exit code alone.
    out = execFileSync("bash", ["-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    refused = String((error as { stderr?: Buffer }).stderr ?? "");
  }
  const recorded = fs.existsSync(calls)
    ? fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((line) => line.replace("\t", " "))
    : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { calls: recorded, out, refused };
}

describe("mso desktop", () => {
  it("maps containers and status to the read endpoint", () => {
    expect(run(["containers"]).calls).toEqual(["GET /api/v1/desktop/containers"]);
    // status renders a table from the same call, so an empty inventory says so.
    expect(run(["status"]).out.trim()).toBe("no bot desktop containers (label grokbot.desktop=1)");
  });

  it("streams the screenshot to stdout as binary", () => {
    const { calls, out } = run(["screenshot", "a1b2c3d4e5f6", "99"]);
    expect(calls).toEqual(["RAW https://mso.example/api/v1/desktop/screenshot?container=a1b2c3d4e5f6&screen=99"]);
    expect(out).toBe("PNG");
  });

  it("defaults the screen to the primary display", () => {
    expect(run(["screenshot", "a1b2c3d4e5f6"]).calls[0]).toContain("screen=99");
  });

  it("sends exactly one allowlisted verb per lifecycle subcommand", () => {
    for (const action of ["start", "stop", "restart"]) {
      const { calls } = run([action, "a1b2c3d4e5f6"]);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("/api/v1/desktop/lifecycle");
      expect(calls[0]).toContain(`"action":"${action}"`);
      expect(calls[0]).toContain('"container":"a1b2c3d4e5f6"');
    }
  });

  it("prints log lines and passes the requested tail", () => {
    const { calls, out } = run(["logs", "a1b2c3d4e5f6", "20"]);
    expect(calls[0]).toContain('"action":"logs"');
    expect(calls[0]).toContain('"lines":20');
    expect(out.trim().split("\n")).toEqual(["a", "b"]);
  });

  it("refuses an injection attempt in the container argument locally", () => {
    for (const hostile of ["abc; rm -rf /", "$(id)", "-v /:/host", "../../etc/passwd"]) {
      expect(run(["stop", hostile]).refused, hostile).toContain("invalid container id");
    }
  });

  it("has no exec or run subcommand at all", () => {
    for (const verb of ["exec", "run", "shell", "sh"]) {
      expect(run([verb, "a1b2c3d4e5f6"]).refused).toContain("usage: mso desktop");
    }
  });

  it("is documented in the generated CLI docs and the entrypoint header", () => {
    const docs = fs.readFileSync(path.join(root, "docs/CLI.md"), "utf8");
    const entry = fs.readFileSync(path.join(root, "bin/mso"), "utf8");
    expect(docs).toMatch(/^\s+desktop \*\s+status/m);
    expect(entry).toMatch(/^#\s+desktop \*\s+status/m);
  });
});
