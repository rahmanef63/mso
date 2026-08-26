#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LEVELS = ["critical", "high", "medium", "low", "informational"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function wholeNumber(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function evaluateComponentResults(summary, findingsDocument, threshold = "high") {
  const thresholdIndex = LEVELS.indexOf(threshold);
  if (thresholdIndex < 0 || threshold === "informational") {
    return { exitCode: 2, message: "Codex Security component gate has an invalid severity threshold." };
  }

  if (!isRecord(summary)) {
    return { exitCode: 2, message: "Codex Security component summary is malformed." };
  }

  const total = summary.total;
  const completed = summary.completed;
  const incomplete = summary.incomplete;
  const failed = summary.failed;
  const deduplication = summary.deduplication;
  if (
    !wholeNumber(total) || total === 0 ||
    !wholeNumber(completed) || !wholeNumber(incomplete) || !wholeNumber(failed) ||
    !isRecord(deduplication) || typeof deduplication.status !== "string"
  ) {
    return { exitCode: 2, message: "Codex Security component summary has invalid counters." };
  }

  const complete =
    summary.completeness === "complete" &&
    completed === total &&
    incomplete === 0 &&
    failed === 0 &&
    deduplication.status === "completed";
  if (!complete) {
    return {
      exitCode: 2,
      message: `Codex Security component coverage is incomplete (${completed}/${total} complete, ${incomplete} incomplete, ${failed} failed).`,
    };
  }

  if (
    !isRecord(findingsDocument) ||
    findingsDocument.documentType !== "codex-security.component-findings" ||
    findingsDocument.schemaVersion !== "1.0" ||
    !Array.isArray(findingsDocument.findings)
  ) {
    return { exitCode: 2, message: "Codex Security combined findings are malformed." };
  }

  const counts = Object.fromEntries(LEVELS.map((level) => [level, 0]));
  for (const group of findingsDocument.findings) {
    const level = isRecord(group) && isRecord(group.finding) && isRecord(group.finding.severity)
      ? group.finding.severity.level
      : undefined;
    if (typeof level !== "string" || !Object.hasOwn(counts, level)) {
      return { exitCode: 2, message: "Codex Security returned a finding with an unknown severity." };
    }
    counts[level] += 1;
  }

  const blockers = LEVELS
    .slice(0, thresholdIndex + 1)
    .reduce((totalCount, level) => totalCount + counts[level], 0);
  const mix = LEVELS
    .filter((level) => counts[level] > 0)
    .map((level) => `${level}=${counts[level]}`)
    .join(", ") || "none";

  if (blockers > 0) {
    return {
      exitCode: 1,
      message: `Codex Security found ${blockers} finding group(s) at or above ${threshold}; severity mix: ${mix}.`,
    };
  }

  return {
    exitCode: 0,
    message: `Codex Security components passed: ${completed}/${total} complete; severity mix: ${mix}; 0 at or above ${threshold}.`,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(argv) {
  if (argv.length < 2 || argv.length > 3) {
    console.error("Usage: check-codex-component-results.mjs <summary.json> <findings.json> [threshold]");
    return 2;
  }
  try {
    const result = evaluateComponentResults(readJson(argv[0]), readJson(argv[1]), argv[2] ?? "high");
    (result.exitCode === 0 ? console.log : console.error)(result.message);
    return result.exitCode;
  } catch {
    console.error("Codex Security result artifacts could not be read or parsed.");
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
