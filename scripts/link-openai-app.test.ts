import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mso-openai-app-"));
  roots.push(root);
  const scripts = path.join(root, "scripts");
  await mkdir(scripts, { recursive: true });
  const source = path.resolve("scripts/link-openai-app.mjs");
  const target = path.join(scripts, "link-openai-app.mjs");
  await copyFile(source, target);
  return { root, script: target };
}

async function manifest(root: string) {
  return JSON.parse(await readFile(path.join(root, ".app.json"), "utf8"));
}

describe("link-openai-app", () => {
  it.each([
    ["asdk_app_example-1", "asdk_app_example-1"],
    ["connector_openai_plugin_management", "connector_openai_plugin_management"],
    ["templated_apps_example_connector-v2", "templated_apps_example_connector-v2"],
    ["plugin_asdk_app_example_2", "asdk_app_example_2"],
  ])("writes canonical binding for %s", async (input, expected) => {
    const { root, script } = await fixture();
    execFileSync(process.execPath, [script, input], { encoding: "utf8" });
    expect(await manifest(root)).toEqual({ apps: { mso: { id: expected, required: true } } });
  });

  it("clears the binding without changing live authorization", async () => {
    const { root, script } = await fixture();
    execFileSync(process.execPath, [script, "asdk_app_example"], { encoding: "utf8" });
    execFileSync(process.execPath, [script, "--clear"], { encoding: "utf8" });
    expect(await manifest(root)).toEqual({ apps: {} });
  });

  it.each(["plugin_connector_bad", "asdk_app_", "https://example.com/app", "REPLACE_WITH_APP_ID"])(
    "rejects malformed or placeholder id %s",
    async (input) => {
      const { script } = await fixture();
      expect(() => execFileSync(process.execPath, [script, input], { encoding: "utf8", stdio: "pipe" })).toThrow();
    },
  );
});
