import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cli = fs.readFileSync(path.join(__dirname, "../bin/mso"), "utf8");

describe("terminal onboarding contract", () => {
  it("keeps API keys out of curl argv", () => {
    expect(cli).toContain('tty_secret "Paste $provider API key: "');
    expect(cli).toContain("stty -echo < /dev/tty");
    const start = cli.indexOf("secret_post() {");
    const end = cli.indexOf("\n}\n\ntty_ok()", start);
    const secretPost = cli.slice(start, end);
    expect(secretPost).toContain("-d @-");
    expect(secretPost).toContain('printf \'%s\' "$body" | curl');
    expect(secretPost).not.toContain('-d "$body"');
    expect(cli).toContain('secret_post "/api/config" "$body"');
  });

  it("documents OAuth separately from API-key providers", () => {
    expect(cli).toContain("OpenAI ChatGPT OAuth (Codex consumer backend; no API key)");
    expect(cli).toContain("OpenRouter API key");
    expect(cli).toContain("OpenAI Platform API key");
  });

  it("keeps -y minimal instead of selecting external accounts or installs", () => {
    expect(cli).toContain("AI provider skipped (-y keeps external accounts unconfigured)");
    expect(cli).toContain("response preset left unchanged (-y keeps existing/default settings)");
    expect(cli).toContain("optional managed apps skipped (-y uses minimal defaults)");
    expect(cli).toContain("none installed automatically; run: mso skills install ponytail caveman rtk -y");
  });
  it("bootstraps onboarding against a verified loopback runtime without asking for approval twice", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-onboard-cli-"));
    const bin = path.join(root, "bin");
    const envFile = path.join(root, ".env.local");
    const store = path.join(root, "devices.json");
    const fakeCurl = path.join(bin, "curl");
    fs.mkdirSync(bin, { mode: 0o700 });
    fs.writeFileSync(envFile, "OS_LOGIN_PASSWORD=fixture-password\nOS_SESSION_SECRET=fixture-session-secret-long-enough\n", { mode: 0o600 });
    fs.writeFileSync(fakeCurl, `#!/bin/sh
case "$*" in
  *api/auth/login*) printf '{"success":true}\n200' ;;
  *api/auth/me*) printf '{"role":"owner"}\n200' ;;
  *) printf '{"status":"ok","buildId":"fixture","runtimeInstanceId":"fixture","version":"0.2.1"}\n' ;;
esac
`, { mode: 0o700 });
    try {
      const out = execFileSync(path.join(__dirname, "../bin/mso"), ["--base", "http://127.0.0.1:4555", "onboard", "-y"], {
        encoding: "utf8",
        env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, MSO_ENV: envFile, OS_DEVICE_STORE: store,
          MSO_GATEWAY_CURL: fakeCurl, MSO_GATEWAY_STATE_DIR: path.join(root, "gateway-state") },
      });
      expect(out).toContain("approved this local CLI device");
      expect(out).toContain("verified local MSO runtime at http://127.0.0.1:4555");
      expect(out).toContain("Onboarding complete.");
      expect(Object.keys(JSON.parse(fs.readFileSync(store, "utf8")).approved)).toHaveLength(1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("reports a down runtime instead of falsely asking an already-approved device to approve again", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-login-down-"));
    const bin = path.join(root, "bin");
    const envFile = path.join(root, ".env.local");
    fs.mkdirSync(bin, { mode: 0o700 });
    fs.writeFileSync(envFile, "OS_LOGIN_PASSWORD=fixture-password\n", { mode: 0o600 });
    fs.writeFileSync(path.join(bin, "curl"), "#!/bin/sh\nexit 7\n", { mode: 0o700 });
    try {
      const result = spawnSync(path.join(__dirname, "../bin/mso"), ["--base", "http://127.0.0.1:4555", "login"], {
        encoding: "utf8", env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, MSO_ENV: envFile },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("MSO runtime is not reachable");
      expect(result.stderr).not.toContain("approve this device");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

});
