import { afterEach, describe, expect, it } from "vitest";
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  it("loads the app id from the owner-private Integrations store without printing it", async () => {
    const { root, script } = await fixture();
    const privateRoot = await mkdtemp(path.join(os.tmpdir(), "mso-openai-private-"));
    roots.push(privateRoot);
    const store=path.join(privateRoot,"infra-providers.json");
    const appId="asdk_app_privatefixture123";
    await writeFile(store, JSON.stringify({
      version:2, instanceId:"fixture", defaultUser:"alice", bindings:[],
      users:{alice:{id:"alice",uid:"u",label:"Alice",defaults:{"openai-app":"personal"},connections:{"openai-app":{personal:{
        id:"personal",uid:"c",label:"Personal",provider:"openai-app",source:"direct",authMethod:"direct",scope:"account",revision:1,
        values:{appId},createdAt:1,updatedAt:1
      }}}}}
    }), {mode:0o600});
    await chmod(store,0o600);
    const stdout=execFileSync(process.execPath,[script],{cwd:root,encoding:"utf8",env:{...process.env,OS_INFRA_STORE:store}});
    expect(await manifest(root)).toEqual({apps:{mso:{id:appId,required:true}}});
    expect(stdout).not.toContain(appId);
    expect(stdout).toContain("id redacted");
  });

});
