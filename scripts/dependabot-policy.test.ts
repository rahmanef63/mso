import fs from "node:fs";
import { parse } from "yaml";
import { expect, it } from "vitest";

type Update = {
  "package-ecosystem": string;
  directory: string;
  cooldown?: { "default-days"?: number };
};

it("keeps every Dependabot ecosystem behind the seven-day version-update cooldown", () => {
  const config = parse(fs.readFileSync(".github/dependabot.yml", "utf8")) as { version: number; updates: Update[] };
  expect(config.version).toBe(2);
  expect(config.updates.length).toBeGreaterThan(0);
  for (const update of config.updates) {
    const label = `${update["package-ecosystem"]}:${update.directory}`;
    const days = update.cooldown?.["default-days"];
    expect(Number.isInteger(days), `${label} must declare cooldown.default-days`).toBe(true);
    expect(days, `${label} must retain the minimum cooldown`).toBeGreaterThanOrEqual(7);
  }
});
