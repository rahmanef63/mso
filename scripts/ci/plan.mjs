/** Repository-owned CI policy; no webhook/PR-supplied commands. */
const step = (id, command, args, timeoutMs) => ({ id, command, args, timeoutMs });

// Image digests are copied verbatim from .github/workflows/security-core.yml. Pinning by digest
// rather than tag is the whole point: a tag can be repointed, and then the local check and CI would
// be running different scanners while both claim to be "the security scan".
const SEMGREP_IMAGE = 'semgrep/semgrep@sha256:f1f7b71861c7b28b6e0f661225a2c4f58a484f5d0f182465c6d6b3b22f972ade';
const GITLEAKS_IMAGE = 'zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';
const OSV_IMAGE = 'ghcr.io/google/osv-scanner@sha256:8108ae94eadea5a02c9bec6e646909d5b790b44bd62d7f5b7f0b1d6d0ffc7734';

const verify = [
  step('native-module', 'node', ['-e', "require('node-pty')"], 30_000),
  step('installer-bootstrap', 'bash', ['-n', 'scripts/install.sh'], 30_000),
  step('installer-core', 'bash', ['-n', 'scripts/install-core.sh'], 30_000),
  step('repository-gates', 'bash', ['scripts/gates.sh'], 30 * 60_000),
];

// Three lanes below have been run by hand against this repository with these exact digests, so they
// execute instead of reporting BLOCKED. The excludes on semgrep matter: CI scans a clean checkout,
// while a working tree also holds node_modules, .next and coverage, and scanning those reports
// findings in third-party code that CI never sees (7 findings versus 0 when measured here).
const security = [
  step('semgrep', 'docker', ['run', '--rm', '-v', './:/src:ro', SEMGREP_IMAGE,
    'semgrep', 'scan', '--metrics=off',
    '--config=p/javascript', '--config=p/typescript', '--config=p/owasp-top-ten',
    '--strict', '--error',
    '--exclude=node_modules', '--exclude=.next', '--exclude=coverage', '/src'], 20 * 60_000),
  step('gitleaks', 'docker', ['run', '--rm', '-v', './:/repo', GITLEAKS_IMAGE,
    'git', '--gitleaks-ignore-path', '/repo/.gitleaksignore', '/repo'], 20 * 60_000),
  step('osv', 'docker', ['run', '--rm', '-v', './:/src:ro', OSV_IMAGE,
    'scan', 'source', '--recursive', '/src'], 20 * 60_000),
  { id: 'codeql', blocked: 'Local CodeQL bundle, security-extended analysis and exact-SHA SARIF adapter are not yet provisioned.' },
  { id: 'trivy', blocked: 'Pinned Trivy filesystem scan and CycloneDX SBOM adapter are not yet verified.' },
  { id: 'shellcheck', blocked: 'Pinned ShellCheck adapter is not yet verified.' },
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

// Docker bind mounts need an absolute source path, and `./:/src` silently resolves against whatever
// directory the CLI happens to inherit. Rewriting the mount against the resolved repo root makes it
// explicit, and it is what lets the runner refuse to scan a tree other than the one it verified.
export function anchorMounts(steps, repoRoot) {
  return steps.map((s) => {
    if (!Array.isArray(s.args)) return s;
    const args = s.args.map((arg) => (arg === './:/src:ro' ? `${repoRoot}:/src:ro` : arg === './:/repo' ? `${repoRoot}:/repo` : arg));
    return { ...s, args };
  });
}

export function verdict(steps) {
  if (steps.some((s) => s.status === 'FAIL')) return 'FAIL';
  if (!steps.length || steps.some((s) => s.status !== 'PASS')) return 'BLOCKED';
  return 'PASS';
}
export function exitFor(status) { return status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2; }
