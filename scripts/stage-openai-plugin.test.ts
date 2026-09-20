import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("stage-openai-plugin", () => {
  it("projects official skills into a portable private package and keeps the app id redacted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mso-openai-plugin-stage-"));
    roots.push(root);
    const stage = path.join(root, "stage");
    const store = path.join(root, "infra-providers.json");
    const appId = "asdk_app_privatefixture_do_not_print";
    const sourceSkills = await readdir(path.resolve("claude-skills"), { withFileTypes: true });
    const sourceSkillCount = sourceSkills.filter((entry) => entry.isDirectory()).length;
    await writeFile(
      store,
      JSON.stringify({
        version: 2,
        defaultUser: "rahmanef",
        users: {
          rahmanef: {
            defaults: { "openai-app": "chatgpt-personal" },
            connections: {
              "openai-app": {
                "chatgpt-personal": { values: { appId } },
              },
            },
          },
        },
      }),
      { mode: 0o600 },
    );

    const stdout = execFileSync(process.execPath, [path.resolve("scripts/stage-openai-plugin.mjs")], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        MSO_OPENAI_PLUGIN_STAGE: stage,
        OS_INFRA_STORE: store,
        MSO_OPENAI_APP_USER: "rahmanef",
        MSO_OPENAI_APP_CONNECTION: "chatgpt-personal",
      },
    });

    const portable = JSON.parse(await readFile(path.join(stage, "plugin.json"), "utf8"));
    const compatibility = JSON.parse(await readFile(path.join(stage, ".codex-plugin", "plugin.json"), "utf8"));
    const app = JSON.parse(await readFile(path.join(stage, ".app.json"), "utf8"));

    expect(portable).toMatchObject({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "mso",
      extensions: { "com.openai": { apps: "./.app.json" } },
    });
    expect(compatibility.skills).toBe("./skills/");
    expect(compatibility.apps).toBe("./.app.json");
    expect((await stat(path.join(stage, "skills", "mso-agent-bootstrap", "SKILL.md"))).isFile()).toBe(true);
    expect(app.apps.mso).toMatchObject({ id: appId, required: true });
    expect(stdout).toContain("portable-manifest=ok");
    expect(stdout).toContain("skills=" + sourceSkillCount);
    expect(stdout).toContain("binding=present(redacted)");
    expect(stdout).not.toContain(appId);
  });
});
