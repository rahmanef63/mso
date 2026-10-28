import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const fixture = `
set -euo pipefail
die(){ echo "$*" >&2; exit 1; }
enc(){ printf '%s' "$1"; }
U_run="run <prompt>"
U_session="session"
U_stats="stats"
source scripts/cli/agent-run.sh
`;

describe("scripts/cli/agent-run.sh", () => {
  it("run_agent_run forwards prompt + --json + --approve-scope to run_agent in the right argv order", () => {
    const script = `
${fixture}
run_agent(){
  jq -nc --args '$ARGS.positional' -- "$@"
}
run_agent_run "build feature" --json --approve-scope write
`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    expect(JSON.parse(out)).toEqual([
      "--oneshot",
      "build feature",
      "--json",
      "--approve-scope",
      "write",
    ]);
  });

  it("run_agent_run forwards prompt + --file to run_agent in argv order", () => {
    const script = `
${fixture}
run_agent(){
  jq -nc --args '$ARGS.positional' -- "$@"
}
run_agent_run "prompt" --file /tmp/x
`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    expect(JSON.parse(out)).toEqual([
      "--oneshot",
      "prompt",
      "--file",
      "/tmp/x",
    ]);
  });

  it("run_agent_run --file with no value exits nonzero with the usage message", () => {
    const script = `
${fixture}
run_agent(){ :; }
run_agent_run --file
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("usage: mso");
  });

  it("run_agent_run forwards --thinking to run_agent", () => {
    const script = `
${fixture}
run_agent(){
  jq -nc --args '$ARGS.positional' -- "$@"
}
run_agent_run "prompt" --thinking
`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    expect(JSON.parse(out)).toEqual([
      "--oneshot",
      "prompt",
      "--thinking",
    ]);
  });

  it("run_agent_run rejects --approve-scope bogus and exits nonzero", () => {
    const script = `
${fixture}
run_agent(){ :; }
run_agent_run --approve-scope bogus "hello"
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("--approve-scope must be read, write, or exec");
  });

  it("run_agent_run rejects a SECOND positional prompt and exits nonzero", () => {
    const script = `
${fixture}
run_agent(){ :; }
run_agent_run "a" "b"
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("mso run takes ONE prompt; quote it");
  });

  it("run_agent_run with no prompt exits nonzero", () => {
    const script = `
${fixture}
run_agent(){ :; }
run_agent_run
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("usage: mso");
  });

  // Regression: `--continue` takes no value. The first version shifted before
  // inspecting, so it swallowed the prompt as a resume reference and died.
  it("run_agent_run keeps the prompt when --continue is present", () => {
    const script = `
${fixture}
run_agent(){ jq -nc --args '$ARGS.positional' -- "$@"; }
run_agent_run --continue "carry on"
`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    expect(JSON.parse(out)).toEqual(["--oneshot", "carry on", "--continue"]);
  });

  it("run_agent_run requires a reference after --resume", () => {
    const res = spawnSync("bash", ["-c", `${fixture}\nrun_agent(){ :; }\nrun_agent_run "p" --resume`], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("--resume needs a session reference");
  });
});
