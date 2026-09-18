import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateZapReport } from "./check-zap-report.mjs";

const target = "https://mso.example.com";
const policyText = [
  "10015\tINFO\t(manifest)",
  "10049\tINFO\t(cache policy)",
  "10055\tINFO\t(csp)",
  "10096\tINFO\t(timestamp)",
  "90004\tINFO\t(cross-origin policy)",
].join("\n");

function report(alerts: unknown[]) {
  return { site: [{ "@name": target, alerts }] };
}

function alert(pluginid: string, uris: string[]) {
  return { pluginid, instances: uris.map(uri => ({ uri, method: "GET" })) };
}

describe("path-scoped ZAP report review", () => {
  it("accepts reviewed immutable Next.js cache paths while keeping rule 10050 out of the rule-wide policy", () => {
    const actualPolicy = readFileSync("security/zap-baseline.conf", "utf8");
    expect(actualPolicy).not.toMatch(/^10050\t/m);
    expect(validateZapReport(
      report([
        alert("10055", [target + "/"]),
        alert("10050", [
          target + "/_next/static/chunks/abc-123.js",
          target + "/_next/static/media/Geist_Variable-s.p.hash.woff2",
        ]),
      ]),
      { target, policyText },
    )).toMatchObject({ reviewedCacheInstances: 2, reviewedInfoAlerts: 1 });
  });

  it.each([
    target + "/api/v1/private",
    target + "/login",
    target + "/_next/static/chunks/a.js?token=secret",
    target + "/_next/static/media/font.ttf",
    "https://other.example.com/_next/static/chunks/a.js",
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

  it("fails closed when scanner action failed or report is incomplete", () => {
    expect(() => validateZapReport(report([]), { target, policyText, stepOutcome: "failure" })).toThrow(/did not complete/);
    expect(() => validateZapReport({ site: [] }, { target, policyText })).toThrow(/no scanned site/);
    expect(() => validateZapReport(report([{ pluginid: "10050", instances: [] }]), { target, policyText })).toThrow(/no reviewable instances/);
  });

  it("refuses to put rule 10050 back into the rule-wide policy", () => {
    expect(() => validateZapReport(
      report([]),
      { target, policyText: policyText + "\n10050\tINFO\t(too broad)" },
    )).toThrow(/10050 must be path-scoped/);
  });
});
