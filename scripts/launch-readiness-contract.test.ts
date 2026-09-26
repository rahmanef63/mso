import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("launch narrative and readiness SSOT", () => {
  it("defines exactly twenty measurable launch dimensions and blocks score-by-averaging", () => {
    const doc = read("docs/LAUNCH-READINESS.md");
    const rows = [...doc.matchAll(/^\| (\d{1,2}) \|/gm)].map((match) => Number(match[1]));
    expect(rows).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(doc).toContain("Target, not a marketing score");
    expect(doc).toContain("One red P0 gate blocks the stronger launch label");
    expect(doc).toContain("IMPLEMENTED → TESTED → INTEGRATED → RELEASED → VERIFIED-LIVE → OPERATED → HUMAN-VALIDATED");
  });

  it("keeps the product category consistent across README and launch collateral", () => {
    const readme = read("README.md");
    const productHunt = read("docs/PRODUCT_HUNT.md");
    expect(readme).toContain("A self-hosted control plane for AI agents.");
    expect(productHunt).toContain("Self-hosted control plane for AI agents");
    expect(readme).toContain("./docs/QUICKSTART.md");
    expect(readme).toContain("./docs/LAUNCH-READINESS.md");
  });

  it("keeps the first-run tutorial narrow and read-first", () => {
    const quickstart = read("docs/QUICKSTART.md");
    expect(quickstart).toContain("First 10 minutes with MSO");
    expect(quickstart).toContain("Do not change files, branches, services, deployments, credentials or external systems.");
    expect(quickstart).toContain("Never use canonical `main` as a shared agent scratchpad");
  });

  it("states the canonical concurrency boundary for repository agents", () => {
    const rules = read("CLAUDE.md");
    expect(rules).toContain("release/integration surface, not an agent scratchpad");
    expect(rules).toContain("must happen in a task-owned hidden worktree");
    expect(rules).toContain("stop and preserve it rather than stashing, resetting, committing, merging or overwriting");
  });

  it("keeps launch answers honest about recovery and public readiness", () => {
    const qa = read("docs/LAUNCH-QA.md");
    expect(qa).toContain("Not yet as a stable-product claim");
    expect(qa).toContain("Public Alpha / Developer Preview");
    expect(qa).toContain("You should not trust it blindly");
  });

  it("keeps the launch demo on one agent control-plane journey", () => {
    const demo = read("docs/DEMO-SCRIPT.md");
    expect(demo).toContain("3-minute launch demo — one agent job, end to end");
    expect(demo).toContain("Read first, authority stays bounded");
    expect(demo).toContain("task-owned isolated worktree");
    expect(demo).toContain("IMPLEMENTED → TESTED");
    expect(demo).toContain("Self-hosted control plane for AI agents.");
  });
});
