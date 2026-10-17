import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

const ROOT = path.resolve(__dirname, "..");
const HELPER = path.join(__dirname, "lib/gateway-named-config.mjs");
const TUNNEL = "11111111-2222-4333-8444-555555555555";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-named-config-")); dirs.push(dir);
  const file = path.join(dir, "config.yml"), cred = path.join(dir, "credential.json");
  fs.writeFileSync(cred, "must-not-be-read", { mode: 0o600 });
  const cfg: Record<string, unknown> = { tunnel: TUNNEL, "credentials-file": cred, ingress: [
    { hostname: "mso.example.test", service: "http://127.0.0.1:4005" }, { service: "http_status:404" },
  ] };
  const write = () => fs.writeFileSync(file, YAML.stringify(cfg), { mode: 0o600 });
  write();
  return { dir, file, cred, cfg, write };
}
function run(file: string, action = "inspect", template = "{id}.mso.example.test", host = "9router.mso.example.test") {
  return spawnSync(process.execPath, [HELPER, ROOT, file, "https://mso.example.test", "http://127.0.0.1:4005", template, action, host, TUNNEL], { encoding: "utf8", timeout: 3000 });
}

describe("named gateway YAML policy", () => {
  it.each(["{id}.mso.example.test", "{id}-mso.example.test"])("supports exact managed app template %s", (template) => {
    const f = fixture(), host = template.replace("{id}", "9router");
    expect(run(f.file, "ensure", template, host).status).toBe(0);
    expect(run(f.file, "validate", template, host).status).toBe(0);
    expect(YAML.parse(fs.readFileSync(f.file, "utf8")).ingress[1]).toEqual({ hostname: host, service: "http://127.0.0.1:4005" });
  });

  it.each([
    { hostname: "*.mso.example.test", service: "http://127.0.0.1:4005" },
    { hostname: "mso.example.test", service: "http://127.0.0.1:4005" },
    { hostname: "9router.mso.example.test", service: "http://127.0.0.1:4005", path: "/admin" },
    { hostname: "9router.mso.example.test", service: "http://127.0.0.2:4005" },
    { hostname: "9router.mso.example.test", service: "http://127.0.0.1:4005", originRequest: { httpHostHeader: "mso.example.test" } },
  ])("rejects conflicting/unsafe app ingress %#", (rule) => {
    const f = fixture(); (f.cfg.ingress as unknown[]).splice(1, 0, rule); f.write();
    const before = fs.readFileSync(f.file, "utf8");
    expect(run(f.file, "ensure").status).toBe(1);
    expect(fs.readFileSync(f.file, "utf8")).toBe(before);
  });

  it("overrides a valid cockpit-wide Host header for the app while preserving other global settings", () => {
    const f = fixture(); f.cfg.originRequest = { httpHostHeader: "mso.example.test", connectTimeout: "20s" }; f.write();
    const result = run(f.file, "ensure");
    expect(result.status, result.stderr).toBe(0);
    const cfg = YAML.parse(fs.readFileSync(f.file, "utf8"));
    expect(cfg.originRequest).toEqual(f.cfg.originRequest);
    expect(cfg.ingress[1].originRequest.httpHostHeader).toBe("9router.mso.example.test");
  });

  it("rejects cockpit Host overrides and a different loopback listener in app-route mode", () => {
    const f = fixture(); f.cfg.originRequest = { httpHostHeader: "other.example.test" }; f.write();
    expect(run(f.file).status).toBe(1);
    delete f.cfg.originRequest;
    (f.cfg.ingress as { service: string }[])[0].service = "http://127.0.0.2:4005"; f.write();
    expect(run(f.file).status).toBe(1);
    expect(run(f.file, "validate").status).toBe(0);
  });

  it("rejects a symlink or FIFO config without blocking", () => {
    const f = fixture(), link = path.join(f.dir, "link.yml"), fifo = path.join(f.dir, "fifo.yml");
    fs.symlinkSync(f.file, link);
    expect(run(link).status).toBe(1);
    expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
    const result = run(fifo);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
  });
});
