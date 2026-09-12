import { afterAll, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-session-enumeration-"));
vi.stubEnv("OS_AGENT_SESSIONS_DIR", root);
vi.resetModules();
const { listSessionRecords } = await import("./session-files");
afterAll(async () => { vi.unstubAllEnvs(); await fs.rm(root, {recursive:true,force:true}); });
it("enumerates sessions beyond the former 5000-file cutoff with bounded reads", async () => {
  for (let start=0; start<5001; start+=100) await Promise.all(Array.from({length:Math.min(100,5001-start)},async (_,offset)=>{
    const id="20260912_000000_"+(start+offset).toString(16).padStart(8,"0");
    await fs.writeFile(path.join(root,id+".json"),JSON.stringify({id,principalHash:"fixture",source:"mcp",history:[],events:[],memorySnapshot:{}}),{mode:0o600});
  }));
  const rows=await listSessionRecords();
  expect(rows).toHaveLength(5001);
  expect(rows.some(row=>row.id.endsWith("00001388"))).toBe(true);
},15000);
