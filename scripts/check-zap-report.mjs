import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireDastTarget } from "./check-dast-target.mjs";

const CACHE_RULE = "10050";
const STATIC_CACHE_PATHS = [
  /^\/_next\/static\/chunks\/[^/?#]+\.js$/,
  /^\/_next\/static\/media\/[^/?#]+\.woff2$/,
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function reviewedInfoRules(policyText) {
  const ids = new Set();
  for (const [index, raw] of policyText.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = raw.split("\t");
    if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) {
      throw new Error("ZAP policy line " + (index + 1) + " is malformed");
    }
    const id = parts[0].trim();
    const action = parts[1].trim().toUpperCase();
    if (action !== "INFO") throw new Error("ZAP policy rule " + id + " must remain INFO");
    if (id === CACHE_RULE) {
      throw new Error("ZAP rule 10050 must be path-scoped by report validation, not rule-wide policy");
    }
    ids.add(id);
  }
  return ids;
}

function safeLocation(url) {
  return url.origin + url.pathname;
}

function reviewedStaticCacheInstance(instance, targetOrigin) {
  if (!instance || typeof instance !== "object") return false;
  if (String(instance.method ?? "GET").toUpperCase() !== "GET") return false;
  let url;
  try {
    url = new URL(String(instance.uri ?? ""));
  } catch {
    return false;
  }
  if (url.origin !== targetOrigin || url.username || url.password || url.search || url.hash) return false;
  return STATIC_CACHE_PATHS.some((pattern) => pattern.test(url.pathname));
}

export function validateZapReport(report, { target, stepOutcome = "success", policyText }) {
  if (stepOutcome !== "success") {
    throw new Error("ZAP scanner step did not complete successfully");
  }
  const approvedTarget = new URL(requireDastTarget(target));
  if (!report || typeof report !== "object") throw new Error("ZAP report is missing or malformed");
  const sites = asArray(report.site);
  if (sites.length === 0) throw new Error("ZAP report contains no scanned site");

  const infoRules = reviewedInfoRules(policyText);
  let sawTarget = false;
  let reviewedCacheInstances = 0;
  let reviewedInfoAlerts = 0;

  for (const site of sites) {
    let siteUrl;
    try {
      siteUrl = new URL(String(site?.["@name"] ?? ""));
    } catch {
      throw new Error("ZAP report contains an invalid site origin");
    }
    if (siteUrl.origin !== approvedTarget.origin) {
      throw new Error("ZAP report contains an unexpected site origin: " + siteUrl.origin);
    }
    sawTarget = true;

    for (const alert of asArray(site?.alerts)) {
      const rule = String(alert?.pluginid ?? alert?.pluginId ?? "");
      if (!rule) throw new Error("ZAP report contains an alert without a rule id");

      if (rule === CACHE_RULE) {
        const instances = asArray(alert?.instances);
        if (instances.length === 0) throw new Error("ZAP rule 10050 has no reviewable instances");
        for (const instance of instances) {
          if (!reviewedStaticCacheInstance(instance, approvedTarget.origin)) {
            let location = "unparseable URL";
            try {
              location = safeLocation(new URL(String(instance?.uri ?? "")));
            } catch {}
            throw new Error("ZAP rule 10050 is outside the reviewed static-asset scope: " + location);
          }
          reviewedCacheInstances += 1;
        }
        continue;
      }

      if (infoRules.has(rule)) {
        reviewedInfoAlerts += 1;
        continue;
      }
      throw new Error("ZAP report contains an unreviewed alert rule: " + rule);
    }
  }

  if (!sawTarget) throw new Error("ZAP report does not contain the approved target");
  return { reviewedCacheInstances, reviewedInfoAlerts, siteCount: sites.length };
}

function main() {
  const reportPath = process.argv[2] || "report_json.json";
  const stepOutcome = process.argv[3] || "success";
  const target = process.env.MSO_DAST_URL;
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const policyText = readFileSync("security/zap-baseline.conf", "utf8");
    const result = validateZapReport(report, { target, stepOutcome, policyText });
    process.stdout.write(
      "ZAP report accepted: " + result.siteCount + " site(s), " +
      result.reviewedInfoAlerts + " reviewed INFO alert group(s), " +
      result.reviewedCacheInstances + " reviewed static-cache instance(s)\n"
    );
  } catch (error) {
    process.stderr.write(
      "ZAP report rejected: " + (error instanceof Error ? error.message : "unknown validation error") + "\n"
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
