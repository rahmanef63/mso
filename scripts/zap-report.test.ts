import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateZapReport } from "./check-zap-report.mjs";

const target = "https://mso.example.com";
const policyText = [
  "10015\tINFO\t(manifest)",
  "10049\tINFO\t(cache policy)",
  "10055\tINFO\t(csp)",
  "10096\tINFO\t(timestamp)",
  "10109\tINFO\t(modern web application)",
  "90004\tINFO\t(cross-origin policy)",
].join("\n");

function report(alerts: unknown[]) {
  return { site: [{ "@name": target, alerts }] };
}

function alert(pluginid: string, uris: string[]) {
  return { pluginid, instances: uris.map(uri => ({ uri, method: "GET" })) };
}

describe("path-scoped ZAP report review", () => {
  it("accepts reviewed immutable SvelteKit cache paths while keeping rule 10050 out of the rule-wide policy", () => {
    const actualPolicy = readFileSync("security/zap-baseline.conf", "utf8");
    expect(actualPolicy).not.toMatch(/^10050\t/m);
    expect(validateZapReport(
      report([
        alert("10055", [target + "/"]),
        alert("10050", [
          target + "/_app/immutable/chunks/CRzLMJPS.js",
          target + "/_app/immutable/entry/start.BFA908N_.js",
          target + "/_app/immutable/nodes/0.VfLFqEeT.js",
          target + "/_app/immutable/assets/AgentGroupApp.D-mrZsgR.css",
          target + "/icon.svg?icon.2nz7bd3koounz.svg",
        ]),
      ]),
      { target, policyText },
    )).toMatchObject({ reviewedCacheInstances: 5, reviewedInfoAlerts: 1 });
  });

  it.each([
    target + "/api/v1/private",
    target + "/login",
    // A static route that 404s is cached by the edge today; only the immutable
    // build output is reviewed, never an arbitrary missing path.
    target + "/robots.txt",
    target + "/_app/immutable/chunks/a.js?token=secret",
    target + "/_app/immutable/chunks/nested/a.js",
    target + "/_app/immutable/assets/font.ttf",
    // The pre-cutover Next.js shapes are dead paths, not a reviewed scope.
    target + "/_next/static/chunks/a.js",
    target + "/icon.svg?token=secret",
    target + "/icon.svg?icon.unexpected.png",
    "https://other.example.com/_app/immutable/chunks/a.js",
  ])("rejects rule 10050 outside the reviewed static-cache boundary: %s", uri => {
    expect(() => validateZapReport(
      report([alert("10050", [uri])]),
      { target, policyText },
    )).toThrow(/10050.*outside the reviewed static-asset scope/);
  });

  it("fails closed for every other unreviewed rule", () => {
    expect(() => validateZapReport(
      report([alert("10054", [target + "/"])]),
      { target, policyText },
    )).toThrow(/unreviewed alert rule: 10054/);
  });

  it("accepts the production report once the baseline headers and 10109 are reviewed", () => {
    // Shape of the real report after the fix: the document and immutable chunks
    // carry the headers, so 10021/10035/10063 are gone; 10109 stays INFO.
    const actualPolicy = readFileSync("security/zap-baseline.conf", "utf8");
    expect(actualPolicy).toMatch(/^10109\tINFO\t/m);
    expect(validateZapReport(
      report([
        alert("10109", [target + "/"]),
        alert("10050", [target + "/_app/immutable/chunks/CRzLMJPS.js"]),
      ]),
      { target, policyText: actualPolicy },
    )).toMatchObject({ reviewedCacheInstances: 1 });
  });
});
