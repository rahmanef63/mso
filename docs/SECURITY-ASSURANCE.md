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
| AI-assisted code audit | OpenAI Codex Security | Repository-wide security review with a High/Critical release threshold | Full repository scan must pass for an assurance run |
| Supply chain | OpenSSF Scorecard | Public repository security posture: pinned dependencies, branch protection, review process and related heuristics | Score is published as external evidence, not self-awarded |
| Dependency changes | GitHub Dependency Review | Vulnerabilities newly introduced by pull requests | High/Critical introduced dependency fails |
| SBOM | Trivy CycloneDX | Machine-readable component inventory | Generated on Security Core workflow |

All GitHub Actions referenced by the repository are pinned to immutable commit SHAs. Scanner containers used by the reproducible local gate are pinned to image digests.

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

The command creates a `0700` private run directory under `~/.mso/security-assurance`, snapshots **tracked files only**, and runs the repository verification plus Trivy, OSV-Scanner, Gitleaks, Semgrep, ShellCheck, a full-repository Codex Security scan and the passive ZAP baseline. Detailed scanner output stays outside the repository. A failing scanner produces a failing command; the script does not convert scanner outages into security passes.

Codex Security is intentionally not an automatic per-commit hosted gate because it consumes model/API budget. The published assurance gate uses Codex Security's stable full-repository `standard` mode. Its default $15 maximum is a fail-closed spending guard sized from an observed full MSO repository run, not a spending target; maintainers may lower or raise it explicitly with `CODEX_SECURITY_MAX_COST_USD`. Deep mode remains available through `MSO_SECURITY_CODEX_MODE=deep`; the wrapper pins OpenAI's conservative deep example (2 discovery workers, 0 nested subagents, stop after 3 no-new runs, at most 10 discovery runs, 1.5-hour discovery ceiling), but a failed deep orchestration is never converted into a pass or advertised as a completed deep review. A maintainer can explicitly skip the Codex lane with `MSO_SECURITY_SKIP_CODEX=1`, but a run with a skipped lane must not be advertised as the full ultimate gate. ZAP is likewise skippable for offline development, but not for a published assurance run.

## Reviewed Gitleaks fixtures

MSO's redaction unit test intentionally contains six realistic-looking **synthetic** credential fixtures so the redactor can prove it removes secrets. Gitleaks correctly detects those patterns in the historical commit that introduced the test. The repository records six exact finding fingerprints in `.gitleaksignore` and marks the current fixture lines with `gitleaks:allow`.

The exception is intentionally finding-specific. The file and rules are **not** globally allowlisted, so a new secret-like value in that test file still fails the scan and requires review.

## Reviewed ZAP informational alerts

The production baseline keeps five known passive signals visible as `INFO`: cache policy on the public manifest, intentionally non-storable private/auth-shell responses, broad HTTPS sources in `img-src`/`frame-src`, a Unix timestamp in a static bundle, and the deliberate absence of COEP. The CSP exception is a product trade-off: MSO permits user-selected remote images and sandboxed HTTPS embeds, while `connect-src` remains restricted and inbound framing is blocked by CSP `frame-ancestors 'none'` plus `X-Frame-Options: DENY`. COEP would break those supported cross-origin resources.

These are rule-specific classifications in `security/zap-baseline.conf`, not a global warning bypass. Any other ZAP baseline alert remains a warning/failure and makes the gate non-zero.

## ASVS-oriented coverage

The automated suite materially exercises ASVS areas including authentication, session management, authorization, OAuth/MCP access control, validation/sanitization, stored-file/path handling, SSRF/network destinations, security headers/browser policy, logging/redaction, dependency integrity and secure configuration. The historical audit in [`AUDIT-2026-08-24.md`](./AUDIT-2026-08-24.md) documents concrete adversarial reproductions and remediations.

Automation cannot establish every ASVS requirement. Deployment architecture, host hardening, operator practices, recovery procedures, threat modeling and some manual design requirements still need human verification. A self-hosted MSO deployment also inherits risk from the Linux host, reverse proxy, installed managed applications and any third-party AI provider selected by the owner.

## What is safe to say publicly

When the latest `main` workflows and the latest full assurance run are green, the project may say:

> MSO is continuously tested with CodeQL, Semgrep, Trivy, OSV-Scanner, Gitleaks, ShellCheck, Dependency Review and OpenSSF Scorecard, with a passive OWASP ZAP production baseline and a separate full-repository Codex Security review. The public repository has private vulnerability reporting, secret scanning/push protection, dependency alerts, an SBOM workflow and MSO-specific security regression tests. The latest published assurance run has no known unresolved High/Critical findings from those gates.

Do **not** shorten this into “certified secure”, “OWASP certified”, “penetration-tested by OWASP”, “100% secure”, or “third-party audited”. Those claims are not established by this process.
