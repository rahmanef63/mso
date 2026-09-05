# MSO Security Assurance

MSO is a browser control plane for a Linux server, so security claims need stronger evidence than ordinary UI tests. This document defines the **repeatable security assurance process** used for MSO. It is evidence, not a certification or a guarantee that vulnerabilities do not exist.

The standing baseline is informed by **OWASP ASVS 5.0.0**. MSO does not claim an ASVS certification or complete ASVS level until every applicable requirement has been independently assessed. OWASP Top 10 coverage is treated as awareness coverage, not as a substitute for ASVS verification.

## Public verification lanes

| Lane | Tool / control | What it verifies | Gate |
|---|---|---|---|
| Application regression | Vitest + production build | Auth, session, device approval, OAuth/PKCE, MCP scopes, filesystem boundaries, SSRF, proxy/origin, race/revocation and other MSO-specific invariants | Tests/build must pass |
| SAST | GitHub CodeQL `security-extended` | JavaScript/TypeScript data-flow and security queries | CodeQL analysis must complete; High/Critical alerts block release review |
| Independent SAST | Semgrep | JavaScript/TypeScript plus OWASP-oriented rules | Findings make the security job fail |
| Dependency CVEs | Bun audit + Google OSV-Scanner | Known vulnerabilities in resolved dependencies / lockfiles | High/Critical Bun advisories or OSV findings fail |
| Repository / IaC / secret scan | Trivy | Vulnerabilities, security misconfiguration and secret patterns in tracked source | High/Critical finding or secret match fails |
| Git history secrets | Gitleaks | Secret patterns across full Git history | Any non-reviewed finding fails |
| Shell safety | ShellCheck | Warning/error-level shell defects in executable scripts | Warning/error finding fails except two documented non-security false-positive classes |
| DAST | OWASP ZAP Baseline | Passive browser-facing scan of the live HTTPS surface | Baseline scan must complete; alert policy is reviewed before promotion |
| AI-assisted code audit | OpenAI Codex Security `scan-components` | Twenty explicit component scans covering the tracked repository, followed by cross-component root-cause matching | Every component and matching must complete; High/Critical groups fail |
| Supply chain | OpenSSF Scorecard | Public repository security posture: pinned dependencies, branch protection, review process and related heuristics | Score is published as external evidence, not self-awarded |
| Managed-app artifact integrity | SHA-256/SHA-512 verification + OCI RepoDigest checks | Hermes release installer/checkout, exact OpenClaw tarball and 9Router multi-arch image are immutable execution identities | Any mismatch fails before installer/package/image execution |
| Public-gateway artifact integrity | Release URL + SHA-256 verification | `cloudflared` Linux binaries are pinned per architecture, cached user-locally, re-hashed before reuse and run with auto-update disabled | Any mismatch fails before tunnel execution |
| Dependency changes | GitHub Dependency Review | Vulnerabilities newly introduced by pull requests | High/Critical introduced dependency fails |
| SBOM | Trivy CycloneDX | Machine-readable component inventory | Generated on Security Core workflow |

All GitHub Actions referenced by the repository are pinned to immutable commit SHAs. Scanner containers used by the reproducible local gate are pinned to image digests. Managed-app release identities are separately recorded in `security/managed-app-artifacts.env`, while the core public-gateway client is recorded in `security/gateway-artifacts.env`; moving tags are never accepted as execution identities.

## GitHub security controls

The public repository enables:

- private vulnerability reporting;
- Dependabot vulnerability alerts and security updates;
- GitHub secret scanning;
- secret scanning push protection;
- CodeQL code scanning;
- Dependency Review for pull requests;
- OpenSSF Scorecard publication.

Controls that GitHub does not make available for the current repository/account are not represented as enabled.

## One-command ultimate gate

From a clean development checkout with Docker and the normal MSO toolchain:

```bash
bun run security:ultimate
```

The command creates a `0700` private run directory under `~/.mso/security-assurance`, snapshots **tracked files only**, and runs the repository verification and a fail-closed `bun run audit:strict` plus Trivy, OSV-Scanner, Gitleaks, Semgrep, ShellCheck, the official Codex Security component scan across the full tracked repository and the passive ZAP baseline. OSV-Scanner is a version-pinned official release binary cached under owner-local MSO state and verified against its pinned SHA-256 before use; the gate does not depend on a mutable/denied GHCR image. Gitleaks mounts the common Git directory so linked worktrees still scan all available refs with merge diffs (`--all --full-history --diff-merges=first-parent`). Detailed scanner output stays outside the repository. A failing scanner produces a failing command; the script does not convert scanner outages into security passes.

Codex Security is intentionally not an automatic per-commit hosted gate because it consumes model/API budget. MSO uses OpenAI's official `scan-components` command because repeated monolithic Standard scans of this repository reached bounded spend limits without producing a terminal coverage result. The committed [`security/codex-components.json`](../security/codex-components.json) plan was generated by the official planner and covers all tracked files through twenty non-overlapping components. The official auto-plan was refined along subsystem boundaries after bounded trial scans proved that its two largest groups were too broad to reach a terminal result within the per-component guard. Each component receives a Standard scan, then Codex Security performs cross-component root-cause matching; incomplete component coverage or incomplete matching fails closed. The default guard is $8 **per component**, with two concurrent workers. MSO pins the component lane to `gpt-5.6-terra` with `high` reasoning because calibration on the security-critical `lib/host` component reached complete terminal coverage under that bounded budget, while `gpt-5.6-sol` at xhigh/medium repeatedly exhausted bounded spend without a terminal coverage result. Model, effort, budget and workers remain explicit overrides through `CODEX_SECURITY_MODEL`, `CODEX_SECURITY_EFFORT`, `CODEX_SECURITY_COMPONENT_MAX_COST_USD` and `CODEX_SECURITY_COMPONENT_WORKERS`. The result gate independently validates `summary.json` and the combined `findings.json`; High/Critical groups fail the run. A maintainer can explicitly skip the lane with `MSO_SECURITY_SKIP_CODEX=1`, but a run with a skipped lane must not be advertised as the full ultimate gate. ZAP is likewise skippable for offline development, but not for a published assurance run.

