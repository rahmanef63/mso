// Telemetry-sink contract: the same redactor guards every place MSO persists a
// target/argument string (MCP activity stream + host audit trail). Before this
// existed the audit trail wrote credential-shaped values verbatim while
// audit-schema.test.ts claimed it could not.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redactText } from "./redact-text";

let dir = "";
let activityFile = "";
let auditFile = "";

// Synthetic credential shapes only; each line is assembled so the literal never
// matches a scanner's own fixture database.
const SECRETS = {
  openaiHyphen: ["sk", "live", "0123456789abcdef"].join("-"),
  jwt: ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJxYSJ9", "c2lnbmF0dXJlLXNlY3JldA"].join("."),
  slack: ["xoxb", "123456789012", "abcdefghijklmn"].join("-"),
  google: ["AIza", "SyA1234567890abcdefghijklmnopqrstuv"].join(""),
  gitlab: ["glpat", "abcdefghij0123456789"].join("-"),
  bearer: `Bearer ${"abcdefghijklmnopqrstuvwxyz"}`,
} as const;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-telemetry-sinks-"));
  activityFile = path.join(dir, "activity.log");
  auditFile = path.join(dir, "audit.log");
  process.env.OS_MCP_ACTIVITY_LOG = activityFile;
  process.env.OS_AUDIT_LOG = auditFile;
});
afterAll(async () => {
  delete process.env.OS_MCP_ACTIVITY_LOG;
  delete process.env.OS_AUDIT_LOG;
  await fs.rm(dir, { recursive: true, force: true });
});

const { activityTarget, recordCapabilityActivity } = await import("@/lib/capabilities/activity");
const { audit } = await import("@/lib/host/audit-api");

describe("redactText covers the credential shapes operators actually paste", () => {
  it.each(Object.entries(SECRETS))("scrubs %s", (_shape, secret) => {
    const out = redactText(`curl -H 'x: ${secret}' https://example.invalid`);
    expect(out).not.toContain(secret);
    expect(out).toContain("[redacted]");
  });

  it("leaves ordinary command text intact", () => {
    const line = "bun run verify && git status --short --branch";
    expect(redactText(line)).toBe(line);
  });
});

describe("every persisted sink shares that redactor", () => {
  it("the MCP activity target never carries a credential", () => {
    for (const secret of Object.values(SECRETS)) {
      expect(activityTarget({ query: `look up ${secret}` }) ?? "").not.toContain(secret);
    }
  });

  it("the activity stream never carries a credential", async () => {
    for (const [shape, secret] of Object.entries(SECRETS)) {
      await recordCapabilityActivity({ id: `act-${shape}`, tool: "fs_read", state: "completed", target: `look up ${secret}` });
    }
    const raw = await fs.readFile(activityFile, "utf8");
    for (const [shape, secret] of Object.entries(SECRETS)) expect(raw, `activity ${shape}`).not.toContain(secret);
  });

  it("the audit trail never carries a credential in target, detail or meta", async () => {
    for (const secret of Object.values(SECRETS)) {
      await audit({ action: "exec.run", target: `curl ${secret} https://example.invalid`, detail: `failed: ${secret}`, ok: false, meta: { url: secret } });
    }
    const raw = await fs.readFile(auditFile, "utf8");
    expect(raw).toContain("[redacted]");
    for (const [shape, secret] of Object.entries(SECRETS)) expect(raw, `audit ${shape}`).not.toContain(secret);
  });

  it("still records the plaintext command that an operator needs to read", async () => {
    await audit({ action: "exec.run", target: "bun run verify", ok: true });
    const raw = await fs.readFile(auditFile, "utf8");
    expect(raw).toContain("bun run verify");
  });
});
