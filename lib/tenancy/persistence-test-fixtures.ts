import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";
import { openTenantPersistence } from "./persistence";
import { createTenantAuthority } from "./authority";

export const alice = { issuer: "fixture", subject: "alice", expiresAt: Date.now() + 3600000 };
export const bob = { issuer: "fixture", subject: "bob", expiresAt: Date.now() + 3600000 };
export const bindingA = { tenantId: "tenant-a", principalId: "person-a", enabled: true, tenantEnabled: true };
export const bindingB = { tenantId: "tenant-b", principalId: "person-b", enabled: true, tenantEnabled: true };
export async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-tenant-persistence-"));
  const store = await openTenantPersistence({ root, initialize: true });
  await store.administration.setBinding(alice, bindingA, 0);
  await store.administration.setBinding(bob, bindingB, 1);
  const authority = createTenantAuthority(store.registry, store.storage);
  return { root, store, authority, contextA: await authority.authenticate(alice), contextB: await authority.authenticate(bob),
    cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
export async function compileChild(directory: string) {
  const files = ["tenancy/persistence", "tenancy/persistence-file", "tenancy/persistence-schema",
    "tenancy/persistence-memory", "tenancy/memory-ledger", "tenancy/memory-tools", "tenancy/authority",
    "agent/memory-resolution", "agent/memory-query"];
  for (const name of files) {
    const source = (await fs.readFile(path.join(process.cwd(), "lib", name + ".ts"), "utf8"))
      .replaceAll('"@/lib/agent/', '"../agent/');
    const target = path.join(directory, name + ".js");
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, { mode: 0o600 });
  }
  await fs.copyFile(path.join(process.cwd(), "lib/agent/memory-context.mjs"), path.join(directory, "agent/memory-context.mjs"));
}
export const child = promisify(execFile);
