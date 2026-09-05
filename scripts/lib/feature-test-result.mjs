// A green process is not proof that any test executed. Keep skipped evidence explicit.
export function classifyFeatureResult(exitCode, result) {
  if (exitCode !== 0 || result.success !== true || !(result.numTotalTests > 0)) return "FAIL";
  if ((result.numFailedTests ?? 0) > 0) return "FAIL";
  if (!(result.numPassedTests > 0)) return "SKIPPED";
  if ((result.numPendingTests ?? 0) + (result.numTodoTests ?? 0) > 0) return "PARTIAL";
  return "PASS";
}
