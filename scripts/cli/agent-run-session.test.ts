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
  it("run_agent_session list renders one TAB-separated row per session from a stubbed jget payload", () => {
    const script = `
${fixture}
jget(){
  printf '%s' '{"sessions":[{"id":"ses-1","source":"cli","updatedAt":"2026-10-28T12:00:00Z","historyTurns":3,"estimatedTokens":450,"title":"Test Session"}]}'
}
run_agent_session list
`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    expect(out.trim()).toBe(
      "ses-1\tcli\t2026-10-28T12:00:00Z\t3t\t450tk\tTest Session",
    );
  });

  it("run_agent_session show latest resolves the newest session id first and returns the record", () => {
    const script = `
${fixture}
jget(){
  echo "call:$1" >&2
  if [ "$1" = "/api/v1/agent-sessions?limit=1" ]; then
    printf '%s' '{"sessions":[{"id":"ses-newest-99"}]}'
  elif [ "$1" = "/api/v1/agent-sessions?ref=ses-newest-99" ]; then
    printf '%s' '{"session":{"id":"ses-newest-99","title":"Latest Work"}}'
  else
    die "unexpected endpoint: $1"
  fi
}
run_agent_session show latest
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("call:/api/v1/agent-sessions?limit=1");
    expect(res.stderr).toContain("call:/api/v1/agent-sessions?ref=ses-newest-99");
    expect(JSON.parse(res.stdout)).toEqual({
      session: { id: "ses-newest-99", title: "Latest Work" },
    });
  });

  it("run_agent_session import creates a NEW session then POSTs history to that new id", () => {
    const script = `
${fixture}
jpost(){
  action=$(jq -r .action <<<"$2")
  echo "jpost action=$action body=$2" >&2
  if [ "$action" = "create" ]; then
    printf '%s' '{"session":{"id":"new-id-999"}}'
  elif [ "$action" = "update" ]; then
    printf '%s' '{"ok":true}'
  else
    die "unexpected action: $action"
  fi
}
printf '%s' '{"session":{"id":"foreign-id-111","title":"Imported","history":[{"role":"user","content":"hello"}]}}' | run_agent_session import -
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    expect(res.status).toBe(0);
    const calls = res.stderr
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("jpost action="));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("action=create");
    expect(calls[1]).toContain("action=update");
    expect(calls[1]).toContain('"id":"new-id-999"');
    expect(calls[1]).not.toContain("foreign-id-111");
  });

  it("run_agent_session import rejects a file whose JSON has no history array", () => {
    const script = `
${fixture}
f=$(mktemp)
trap 'rm -f "$f"' EXIT
printf '%s' '{"session":{"id":"s1","title":"No history"}}' > "$f"
run_agent_session import "$f"
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("is not a session export (no history array)");
  });

  it("run_agent_session rm exits nonzero with a message that says the store is append-only", () => {
    const script = `
${fixture}
jget(){
  printf '%s' '{"sessions":[{"id":"ses-1"}]}'
}
run_agent_session rm
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("the agent-session store is append-only");
  });

  it("run_agent_stats --json sums estimatedTokens/historyTurns from a stubbed 2-session payload", () => {
    const script = `
${fixture}
jget(){
  printf '%s' '{"sessions":[{"id":"s1","estimatedTokens":150,"historyTurns":3,"lifetimeEstimatedTokens":200,"compactionCount":1,"archiveCount":0,"source":"cli"},{"id":"s2","estimatedTokens":250,"historyTurns":7,"lifetimeEstimatedTokens":300,"compactionCount":0,"archiveCount":0,"source":"web"}]}'
}
run_agent_stats --json
`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    const data = JSON.parse(out);
    expect(data.sessions).toBe(2);
    expect(data.tokens).toBe(400);
    expect(data.turns).toBe(10);
  });

  it("run_agent_stats --days abc exits nonzero", () => {
    const script = `
${fixture}
jget(){ printf '%s' '{"sessions":[]}'; }
run_agent_stats --days abc
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("--days needs a whole number");
  });

  it("run_agent_stats --usage prints the human ledger with summed tokens", () => {
    const script = `
${fixture}
jget(){
  printf '%s' '{"sessions":[{"id":"s1","estimatedTokens":150,"historyTurns":3,"lifetimeEstimatedTokens":200,"compactionCount":1,"archiveCount":0,"source":"cli"},{"id":"s2","estimatedTokens":250,"historyTurns":7,"lifetimeEstimatedTokens":300,"compactionCount":0,"archiveCount":0,"source":"web"}]}'
}
run_agent_stats --usage
`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    expect(out).toContain("tokens now    400");
    expect(out).toContain("tokens total  500");
  });

  // Regression: `--out` must not be parsed as the session reference.
  it("run_agent_session export --out with no ref exports the newest session to that file", () => {
    const script = `
${fixture}
jget(){
  case "$1" in
    *"limit=1"*) printf '{"sessions":[{"id":"newest-id"}]}' ;;
    *"ref=newest-id"*) printf '{"session":{"id":"newest-id"}}' ;;
    *) printf '{"error":"unexpected %s"}' "$1" >&2; exit 9 ;;
  esac
}
run_agent_session export --out "$OUT"
`;
    const res = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, OUT: "/tmp/mso-export-test.json" } });
    expect(res.status).toBe(0);
    // The confirmation goes to stderr so `mso session export` stays pipeable.
    expect(res.stderr).toContain("wrote /tmp/mso-export-test.json");
    expect(JSON.parse(require("node:fs").readFileSync("/tmp/mso-export-test.json", "utf8")).session.id).toBe("newest-id");
  });
});
