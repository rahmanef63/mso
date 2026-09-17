import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { seedSessionMonitor } from "./e2e/session-fixture.mjs";

it("reseeds all responsive journeys without rewriting the synthetic artifact commit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mso-session-seed-test-"));
  try {
    const env = { OS_AGENT_SESSIONS_DIR: path.join(root, "sessions"), OS_LOCAL_AGENT_PRESENCE_STORE: path.join(root, "presence.json") };
    let firstHead: string | undefined;
    for (let pass = 0; pass < 3; pass++) {
      await seedSessionMonitor(env);
      const row = JSON.parse(await readFile(path.join(env.OS_AGENT_SESSIONS_DIR, "20260909_120000_00000000.json"), "utf8"));
      const captured = row.events[0].artifactRevision;
      firstHead ??= captured.gitHead;
      expect(captured.gitHead).toBe(firstHead);
      expect(captured.cleanAtCapture).toBe(true);
      expect(await readFile(path.join(root, "session-project/src/fixture.ts"), "utf8")).toBe("export const value = 2;\n");
      const original = execFileSync("git", ["show", `${captured.gitHead}:src/fixture.ts`], { cwd: path.join(root, "session-project"), encoding: "utf8" });
      expect(original).toBe("export const value = 1;\n");
      const presence = JSON.parse(await readFile(env.OS_LOCAL_AGENT_PRESENCE_STORE, "utf8"));
      expect(presence.entries).toHaveLength(9);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
