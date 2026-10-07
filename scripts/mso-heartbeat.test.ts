import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const source = path.resolve(__dirname, "..");
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mso-heartbeat-")); roots.push(home);
  const root = path.join(home, "repo with spaces % ' café\t"), bin = path.join(home, "bin");
  fs.mkdirSync(path.join(root, "scripts/lib"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(bin, { mode: 0o700 });
  for (const file of ["gateway-config.sh", "gateway-common.sh", "private-state.sh", "heartbeat-cron.sh", "gateway-provider.sh", "gateway-tool.sh", "gateway-tunnel.sh", "gateway-cloudflare-edge.sh"])
    fs.copyFileSync(path.join(source, "scripts/lib", file), path.join(root, "scripts/lib", file));
  fs.copyFileSync(path.join(source, "scripts/mso-heartbeat"), path.join(root, "scripts/mso-heartbeat"));
  fs.mkdirSync(path.join(root, "security"));
  fs.copyFileSync(path.join(source, "security/gateway-artifacts.env"), path.join(root, "security/gateway-artifacts.env"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.symlinkSync(path.join(source, "node_modules/yaml"), path.join(root, "node_modules/yaml"));
  const config = path.join(home, "cloudflared.yml"), credential = path.join(home, "credential.json");
  fs.writeFileSync(credential, "{}", { mode: 0o600 });
  fs.writeFileSync(config, `credentials-file: ${credential}\ningress:\n  - hostname: fixture.example\n    service: http://127.0.0.1:4005\n  - service: http_status:404\n`, { mode: 0o600 });
  const envFile = path.join(root, ".env.local"), observation = path.join(home, "observation.json");
  fs.writeFileSync(envFile, "", { mode: 0o600 });
  fs.writeFileSync(path.join(root, "scripts/mso-gateway"), `#!/bin/bash
if [ "$1" = status ]; then cat "$HOME/observation.json"; exit 2; fi
printf '%s\\n' "$*" >>"$HOME/actions"
if [ "$1" = start ] || [ "$1" = local-start ]; then
  printf '%s' '{"ownership":"mso","localHealth":"healthy","publicHealth":"healthy","public":"https://fixture.example","supervisor":"mso-lifecycle"}' >"$HOME/observation.json"
fi
`, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, "crontab"), `#!/bin/bash
if [ "$1" = -l ]; then
  if [ -f "$HOME/table" ]; then cat "$HOME/table"; else echo 'no crontab for fixture' >&2; exit 1; fi
else cat >"$HOME/table"; fi
`, { mode: 0o700 });
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, MSO_GATEWAY_ROOT: root,
    MSO_GATEWAY_ENV: envFile, OS_HEARTBEAT_ENABLED: "1", OS_HEARTBEAT_FAILURE_THRESHOLD: "1",
    OS_PUBLIC_ORIGIN: "", MSO_GATEWAY_LOCAL_URL: "http://127.0.0.1:4005" };
  function state(ownership = "mso", healthy = false, supervisor = "mso-lifecycle") {
    fs.writeFileSync(observation, JSON.stringify({ ownership, supervisor,
      localHealth: healthy ? "healthy" : "unhealthy", publicHealth: healthy ? "healthy" : "unhealthy", public: null }));
  }
  state();
  const run = (args: string[] = [], extra = {}, cwd?: string) => spawnSync("bash", [path.join(root, "scripts/mso-heartbeat"), ...args], { env: { ...env, ...extra }, cwd, encoding: "utf8" });
  const actions = () => fs.existsSync(path.join(home, "actions")) ? fs.readFileSync(path.join(home, "actions"), "utf8") : "";
  return { home, root, config, envFile, observation, env, state, run, actions };
}
describe("optional one-shot heartbeat", () => {
  it("is disabled by default and does not create runtime state", () => {
    const f = fixture(); const result = f.run([], { OS_HEARTBEAT_ENABLED: "0" });
    expect(result.status).toBe(0); expect(result.stdout).toContain("disabled");
    expect(fs.existsSync(path.join(f.home, ".mso"))).toBe(false); expect(f.actions()).toBe("");
  });
  it("resets failures on valid health without changing any process", () => {
    const f = fixture(); f.state("mso", true);
    expect(f.run().status).toBe(0); expect(f.actions()).toBe("");
  });
  it("counts consecutive failures and recovers only the explicit managed recipe", () => {
    const f = fixture(); const extra = { OS_HEARTBEAT_FAILURE_THRESHOLD: "2",
      OS_HEARTBEAT_GATEWAY_CONFIG: f.config, OS_HEARTBEAT_GATEWAY_TUNNEL: "fixture", OS_PUBLIC_ORIGIN: "https://fixture.example" };
    expect(f.run([], extra).status).toBe(2); expect(f.actions()).toBe("");
    const result = f.run([], extra);
    expect(result.stderr).toBe(""); expect(result.status).toBe(0);
    expect(f.actions()).toBe(`stop\nstart --config ${f.config} --tunnel fixture\n`);
    expect(result.stdout).toContain("recovered");
  });
  it("validates the recovery recipe before stopping a degraded managed connector", () => {
    const f = fixture();
    expect(f.run([], { OS_HEARTBEAT_GATEWAY_CONFIG: "/missing/config", OS_HEARTBEAT_GATEWAY_TUNNEL: "fixture" }).status).toBe(1);
    expect(f.actions()).toBe("");
  });
  it("checks public health even when the local runtime is healthy", () => {
    const f = fixture();
    fs.writeFileSync(f.observation, JSON.stringify({ ownership: "mso", supervisor: "mso-lifecycle",
      localHealth: "healthy", publicHealth: "unhealthy", public: "https://fixture.example" }));
    expect(f.run().status).toBe(2); expect(f.actions()).toBe("");
  });
  it("loads the opt-in from the installation env file", () => {
    const f = fixture(); f.state("mso", true);
    fs.writeFileSync(f.envFile, "OS_HEARTBEAT_ENABLED=1\n");
    expect(f.run([], { OS_HEARTBEAT_ENABLED: "0" }).stdout).toContain("healthy");
    fs.writeFileSync(f.envFile, "OS_HEARTBEAT_ENABLED=0\n");
    expect(f.run().stdout).toContain("disabled");
  });
  it("does not replace a named gateway with a quick tunnel", () => {
    const f = fixture(); expect(f.run().status).toBe(2); expect(f.actions()).toBe("");
  });
  it.each(["external", "systemd", "s6", "docker", "kubernetes"])("preserves %s supervision", supervisor => {
    const f = fixture(); f.state("mso", false, supervisor);
    expect(f.run().status).toBe(2); expect(f.actions()).toBe("");
  });
  it("never adopts an externally owned connector", () => {
    const f = fixture(); f.state("external", false, "unknown");
    expect(f.run().status).toBe(2); expect(f.actions()).toBe("");
  });
  it("recovers an absent loopback fallback without creating a public connector", () => {
    const f = fixture(); f.state("none", false, "unknown");
    expect(f.run().status).toBe(0); expect(f.actions()).toBe("local-start\n");
  });
  it("rejects a corrupt observation before lifecycle actions", () => {
    const f = fixture(); fs.writeFileSync(f.observation, '{"stateError":"unsafe-or-corrupt"}');
    expect(f.run().status).toBe(1); expect(f.actions()).toBe("");
  });
  it("rejects an unsafe env file", () => {
    const f = fixture(); fs.chmodSync(f.envFile, 0o644);
    expect(f.run().status).toBe(1); expect(f.actions()).toBe("");
  });
  it("installs idempotent 30-minute and reboot entries, preserving other jobs", () => {
    const f = fixture(); fs.writeFileSync(path.join(f.home, "table"), "5 * * * * /unrelated/job\n");
    expect(f.run(["install-cron"]).status).toBe(0);
    expect(f.run(["install-cron"]).status).toBe(0);
    const table = fs.readFileSync(path.join(f.home, "table"), "utf8");
    expect(table).toContain("*/30 * * * *"); expect(table).toContain("@reboot");
    expect(table.match(/# mso-heartbeat:/g)).toHaveLength(2); expect(table).toContain("/unrelated/job");
    expect(f.run(["remove-cron"], { OS_HEARTBEAT_ENABLED: "0" }).status).toBe(0);
    expect(fs.readFileSync(path.join(f.home, "table"), "utf8")).toBe("5 * * * * /unrelated/job\n");
  });
  it("resets consecutive failures after a healthy observation", () => {
    const f = fixture(), extra = { OS_HEARTBEAT_FAILURE_THRESHOLD: "2" };
    expect(f.run([], extra).status).toBe(2);
    f.state("mso", true); expect(f.run([], extra).status).toBe(0);
    f.state(); expect(f.run([], extra).status).toBe(2); expect(f.actions()).toBe("");
  });
  it("serializes checks without inheriting its lock into lifecycle children", () => {
    const f = fixture(); f.state("mso", true); expect(f.run().status).toBe(0);
    const base = path.join(f.home, ".mso/private/heartbeat");
    const lock = path.join(base, fs.readdirSync(base)[0], "check.lock");
    const result = spawnSync("flock", [lock, "bash", path.join(f.root, "scripts/mso-heartbeat")], { env: f.env, encoding: "utf8" });
    expect(result.status).toBe(0); expect(result.stdout).toContain("already running"); expect(f.actions()).toBe("");
  });
  it("runs cron under POSIX sh with quoted, Unicode, tab and percent paths", () => {
    const f = fixture(); f.state("mso", true); expect(f.run(["install-cron"]).status).toBe(0);
    const line = fs.readFileSync(path.join(f.home, "table"), "utf8").split("\n")[0];
    const command = line.replace(/^\S+ \S+ \S+ \S+ \S+ /, "").replace(/ # mso-heartbeat:.*$/, "").replace(/\\%/g, "%");
    const result = spawnSync("sh", ["-c", command], { env: { ...f.env, MSO_GATEWAY_ROOT: "" }, encoding: "utf8" });
    expect(result.stderr).toBe(""); expect(result.status).toBe(0); expect(f.actions()).toBe("");
  });
  it("does not overwrite crontab when reading it fails", () => {
    const f = fixture(); fs.writeFileSync(path.join(f.home, "table"), "5 * * * * /unrelated/job\n");
    fs.writeFileSync(path.join(f.home, "bin/crontab"), "#!/bin/bash\necho 'permission denied' >&2\nexit 1\n", { mode: 0o700 });
    expect(f.run(["install-cron"]).status).toBe(1);
    expect(fs.readFileSync(path.join(f.home, "table"), "utf8")).toContain("/unrelated/job");
  });
  it("preserves a caller-relative env file when cron starts from HOME", () => {
    const f = fixture(); f.state("mso", true);
    fs.writeFileSync(f.envFile, "OS_HEARTBEAT_ENABLED=1\n");
    expect(f.run(["install-cron"], { MSO_GATEWAY_ENV: ".env.local", OS_HEARTBEAT_ENABLED: "0" }, f.root).status).toBe(0);
    const line = fs.readFileSync(path.join(f.home, "table"), "utf8").split("\n")[0];
    const command = line.replace(/^\S+ \S+ \S+ \S+ \S+ /, "").replace(/ # mso-heartbeat:.*$/, "").replace(/\\%/g, "%").replace(" >/dev/null", "");
    const result = spawnSync("sh", ["-c", command], { cwd: f.home, env: { ...f.env, MSO_GATEWAY_ROOT: "", OS_HEARTBEAT_ENABLED: "0" }, encoding: "utf8" });
    expect(result.status).toBe(0); expect(result.stdout).toContain("healthy");
  });
  it("does not install cron while disabled or with an invalid interval", () => {
    const f = fixture(); expect(f.run(["install-cron"], { OS_HEARTBEAT_ENABLED: "0" }).status).toBe(0);
    expect(fs.existsSync(path.join(f.home, "table"))).toBe(false);
    expect(f.run(["install-cron"], { OS_HEARTBEAT_INTERVAL_MINUTES: "31" }).status).toBe(1);
    expect(fs.existsSync(path.join(f.home, "table"))).toBe(false);
  });
});
