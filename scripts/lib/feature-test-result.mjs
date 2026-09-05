// A green process is not proof that any test executed. Keep skipped evidence explicit.
export function classifyFeatureResult(exitCode, result) {
  if (exitCode !== 0 || result.success !== true || !(result.numTotalTests > 0)) return "FAIL";
  if ((result.numFailedTests ?? 0) > 0) return "FAIL";
  if (!(result.numPassedTests > 0)) return "SKIPPED";
  if ((result.numPendingTests ?? 0) + (result.numTodoTests ?? 0) > 0) return "PARTIAL";
  return "PASS";
}

// CLI filters are substrings. Require every exact inventory file once, and no extras.
export function featureSelectionMatches(expected, results) {
  if (!Array.isArray(results)) return false;
  const names = results.map((result) => result.name);
  return names.length === expected.length && new Set(names).size === expected.length
    && names.every((name) => expected.includes(name));
}
