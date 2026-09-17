// Store/Settings browser contract, using the release fixture and real bounded host APIs.
import { expect } from "@playwright/test";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";

async function capture(page, name) {
  if (!process.env.MSO_SCREENSHOT_DIR) return;
  await mkdir(process.env.MSO_SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(process.env.MSO_SCREENSHOT_DIR, name + ".png");
  await page.screenshot({ path: file, animations: "disabled" }); await chmod(file, 0o600);
}
async function select(page, label) {
  await page.getByRole("tablist", { name: "Store categories" }).getByRole("tab", { name: label, exact: true }).click();
}
async function card(page, name) {
  const article = page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(article).toBeVisible(); return article;
}
async function acceptedClick(page, button) {
  await expect(button).toBeEnabled(); page.once("dialog", dialog => dialog.accept()); await button.click();
}
export async function storeExtensionsJourney(page, fixture) {
  const errors = [];
  const onError = error => errors.push(error.message); page.on("pageerror", onError);
  await page.goto(fixture.base + "/store");
  const tabs = page.getByRole("tablist", { name: "Store categories" });
  await expect(tabs).toBeVisible();
  for (const name of ["Apps", "MCP", "Skills"]) await expect(tabs.getByRole("tab", { name, exact: true })).toBeVisible();
  await select(page, "MCP");
  await expect(page.getByText("No MCP installed on this target.", { exact: true })).toBeVisible();
  const available = await card(page, "SI-Coder");
  await acceptedClick(page, available.getByRole("button", { name: "Install", exact: true }));
  const installed = await card(page, "si-coder");
  await expect(installed.getByRole("button", { name: "Uninstall", exact: true })).toBeEnabled();
  const manifest = path.join(fixture.dir, ".mso-host-mcp/.mcp.json");
  expect(JSON.parse(await readFile(manifest, "utf8")).mcpServers["si-coder"].plugin).toBe("si-coder");
  await acceptedClick(page, installed.getByRole("button", { name: "Uninstall", exact: true }));
  await expect(page.getByText("No MCP installed on this target.", { exact: true })).toBeVisible();
  expect(JSON.parse(await readFile(manifest, "utf8")).mcpServers["si-coder"]).toBeUndefined();
  // A locally provisioned synthetic stdio plugin exercises real dynamic discovery without a provider account.
  const script = path.join(fixture.dir, ".mso-host-mcp/fixture.mjs");
  await writeFile(script, `import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(!m.id)return;const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{tools:[{name:'fixture_read',inputSchema:{type:'object',properties:{}}}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')});`);
  await writeFile(manifest, JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [script] } } }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const dynamic = await card(page, "fixture");
  await dynamic.getByRole("button", { name: "Check tools", exact: true }).click();
  await expect(dynamic.getByText("fixture_read", { exact: true })).toBeVisible();
  await expect(dynamic.getByText(/Tool discovery verified/)).toBeVisible();
  await capture(page, "store-mcp-desktop");
  await select(page, "Skills");
  const ponytail = await card(page, "Ponytail");
  await acceptedClick(page, ponytail.getByRole("button", { name: "Install", exact: true }));
  await expect(ponytail.getByRole("button", { name: "Uninstall", exact: true })).toBeEnabled();
  const file = path.join(fixture.dir, "skills/ponytail/SKILL.md");
  expect(await readFile(file, "utf8")).toContain("name: ponytail");
  await capture(page, "store-skills-desktop");
  await page.reload(); await select(page, "Skills");
  const persisted = await card(page, "Ponytail");
  await expect(persisted.getByRole("button", { name: "Uninstall", exact: true })).toBeEnabled();
  await acceptedClick(page, persisted.getByRole("button", { name: "Uninstall", exact: true }));
  await expect(persisted.getByRole("button", { name: "Install", exact: true })).toBeEnabled();
  await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1363, height: 936 }]) {
    await page.setViewportSize(viewport); await page.goto(fixture.base + "/store");
    for (const tab of ["MCP", "Skills"]) {
      await select(page, tab); await expect(page.getByRole("heading", { name: tab === "MCP" ? "MCP on this VPS" : "Skills on this VPS", exact: true })).toBeVisible();
      const ready = await card(page, tab === "MCP" ? "fixture" : "Ponytail");
      await expect(ready.getByRole("button", { name: tab === "MCP" ? "Check tools" : "Install", exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (viewport.width === 390) await capture(page, `store-${tab.toLowerCase()}-mobile`);
      const result = await new AxeBuilder({ page }).include('[role="tabpanel"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    }
  }
  await page.goto(fixture.base + "/settings");
  const sections = page.getByRole("button", { name: "Settings sections", exact: true });
  if (await sections.isVisible()) await sections.click();
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await page.getByRole("tab", { name: /MSO to External/ }).click();
  await expect(page.getByRole("tablist", { name: "Installed extensions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "fixture", exact: true })).toBeVisible();
  await page.getByRole("tablist", { name: "Installed extensions" }).getByRole("tab", { name: "Skills", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Skills on this VPS", exact: true })).toBeVisible();
  expect(errors).toEqual([]); page.off("pageerror", onError);
  console.log("PASS Store MCP/Skills: real file install/remove, reload persistence, dynamic tool discovery, shared Settings, responsive layout and accessibility");
}
