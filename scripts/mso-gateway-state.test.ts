import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { GATEWAY, VERSION, fixture, readState, runGateway as run } from "./mso-gateway-test-fixture";

function health(buildId = "fixture") {
  return `{"status":"ok","service":"mso","buildId":"${buildId}","buildSha":"sha-${buildId}","runtimeInstanceId":"fixture","version":"${VERSION}"}`;
}

function jsonStatus(env: NodeJS.ProcessEnv) {
  const out = spawnSync(GATEWAY, ["status", "--json"], { encoding: "utf8", env });
  return { status: out.status, stderr: out.stderr, value: JSON.parse(out.stdout) as Record<string, unknown> };
}

describe("gateway provider-neutral state model", () => {
  it("classifies an MSO-owned healthy provider as managed-running", () => {
    const f = fixture();
    run(["start"], f.baseEnv);
    const observed = jsonStatus(f.baseEnv);
    expect(observed.status).toBe(0);
    expect(observed.value.state).toBe("managed-running");
    expect(observed.value.ownership).toBe("mso");
    expect(observed.value.provider).toBe("cloudflare");
    expect(observed.value.processHealth).toBe("alive");
    expect(observed.value.publicHealth).toBe("healthy");
    expect((observed.value.capabilities as Record<string, unknown>).managedProcess).toBe(true);
    run(["stop"], f.baseEnv);
  });

  it("classifies an alive owned provider with a failed public route as degraded without restarting it", () => {
    const f = fixture();
    run(["start"], f.baseEnv);
    const owned = readState(f.state).value.tunnelIdentity.pid;
    fs.writeFileSync(f.curl, `#!/bin/sh\ncase "$*" in\n  *127.0.0.1:4005/api/health*) printf '%s\\n' '${health()}' ;;\n  *trycloudflare.com/api/health*) exit 6 ;;\n  *) printf '%s\\n' '${health()}' ;;\nesac\n`, { mode: 0o700 });
    const observed = jsonStatus(f.baseEnv);
    expect(observed.status).toBe(2);
    expect(observed.value.state).toBe("degraded");
    expect(observed.value.ownership).toBe("mso");
    expect(observed.value.processHealth).toBe("alive");
    expect(observed.value.publicHealth).toBe("failing");
    expect(() => process.kill(owned, 0)).not.toThrow();
    run(["stop"], f.baseEnv);
  });

  it("detects a healthy configured route with no MSO ownership as external-running and leaves it external on stop", () => {
    const f = fixture();
    fs.writeFileSync(f.curl, `#!/bin/sh\nprintf '%s\\n' '${health()}'\n`, { mode: 0o700 });
    const env = { ...f.baseEnv, OS_PUBLIC_ORIGIN: "https://external.example.test" };
    const observed = jsonStatus(env);
    expect(observed.status).toBe(0);
    expect(observed.value.state).toBe("external-running");
    expect(observed.value.ownership).toBe("external");
    expect(observed.value.provider).toBe("custom");
    expect(observed.value.publicHealth).toBe("healthy");
    expect((observed.value.capabilities as Record<string, unknown>).managedProcess).toBe(false);

    run(["stop"], env);
    const after = jsonStatus(env);
    expect(after.value.state).toBe("external-running");
    expect(after.value.ownership).toBe("external");
  });

  it("treats a public MSO identity mismatch as degraded external rather than healthy", () => {
    const f = fixture();
    fs.writeFileSync(f.curl, `#!/bin/sh\ncase "$*" in\n  *127.0.0.1:4005/api/health*) printf '%s\\n' '${health("selected")}' ;;\n  *external.example.test/api/health*) printf '%s\\n' '${health("other")}' ;;\n  *) printf '%s\\n' '${health("selected")}' ;;\nesac\n`, { mode: 0o700 });
    const env = { ...f.baseEnv, OS_PUBLIC_ORIGIN: "https://external.example.test" };
    const observed = jsonStatus(env);
    expect(observed.status).toBe(2);
    expect(observed.value.state).toBe("degraded");
    expect(observed.value.ownership).toBe("external");
    expect(observed.value.publicHealth).toBe("identity-mismatch");
  });

  it("reports stale recorded ownership as recovering without mutating the process model", async () => {
    const f = fixture();
    run(["start"], f.baseEnv);
    const pid = readState(f.state).value.tunnelIdentity.pid;
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 100; i++) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const observed = jsonStatus(f.baseEnv);
    expect(observed.status).toBe(2);
    expect(observed.value.state).toBe("recovering");
    expect(observed.value.ownership).toBe("mso");
    expect(observed.value.processHealth).toBe("stale");
  });

  it("refuses a duplicate managed start when a verified external route already exists", () => {
    const f = fixture();
    fs.writeFileSync(f.curl, `#!/bin/sh\nprintf '%s\\n' '${health()}'\n`, { mode: 0o700 });
    const env = { ...f.baseEnv, OS_PUBLIC_ORIGIN: "https://external.example.test" };
    const out = spawnSync(GATEWAY, ["start"], { encoding: "utf8", env });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("externally managed");
    expect(out.stderr).toContain("refusing to create a duplicate");
  });
});
