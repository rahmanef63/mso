import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamAssistant } from "../src/lib/assistant/assistant-api.ts";
import {
  deleteThreadRecord,
  listAgentProfiles,
  listAgentSessions,
  listAgentTools,
  listThreads,
  loadThreadById,
  readCockpitSnapshot,
  renameThreadRecord,
  runSavedProfile,
  saveThreadRecord,
} from "../src/lib/assistant/assistant-cockpit-api.ts";
import { createAssistantController, type AssistantState } from "../src/lib/assistant/assistant-controller.ts";
import { formatRelativeTime } from "../src/lib/assistant/assistant-presets.ts";
import { isSafeHttpUrl, parseInline, parseMarkdown } from "../src/lib/assistant/markdown-blocks.ts";
import { createCockpitFetcher, createControllerFetcher, signal, sse } from "./assistant-refactor-fixtures.ts";

test("parseMarkdown handles headings, lists, inline code, fenced blocks, blockquotes, and safe links", () => {
  const md = [
    "# Host Summary",
    "Check `mso.service` and **CPU** usage (*nominal*) via [Docs](https://example.com/docs) or [Bad](javascript:alert(1)).",
    "- First item with `df -h`",
    "- Second item",
    "1. Step one",
    "2. Step two",
    "> Quoted note",
    "```bash",
    "systemctl status mso.service",
    "```",
  ].join("\n");

  const blocks = parseMarkdown(md);
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[1].kind, "paragraph");
  if (blocks[1].kind === "paragraph") {
    assert.ok(blocks[1].segments.some((s) => s.kind === "code" && s.text === "mso.service"));
    assert.ok(blocks[1].segments.some((s) => s.kind === "strong" && s.text === "CPU"));
    assert.ok(blocks[1].segments.some((s) => s.kind === "em" && s.text === "nominal"));
    assert.ok(blocks[1].segments.some((s) => s.kind === "link" && s.href === "https://example.com/docs"));
    // Assert the real invariant: no rendered link may use a scheme outside the
    // http/https allowlist. Checking a single "javascript:" prefix is exactly the
    // CodeQL js/incomplete-url-scheme-check shape, because it misses vbscript:,
    // data:, file: and any other scheme the sanitizer rejects.
    for (const segment of blocks[1].segments) {
      if (segment.kind !== "link") continue;
      assert.equal(isSafeHttpUrl(segment.href), true, `rendered link used a non-http scheme: ${segment.href}`);
    }
  }
  assert.equal(blocks[2].kind, "list");
  assert.equal(blocks[3].kind, "list");
  assert.equal(blocks[4].kind, "blockquote");
  assert.deepEqual(blocks[5], { kind: "code", lang: "bash", code: "systemctl status mso.service" });

  // Unclosed fence while streaming still parses cleanly.
  const partial = parseMarkdown("```ts\nconst x = 1;");
  assert.deepEqual(partial, [{ kind: "code", lang: "ts", code: "const x = 1;" }]);

  assert.equal(isSafeHttpUrl("https://mso.example/a"), true);
  assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHttpUrl("data:text/html,hi"), false);
  assert.equal(parseInline("").length, 0);
});

test("streamAssistant surfaces tool_use SSE events alongside text and reasoning", async () => {
  const seenTools: Array<{ id: string; name: string; input?: unknown }> = [];
  const texts: string[] = [];
  await streamAssistant(
    { messages: [{ role: "user", text: "Check stats" }] },
    {
      onText: (c) => texts.push(c),
      onToolUse: (t) => seenTools.push(t),
    },
    signal,
    async () => sse([
      'event: tool_use\ndata: {"id":"tu_1","name":"vps_status","input":{"brief":true}}\n\n',
      'event: delta\ndata: "All green"\n\n',
      'event: done\ndata: {"stopReason":"end_turn"}\n\n',
    ]),
  );
  assert.deepEqual(seenTools, [{ id: "tu_1", name: "vps_status", input: { brief: true } }]);
  assert.equal(texts.join(""), "All green");
});

