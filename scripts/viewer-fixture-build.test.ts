import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";

it("uses the same synthetic viewer origin in local and hosted release builds", () => {
  const expected = "{id}.mso.example.com";
  const local = readFileSync("scripts/verify-build.sh", "utf8");
  expect(local).toContain(`export NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE='${expected}'`);
  const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const build = ci.jobs.verify.steps.find((step: { name?: string }) => step.name === "Production build");
  expect(build.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE).toBe(expected);
  expect(readFileSync("scripts/self-update.sh", "utf8")).not.toContain(expected);
  expect(readFileSync("scripts/ship.sh", "utf8")).not.toContain(expected);
});
