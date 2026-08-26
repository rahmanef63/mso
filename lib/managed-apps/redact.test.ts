// Two directions, and the second one matters as much as the first: this runs
// over every line of a stored, operator-visible update transcript AND over the
// journald tail the logs route serves, so a rule that eats ordinary npm/pip/git
// output would blind the operator to what an update just did.
import { describe, expect, it } from "vitest";

import { redact } from "./redact";

/** Assembled from the shapes actually seen in `hermes update` / `openclaw
 *  update` output, plus the two journald formats getManagedAppLogs asks for. */
const TRANSCRIPT = [
  "[mso] pre-update backup of /home/rahman/.hermes",
  "npm WARN deprecated inflight@1.0.6: This module is not supported",
  "npm notice New major version of npm available! 10.8.2 -> 11.0.0",
  "added 412 packages, and audited 413 packages in 9s",
  "+ openclaw@2026.7.20",
  "Collecting anthropic==0.34.2",
  "  Downloading anthropic-0.34.2-py3-none-any.whl (890 kB)",
  "Successfully installed anthropic-0.34.2 httpx-0.27.2",
  "remote: Enumerating objects: 128, done.",
  "From github.com:openclaw/openclaw",
  "   a1b2c3d..e4f5a6b  main       -> origin/main",
  "Updating a1b2c3d..e4f5a6b",
  " create mode 100644 packages/core/src/auth/token-store.ts",
  "integrity sha512-Kx9lRuLBIRSQEnzYYPSXGiCiZ0nDRXhIBAtWvBBlOaYQ==",
  "2026-07-25T10:11:12.345Z INFO  update complete in 42s",
  "Jul 25 10:11:12 srv614914 openclaw-gateway[1234]: token bucket refilled, 5 left",
  "2026-07-25T10:11:13+0000 hermes-dashboard[9119]: listening on 127.0.0.1:9119",
  "[mso] restored 314 files (12.4 MB)",
];

describe("secrets that reached a persisted transcript before this widened", () => {
  const cases: Array<[string, string, string]> = [
    [
      "a bare PAT in a git error, with no key=value beside it",
      "remote: HTTP Basic: Access denied. The provided token ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6 is invalid.",
      "ghp_A1b2",
    ],
    ["an npm registry auth line, where the key is a compound", "//registry.npmjs.org/:_authToken=npm_Xy12Ab34Cd56Ef78Gh90Ij12Kl34Mn", "npm_"], // gitleaks:allow — intentionally synthetic redaction fixture
    ["an env assignment with no word boundary before API", "ANTHROPIC_API_KEY=sk-ant-api03-Zz99Yy88Xx77Ww66Vv55", "sk-ant"],
    ["the same, exported by a shell line the CLI echoed", "export OPENAI_API_KEY=sk-proj-Qq11Ww22Ee33Rr44Tt55Yy66", "sk-proj"], // gitleaks:allow — intentionally synthetic redaction fixture
    ['json with the quote between key and colon', '{"api_key": "sk-live-Aa11Bb22Cc33Dd44Ee55"}', "sk-live"], // gitleaks:allow — intentionally synthetic redaction fixture
    ["the camelCase json spelling openclaw --json prints", '{"apiKey":"sk-live-Ff66Gg77Hh88Ii99Jj00"}', "sk-live"], // gitleaks:allow — intentionally synthetic redaction fixture
    ["credentials inside a URL", "fatal: unable to access https://rahman:hunter2horse@github.com/x/y.git/", "hunter2horse"],
    // Assembled rather than written out: as one literal this fixture trips
    // GitHub's push protection and the push is rejected. It is a made-up value,
    // but a scanner cannot know that, and the test needs the shape, not a string.
    ["a slack bot token", `posting to ${"xoxb"}-1111111111-2222222222-AbCdEfGhIjKlMnOp`, "xoxb-"],
    ["an AWS key id", "aws configure: found AKIAIOSFODNN7EXAMPLE in the environment", "AKIA"],
    ["a JWT", "auth failed for eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "eyJhbGciOi"], // gitleaks:allow — intentionally synthetic redaction fixture
  ];

  for (const [what, line, leaked] of cases) {
    it(`redacts ${what}`, () => {
      const out = redact(line);
      expect(out).not.toContain(leaked);
      expect(out).toContain("[redacted]");
    });
  }

  it("keeps the surrounding line, so the operator still knows what failed", () => {
    expect(redact("fatal: unable to access https://rahman:hunter2horse@github.com/x/y.git/")).toBe(
      "fatal: unable to access https://rahman:[redacted]@github.com/x/y.git/",
    );
    expect(redact('{"apiKey":"sk-live-Ff66Gg77Hh88Ii99Jj00"}')).toBe('{"apiKey":"[redacted]"}'); // gitleaks:allow — intentionally synthetic redaction fixture
    // Still a header line, still named — only the credential is gone.
    const header = redact("Authorization: Bearer abcdefghijklmnop");
    expect(header).toContain("Authorization");
    expect(header).not.toContain("abcdefghijklmnop");
  });
});

describe("a realistic transcript stays readable", () => {
  it("changes nothing in ordinary npm / pip / git / journald output", () => {
    for (const line of TRANSCRIPT) expect(redact(line)).toBe(line);
  });

  it("does not mistake a hyphenated word for an sk- key", () => {
    // `sk-[…]{16,}` with no left anchor eats the tail of any long word ending
    // in "sk-", which is how a filename becomes "[redacted]".
    for (const line of ["writing disk-usage-report-2026-07-25-final.csv", "task-runner-configuration-file.yaml"]) {
      expect(redact(line)).toBe(line);
    }
  });

  it("still caps a line at 8 KB", () => {
    expect(redact("x".repeat(20_000))).toHaveLength(8192);
  });
});