The final runner message summarizes only the selected lanes; skipped Codex or ZAP lanes never become an unconditional full-assurance PASS. `bun run test:features` likewise labels partially skipped and entirely skipped test groups instead of treating a green process as executed coverage.

## Reviewed Gitleaks fixtures

MSO's redaction unit test intentionally contains six realistic-looking **synthetic** credential fixtures so the redactor can prove it removes secrets. Gitleaks correctly detects those patterns in the historical commit that introduced the test. The repository records six exact finding fingerprints in `.gitleaksignore` and marks the current fixture lines with `gitleaks:allow`.

The exception is intentionally finding-specific. The file and rules are **not** globally allowlisted, so a new secret-like value in that test file still fails the scan and requires review.

## Reviewed ZAP informational alerts

The production baseline keeps five known passive signals visible as `INFO`: cache policy on the public manifest, intentionally non-storable private/auth-shell responses, broad HTTPS sources in `img-src`/`frame-src`, a Unix timestamp in a static bundle, and the deliberate absence of COEP. The CSP exception is a product trade-off: MSO permits user-selected remote images and sandboxed HTTPS embeds, while `connect-src` remains restricted and inbound framing is blocked by CSP `frame-ancestors 'none'` plus `X-Frame-Options: DENY`. COEP would break those supported cross-origin resources.

These are rule-specific classifications in `security/zap-baseline.conf`, not a global warning bypass. Any other ZAP baseline alert remains a warning/failure and makes the gate non-zero.

## Command-guard evidence boundary

The one-shot command guard conservatively refuses recursive deletion with unresolved shell-variable or command-substitution targets. It does not evaluate those expressions or execute a command to inspect its meaning. A literal reviewed target still requires normal authorization and approval. Quoted prose and escaped/literal expansion syntax may be refused too; this is an intentional safety-biased false positive.

This remains a best-effort accident guard, **not a shell sandbox**. Script bodies, aliases, interpreters and dynamically assembled commands are not generally proven safe by a regular expression. The service user's Unix permissions, authentication, device/token scope and approvals remain the trust boundary. The old expected-failure fixture is now a normal passing predicate test; no destructive fixture command is executed.

## ASVS-oriented coverage

The automated suite materially exercises ASVS areas including authentication, session management, authorization, OAuth/MCP access control, validation/sanitization, stored-file/path handling, SSRF/network destinations, security headers/browser policy, logging/redaction, dependency integrity and secure configuration. The historical audit in [`AUDIT-2026-08-24.md`](./AUDIT-2026-08-24.md) documents concrete adversarial reproductions and remediations.

Automation cannot establish every ASVS requirement. Deployment architecture, host hardening, operator practices, recovery procedures, threat modeling and some manual design requirements still need human verification. A self-hosted MSO deployment also inherits risk from the Linux host, reverse proxy, installed managed applications and any third-party AI provider selected by the owner.

## Current OpenSSF posture gaps

OpenSSF Scorecard is deliberately treated as external posture evidence rather than a scanner whose score MSO can self-declare. Two current findings remain open and must not be hidden or dismissed just to make the security tab look green:

- **Code-Review — High.** The repository currently has one human collaborator, so recent changes do not have independent human approvals. Scorecard explicitly does not count bot/AI reviews as human code review. This closes only after a second human maintainer participates in real review history; enabling a one-approval rule without a second reviewer would only lock the repository and would not create legitimate review evidence.
- **CII / OpenSSF Best Practices — Low.** The project is not yet enrolled in the OpenSSF Best Practices program. Enrollment and its questionnaire are maintainer-attested work and must not be faked by adding a badge image without registering the project.

These are repository-process posture findings, not detected application CVEs or leaked secrets. They remain part of the public security evidence.

## What is safe to say publicly

When the latest `main` workflows and the latest full assurance run are green, the project may say:

> MSO is continuously tested with CodeQL, Semgrep, Trivy, OSV-Scanner, Gitleaks, ShellCheck and Dependency Review, with a passive OWASP ZAP production baseline and a separate component-partitioned Codex Security review covering the tracked repository. The public repository has private vulnerability reporting, secret scanning/push protection, dependency alerts, an SBOM workflow and MSO-specific security regression tests. OpenSSF Scorecard is published separately as repository-process posture evidence, and any open Scorecard findings are disclosed rather than folded into a zero-finding claim.

Do **not** claim “no unresolved High/Critical findings across all gates” while a High Scorecard posture finding is open. Also do **not** shorten the evidence into “certified secure”, “OWASP certified”, “penetration-tested by OWASP”, “100% secure”, or “third-party audited”. Those claims are not established by this process.
