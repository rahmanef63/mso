import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ManagedDomainConfig } from "../lib/contracts/managed-domains";
import { managedDomainEnvironment } from "./domain-env";

const config: ManagedDomainConfig = {
  publicOrigin: "https://mso.example.com", hostTemplate: "{id}.mso.example.com",
  localOrigin: "http://127.0.0.1:4005", zoneId: "a".repeat(32), zoneName: "example.com",
  accountId: "b".repeat(32), tunnelId: "12345678-1234-1234-1234-123456789abc",
  user: "owner", connection: "cloudflare-main", autoProvision: true,
};
const privateLines = "# Keep settings\nOS_SESSION_SECRET='fixture-value-only'\nOTHER=value=with=equals\n# OS_PUBLIC_ORIGIN=https://comment.example.com\n";
let directory: string;
let file: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "mso-domain-env-"));
  file = path.join(directory, ".env.local");
  await fs.writeFile(file, `${privateLines}export OS_PUBLIC_ORIGIN=https://old.example.com\nNEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE={id}.old.example.com\n`, { mode: 0o600 });
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe("managed-domain environment repair", () => {
  it("previews only public values without changing the env file or returning secrets", async () => {
    const before = await fs.readFile(file, "utf8");
    const result = await managedDomainEnvironment(file, config);
    expect(result).toMatchObject({ changed: true, applied: false, values: {
      OS_PUBLIC_ORIGIN: config.publicOrigin, NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE: config.hostTemplate,
    } });
    expect(JSON.stringify(result)).not.toContain("fixture-value-only");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("replaces duplicate public assignments, preserves unrelated content, and remains idempotent", async () => {
    await fs.appendFile(file, "OS_PUBLIC_ORIGIN=https://duplicate.example.com\n");
    const first = await managedDomainEnvironment(file, config, true);
    const changed = await fs.readFile(file, "utf8");
    expect(first).toMatchObject({ changed: true, applied: true, restartRequired: true });
    expect(changed).toBe(`${privateLines}OS_PUBLIC_ORIGIN=${config.publicOrigin}\nNEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE=${config.hostTemplate}\n`);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await managedDomainEnvironment(file, config, true)).toMatchObject({ changed: false, applied: true, restartRequired: false });
    expect(await fs.readFile(file, "utf8")).toBe(changed);
  });

  it("preserves a final unrelated line without a newline", async () => {
    await fs.writeFile(file, "UNRELATED='last-line'");
    await managedDomainEnvironment(file, config, true);
    expect(await fs.readFile(file, "utf8")).toBe(`UNRELATED='last-line'\nOS_PUBLIC_ORIGIN=${config.publicOrigin}\nNEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE=${config.hostTemplate}\n`);
  });

  it("does not recreate a missing env file with incomplete server settings", async () => {
    await fs.unlink(file);
    await expect(managedDomainEnvironment(file, config, true)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses permissive files and invalid routing before rewriting existing settings", async () => {
    const before = await fs.readFile(file, "utf8");
    await fs.chmod(file, 0o644);
    await expect(managedDomainEnvironment(file, config, true)).rejects.toThrow(/must be private/);
    await fs.chmod(file, 0o600);
    await expect(managedDomainEnvironment(file, { ...config, hostTemplate: "{id}.other.com" }, true)).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("refuses a symlink instead of editing the referenced env file", async () => {
    const target = path.join(directory, "unrelated.env");
    await fs.rename(file, target);
    const before = await fs.readFile(target, "utf8");
    await fs.symlink(target, file);
    await expect(managedDomainEnvironment(file, config, true)).rejects.toThrow();
    expect(await fs.readFile(target, "utf8")).toBe(before);
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
  });
});
