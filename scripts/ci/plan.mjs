/** Repository-owned CI policy; no webhook/PR-supplied commands. */
const step = (id, command, args, timeoutMs) => ({ id, command, args, timeoutMs });
const verify = [
  step('native-module', 'node', ['-e', "require('node-pty')"], 30_000),
  step('installer-bootstrap', 'bash', ['-n', 'scripts/install.sh'], 30_000),
  step('installer-core', 'bash', ['-n', 'scripts/install-core.sh'], 30_000),
  step('repository-gates', 'bash', ['scripts/gates.sh'], 30 * 60_000),
];
const security = [
  { id: 'codeql', blocked: 'Local CodeQL bundle, security-extended analysis and exact-SHA SARIF adapter are not yet provisioned.' },
  { id: 'security-core', blocked: 'Pinned Trivy/OSV/Gitleaks/Semgrep/ShellCheck adapter needs standalone end-to-end verification; preserve scripts/security-ultimate.sh.' },
  { id: 'dependency-review', blocked: 'Base/head dependency-change review adapter is not yet verified.' },
  { id: 'security-inventory', blocked: 'Exact-SHA SARIF upload/read-back through the authorized GitHub connection is not yet verified.' },
  { id: 'scorecard', blocked: 'Standalone OpenSSF Scorecard adapter is not yet verified.' },
  { id: 'dast', blocked: 'Explicit isolated staging target and ZAP evidence adapter are not yet verified.' },
];
export const profiles = Object.freeze(['verify', 'security', 'release']);
export function planFor(profile) {
  if (!profiles.includes(profile)) throw new Error('Profile must be verify, security, or release');
  return structuredClone(profile === 'verify' ? verify : profile === 'security' ? security : [...verify, ...security]);
}
export function verdict(steps) {
  if (steps.some((s) => s.status === 'FAIL')) return 'FAIL';
  if (!steps.length || steps.some((s) => s.status !== 'PASS')) return 'BLOCKED';
  return 'PASS';
}
export function exitFor(status) { return status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2; }
