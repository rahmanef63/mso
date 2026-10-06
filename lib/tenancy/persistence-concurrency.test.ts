import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { tenantFile } from "./persistence-file";
import { openTenantPersistence } from "./persistence";
import { alice, bindingA, child, compileChild, fixture } from "./persistence-test-fixtures";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
describe("tenant persistence cross-process ordering", () => {
  it("allows exactly one process to commit the same expected revision", async () => {
    const f = await fixture(); cleanup.push(f.cleanup);
    const code = await fs.mkdtemp(path.join(os.tmpdir(), "mso-tenant-child-"));
    cleanup.push(() => fs.rm(code, { recursive: true, force: true }));
    await compileChild(code);
    const script = `const {openTenantPersistence}=require(process.argv[1]); (async()=>{
      const s=await openTenantPersistence({root:process.argv[2]});
      try { await s.administration.setBinding({issuer:"fixture",subject:process.argv[3]},
        {tenantId:"tenant-"+process.argv[3],principalId:"p",enabled:true,tenantEnabled:true},2); console.log("committed"); }
      catch(e) { if(e.message.includes("revision conflict")) console.log("conflict"); else throw e; }
    })().catch(e=>{console.error(e.message);process.exitCode=1});`;
    const run = (who: string) => child(process.execPath, ["-e", script, code + "/tenancy/persistence.js", f.root, who], { timeout: 8000 });
    const results = await Promise.all([run("one"), run("two")]);
    expect(results.map(r => r.stdout.trim()).sort()).toEqual(["committed", "conflict"]);
    expect(await f.store.administration.status()).toEqual({ revision: 3, auditEntries: 3 });
  });
  it("reloads a queued write after a barrier-controlled revocation commits", async () => {
    const f = await fixture(); cleanup.push(f.cleanup);
    const grant = { identity: alice, binding: (await f.store.registry.resolve(alice))! };
    const disk = await tenantFile(f.root);
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { entered = resolve; });
    const revoking = disk.transaction(async (directory, sync) => {
      const state = await disk.read(directory);
      entered();
      await barrier;
      state.bindings[0].enabled = false;
      state.bindings[0].mappingRevision = 3;
      state.revision = 3;
      state.audit.push({ id: "barrier-revocation", revision: 3, at: new Date().toISOString(),
        tenantId: "tenant-a", principalId: "person-a", mappingRevision: 3, scope: "principal", action: "binding.changed" });
      await disk.write(directory, sync, state, "barrier-revocation");
    });
    await acquired;
    const pending = f.store.storage.writeMemory(grant, "MEMORY.md", "must-not-commit", 3, 0);
    const refused = expect(pending).rejects.toThrow("tenant request denied");
    await new Promise(resolve => setTimeout(resolve, 25));
    release();
    await revoking;
    await refused;
    const state = JSON.parse(await fs.readFile(f.root + "/state.json", "utf8"));
    expect(state.memory).toEqual([]);
    expect(state.revision).toBe(3);
  });
  it("does not steal an abandoned lock even when its timestamp is old", async () => {
    const f = await fixture(); cleanup.push(f.cleanup);
    await child(process.execPath, ["-e",
      'require("node:fs").writeFileSync(process.argv[1]+"/state.lock","",{flag:"wx",mode:0o600})', f.root], { timeout: 3000 });
    await fs.utimes(f.root + "/state.lock", 1, 1);
    await expect(f.store.administration.setBinding(alice, bindingA, 2)).rejects.toThrow("abandoned locks require reviewed recovery");
    expect(JSON.parse(await fs.readFile(f.root + "/state.json", "utf8")).revision).toBe(2);
  }, 6000);
  it("does not recreate missing established state", async () => {
    const f = await fixture(); cleanup.push(f.cleanup);
    await fs.rename(f.root + "/state.json", f.root + "/preserved.json");
    await expect(f.store.administration.status()).rejects.toThrow();
    await expect(openTenantPersistence({ root: f.root })).rejects.toThrow();
    await expect(fs.stat(f.root + "/state.json")).rejects.toThrow();
  });
});
