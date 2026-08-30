import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const GATEWAY = path.join(ROOT, "scripts/mso-gateway");
const roots: string[] = [];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const snapshot = (file: string) => {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`not a regular file: ${file}`);
    return { mode: stat.mode & 0o777, text: fs.readFileSync(fd, "utf8") };
  } finally { fs.closeSync(fd); }
};
const appendNoFollow = (file: string, value: string) => {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
  try { fs.writeSync(fd, value); } finally { fs.closeSync(fd); }
};

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("gateway supply chain", () => {
  it("pins release-tagged official Cloudflare binaries for supported Linux architectures", () => {
    const lock = fs.readFileSync(path.join(ROOT, "security/gateway-artifacts.env"), "utf8");
    expect(lock).toContain("CLOUDFLARED_VERSION='2026.8.2'");
    expect(lock).toMatch(/releases\/download\/2026\.8\.2\/cloudflared-linux-amd64/);
    expect(lock).toMatch(/releases\/download\/2026\.8\.2\/cloudflared-linux-arm64/);
    expect(lock.match(/CLOUDFLARED_LINUX_(?:AMD64|ARM64)_SHA256='[0-9a-f]{64}'/g)).toHaveLength(2);
    expect(lock).not.toContain("latest");
  });

  it("downloads to user-local state, verifies SHA-256, and reuses only the verified cached binary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-gateway-pin-")); roots.push(root);
    const bin = path.join(root, "bin"), state = path.join(root, "state"), tools = path.join(root, "tools");
    fs.mkdirSync(bin, { mode: 0o700 });
    const envFile = path.join(root, ".env.local"); fs.writeFileSync(envFile, "OS_SESSION_SECRET=fixture\n", { mode: 0o600 });
    const binary = "#!/bin/sh\necho 'cloudflared version pinned-fixture'\n";
    const digest = sha(binary), count = path.join(root, "downloads");
    const lock = path.join(root, "gateway-artifacts.env");
    fs.writeFileSync(lock, `CLOUDFLARED_VERSION='fixture'\nCLOUDFLARED_LINUX_AMD64_URL='https://example.invalid/cloudflared-amd64'\nCLOUDFLARED_LINUX_AMD64_SHA256='${digest}'\nCLOUDFLARED_LINUX_ARM64_URL='https://example.invalid/cloudflared-arm64'\nCLOUDFLARED_LINUX_ARM64_SHA256='${digest}'\n`, { mode: 0o600 });
    const curl = path.join(bin, "curl");
    fs.writeFileSync(curl, `#!/bin/sh\nout=''\nwhile [ $# -gt 0 ]; do case \"$1\" in -o) out=\"$2\"; shift 2;; *) shift;; esac; done\n[ -n \"$out\" ] || exit 2\nprintf x >> '${count}'\ncat >\"$out\" <<'EOF'\n${binary}EOF\n`, { mode: 0o700 });
    const env = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, MSO_GATEWAY_ROOT: ROOT,
      MSO_GATEWAY_ENV: envFile, MSO_GATEWAY_STATE_DIR: state, MSO_GATEWAY_CURL: curl,
      MSO_GATEWAY_ARTIFACT_LOCK: lock, MSO_GATEWAY_TOOL_DIR: tools };

    const first = execFileSync(GATEWAY, ["install"], { encoding: "utf8", env });
    expect(first).toContain("pinned-fixture");
    const installed = path.join(tools, "fixture", "cloudflared");
    let installedSnapshot = snapshot(installed);
    expect(installedSnapshot.mode).toBe(0o700);
    expect(sha(installedSnapshot.text)).toBe(digest);
    expect(fs.readFileSync(count, "utf8")).toBe("x");

    execFileSync(GATEWAY, ["install"], { encoding: "utf8", env });
    expect(fs.readFileSync(count, "utf8")).toBe("x");
    fs.appendFileSync(installed, "tamper\n");
    execFileSync(GATEWAY, ["install"], { encoding: "utf8", env });
    expect(fs.readFileSync(count, "utf8")).toBe("xx");
    expect(sha(fs.readFileSync(installed, "utf8"))).toBe(digest);
  });
});
