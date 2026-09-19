import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mso-openai-plugin-doctor-"));
  roots.push(root);
  const stage = path.join(root, "stage");
  const marketplace = path.join(root, "marketplace.json");
  const cache = path.join(root, "cache");
  const appId = "asdk_app_privatefixture_do_not_print";
  await mkdir(path.join(stage, ".codex-plugin"), { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(stage, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "mso", version: "0.2.21", apps: "./.app.json" }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(stage, ".app.json"),
    JSON.stringify({ apps: { mso: { id: appId, required: true } } }),
    { mode: 0o600 },
  );
  await chmod(stage, 0o700);
  await chmod(path.join(stage, ".app.json"), 0o600);
  return { root, stage, marketplace, cache, appId };
}

function runDoctor(stage: string, marketplace: string, cache: string) {
  return execFileSync(
    process.execPath,
    [
      path.resolve("scripts/openai-plugin-doctor.mjs"),
      "--stage",
      stage,
      "--marketplace",
      marketplace,
      "--cache",
      cache,
    ],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: process.env,
    },
  );
}

describe("openai-plugin-doctor", () => {
  it("reports staged-only state without exposing the private app id", async () => {
    const { stage, marketplace, cache, appId } = await fixture();
    const stdout = runDoctor(stage, marketplace, cache);
    expect(stdout).toContain("staged=yes");
    expect(stdout).toContain("private-modes=safe");
    expect(stdout).toContain("manifest-link=ok");
    expect(stdout).toContain("binding=present(redacted)");
    expect(stdout).toContain("marketplace-declared=no");
    expect(stdout).toContain("installed-cache=0");
    expect(stdout).toContain("package is staged only");
    expect(stdout).not.toContain(appId);
  });

  it("detects a local marketplace declaration and cached install without printing the binding", async () => {
    const { stage, marketplace, cache, appId } = await fixture();
    await mkdir(path.dirname(marketplace), { recursive: true });
    await writeFile(
      marketplace,
      JSON.stringify({
        name: "personal",
        plugins: [
          {
            name: "mso",
            source: { source: "local", path: "./mso" },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          },
        ],
      }),
    );
    const installed = path.join(cache, "personal", "mso", "local", ".codex-plugin");
    await mkdir(installed, { recursive: true });
    await writeFile(path.join(installed, "plugin.json"), JSON.stringify({ name: "mso", version: "0.2.21" }));

    const stdout = runDoctor(stage, marketplace, cache);
    expect(stdout).toContain("marketplace-declared=yes");
    expect(stdout).toContain("installed-cache=1");
    expect(stdout).toContain("cached MSO plugin install");
    expect(stdout).not.toContain(appId);
  });
});
