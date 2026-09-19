import { expect } from "@playwright/test";

export async function aiProviderSwitchJourney(page, fixture) {
  await fixture.setAiConfig({
    provider: "google",
    model: "gemini-2.0-flash",
    keys: { google: "synthetic-google-key" },
    oauthTokens: {
      "openai-codex": {
        kind: "oauth",
        access: "synthetic-codex-access",
        refresh: "synthetic-codex-refresh",
        expires: Date.now() + 3_600_000,
      },
    },
  });

  await page.route("**/api/models?provider=google", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          { ref: "google/gemini-2.0-flash", provider: "google", id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", agentReady: true },
          { ref: "google/gemini-2.5-pro", provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", agentReady: true },
        ],
      }),
    });
  });
  await page.route("**/api/models?provider=openai-codex", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          { ref: "openai-codex/gpt-account-model", provider: "openai-codex", id: "gpt-account-model", name: "gpt-account-model", agentReady: true },
        ],
      }),
    });
  });

  await page.goto(fixture.base + "/assistant");
  await expect(page.getByRole("button", { name: "Cockpit", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cockpit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alfa Cockpit", exact: true })).toBeVisible();
  await expect(page.getByLabel("Alfa provider")).toContainText("Google Gemini");
  await expect(page.getByLabel("Alfa model")).toContainText(/Gemini 2\.0 Flash|gemini-2\.0-flash/);

  await page.getByLabel("Alfa provider").click();
  await page.getByRole("option", { name: "OpenAI Codex", exact: true }).click();
  await expect.poll(async () => (await page.evaluate(async () => (await fetch("/api/config", { cache: "no-store" })).json())).provider).toBe("openai-codex");
  await expect(page.getByLabel("Alfa model")).toContainText("gpt-account-model");

  let config = await page.evaluate(async () => (await fetch("/api/config", { cache: "no-store" })).json());
  expect(config.providers).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "google", kind: "builtin", hasKey: true }),
    expect.objectContaining({ id: "openai-codex", kind: "oauth", hasKey: true }),
  ]));

  await page.getByLabel("Alfa provider").click();
  await page.getByRole("option", { name: "Google Gemini", exact: true }).click();
  await expect.poll(async () => (await page.evaluate(async () => (await fetch("/api/config", { cache: "no-store" })).json())).provider).toBe("google");
  config = await page.evaluate(async () => (await fetch("/api/config", { cache: "no-store" })).json());
  expect(config.model).toBe("gemini-2.0-flash");
  expect(config.providers).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "google", hasKey: true }),
    expect.objectContaining({ id: "openai-codex", kind: "oauth", hasKey: true }),
  ]));
  await expect(page.getByLabel("Alfa model")).toContainText(/Gemini 2\.0 Flash|gemini-2\.0-flash/);

  await page.unroute("**/api/models?provider=google");
  await page.unroute("**/api/models?provider=openai-codex");
  console.log("PASS Alfa connected-provider switching: Google Gemini -> Codex -> Google Gemini");
}
