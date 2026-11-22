import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AppDeckStepper, parseAppDeckSteps } from "./appdeck-stepper";
import { JobPanel } from "./job-panel";
import { IDLE_JOB, type JobState } from "./update-machine";

const sampleJob = (overrides: Partial<JobState>): JobState => ({
  ...IDLE_JOB,
  phase: "running",
  kind: "update",
  jobId: "abcdef0123456789abcdef01",
  ...overrides,
});

describe("AppDeck non-tech progress stepper and job panel", () => {
  it("maps update log milestones cleanly into 4 human-readable stages", () => {
    const mid = parseAppDeckSteps(
      "update",
      "[appdeck] step=quiesce Paused n8n\n[appdeck] step=backup Creating pre-update backup\n[appdeck] step=apply Starting n8n\n",
      "running",
    );
    expect(mid.map((s) => s.status)).toEqual(["done", "done", "active", "pending"]);

    const done = parseAppDeckSteps("update", "anything", "succeeded");
    expect(done.every((s) => s.status === "done")).toBe(true);

    const failed = parseAppDeckSteps("update", "[appdeck] step=backup Creating pre-update backup\n", "failed");
    expect(failed.map((s) => s.status)).toEqual(["done", "failed", "pending", "pending"]);
  });

  it("maps install and uninstall flows to tailored non-tech labels", () => {
    const installSteps = parseAppDeckSteps("install", "[appdeck] step=health waiting\n", "running");
    expect(installSteps[0]?.label).toBe("Verify package");
    expect(installSteps[2]?.status).toBe("active");

    const uninstallSteps = parseAppDeckSteps("uninstall", "[appdeck] step=backup saving\n", "running");
    expect(uninstallSteps[2]?.label).toBe("Remove runtime");
    expect(uninstallSteps[1]?.status).toBe("active");
  });

  it("renders the stepper and tucks raw logs inside a collapsible Technical output disclosure", () => {
    const runningHtml = renderToStaticMarkup(
      <JobPanel job={sampleJob({ log: "[appdeck] step=apply Pulling image\n" })} onDismiss={() => {}} />,
    );
    expect(runningHtml).toContain("AppDeck progress");
    expect(runningHtml).toContain("Technical output");
    expect(runningHtml).not.toContain("<details open");

    const failedHtml = renderToStaticMarkup(
      <JobPanel job={sampleJob({ phase: "failed", error: "pull failed", log: "timeout\n" })} onDismiss={() => {}} />,
    );
    expect(failedHtml).toContain("Technical output");
    expect(failedHtml).toContain("open=\"\"");
  });

  it("keeps all AppDeck UI files free of em dashes (antislop R-02)", () => {
    const dir = path.join(process.cwd(), "frontend", "slices", "managed-apps");
    for (const file of ["appdeck-preflight-card.tsx", "appdeck-stepper.tsx", "install-panel.tsx", "uninstall-panel.tsx", "job-panel.tsx"]) {
      const content = readFileSync(path.join(dir, file), "utf8");
      expect(content, `${file} must not contain U+2014 em dash`).not.toContain("\u2014");
    }
  });

  it("renders AppDeckStepper directly without client hooks", () => {
    const html = renderToStaticMarkup(<AppDeckStepper job={sampleJob({ phase: "succeeded" })} />);
    expect(html).toContain("1. Pause safely");
    expect(html).toContain("4. Restart &amp; verify");
  });
});