test("cockpit API helpers parse live endpoints and degrade gracefully on 403/404/demo", async () => {
  const liveFetcher = createCockpitFetcher();

  const threadsRes = await listThreads(signal, liveFetcher);
  assert.equal(threadsRes.status, "ready");
  assert.equal(threadsRes.threads.length, 1);

  const loaded = await loadThreadById("t1", signal, liveFetcher);
  assert.equal(loaded?.messages[0].text, "hi");
  assert.equal(await saveThreadRecord({ id: "t1", title: "x", createdAt: 1, messages: [], history: [] }, signal, liveFetcher), true);
  assert.equal((await renameThreadRecord("t1", "Renamed", signal, liveFetcher))?.title, "Renamed");
  assert.equal(await deleteThreadRecord("t1", signal, liveFetcher), true);

  const profRes = await listAgentProfiles(signal, liveFetcher);
  assert.equal(profRes.status, "ready");
  assert.equal(profRes.profiles[0].isDefault, true);

  const runRes = await runSavedProfile({ profileId: "p1", profileRevision: 2, prompt: "Check host" }, signal, liveFetcher);
  assert.equal(runRes.text, "Host healthy");
  assert.equal(runRes.toolCalls[0].name, "vps_status");

  const toolsRes = await listAgentTools(signal, liveFetcher);
  assert.equal(toolsRes.status, "ready");
  assert.equal(toolsRes.tools[0].name, "vps_status");

  const sessRes = await listAgentSessions(signal, liveFetcher);
  assert.equal(sessRes.status, "ready");
  assert.equal(sessRes.sessions[0].title, "CLI run");

  const cockpitRes = await readCockpitSnapshot(signal, liveFetcher);
  assert.equal(cockpitRes.snapshot?.projectCount, 3);

  // Restricted (403) and offline demo stub degrade cleanly without throwing.
  const restricted = await listAgentTools(signal, async () => Response.json({ error: "owner_role_required" }, { status: 403 }));
  assert.equal(restricted.status, "restricted");
  assert.equal(restricted.tools.length, 0);

  const demoStub = await listThreads(signal, async () => Response.json({ ok: true, demo: true }));
  assert.equal(demoStub.status, "offline");
  assert.equal(demoStub.threads.length, 0);
});

test("controller manages threads, profiles, playbooks, liveActivity, and offline fallback", async () => {
  const states: AssistantState[] = [];
  const { fetcher, savedBodies, deletedUrls, assistantBodies } = createControllerFetcher();

  const ctrl = createAssistantController((s) => states.push(s), { fetcher });
  await ctrl.loadWorkspace();
  assert.equal(ctrl.getState().threadsStatus, "ready");
  assert.equal(ctrl.getState().profiles.length, 1);

  ctrl.selectPlaybook("pb_sysadmin");
  await ctrl.sendMessage("Check disk");
  assert.ok(String(assistantBodies[0].system ?? "").includes("Linux host diagnostics"));
  assert.equal(ctrl.getState().messages[1].toolCalls?.[0].name, "fs_list");
  assert.equal(ctrl.getState().liveActivity?.state, "done");
  assert.equal(ctrl.getState().threads.length, 1);
  assert.equal(savedBodies.length, 1);

  const threadId = ctrl.getState().activeThreadId!;
  await ctrl.renameThread(threadId, "Disk audit");
  assert.equal(ctrl.getState().activeThreadTitle, "Disk audit");

  // Switch to saved profile mode (clears playbook) and run profile task.
  ctrl.selectProfile("p1");
  assert.equal(ctrl.getState().activePlaybookId, null);
  await ctrl.sendMessage("Run read audit");
  const lastMsg = ctrl.getState().messages.at(-1);
  assert.equal(lastMsg?.profileName, "Audit Bot");
  assert.equal(lastMsg?.text, "Profile check passed.");

  await ctrl.deleteThread(threadId);
  assert.equal(ctrl.getState().messages.length, 0);
  assert.equal(ctrl.getState().activeThreadId, null);
  assert.equal(deletedUrls.length, 1);
  assert.ok(states.length > 0);
  ctrl.dispose();
});

test("formatRelativeTime formats relative intervals deterministically", () => {
  const now = 1_700_000_000_000;
  assert.equal(formatRelativeTime(now - 10_000, now), "just now");
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), "5m ago");
  assert.equal(formatRelativeTime(now - 3 * 3600_000, now), "3h ago");
  assert.equal(formatRelativeTime(now - 2 * 86_400_000, now), "2d ago");
  assert.equal(formatRelativeTime(undefined, now), "");
});

test("assistant slice enforces zero {@html}, zero browser dialogs, zero localStorage, zero em dash, and <= 400 char lines", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(here, "../src/lib/assistant");
  const files = readdirSync(dir).filter((f) => /\.(ts|svelte)$/.test(f));
  assert.ok(files.length >= 6);
  for (const file of files) {
    const content = readFileSync(path.join(dir, file), "utf8");
    assert.ok(!content.includes("{@html"), `${file} must not use {@html}`);
    assert.ok(!/\bwindow\.(confirm|alert|prompt)\s*\(/.test(content), `${file} must not call browser dialogs`);
    assert.ok(!/\b(localStorage|sessionStorage)\./.test(content), `${file} must not access Web Storage`);
    assert.ok(!content.includes("\u2014"), `${file} must not contain em dash U+2014`);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      assert.ok(lines[i].length <= 400, `${file}:${i + 1} exceeds 400 chars`);
    }
  }
});
