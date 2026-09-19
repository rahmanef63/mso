import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const core = fs.readFileSync(path.join(process.cwd(), "scripts/install-core.sh"), "utf8");

describe("installer Git remote authority", () => {
  it("keeps MSO_REPO as an explicit override while defaulting to canonical HTTPS", () => {
    expect(core).toContain('CANONICAL_REPO_URL="https://github.com/rahmanef63/mso.git"');
    expect(core).toContain('REPO_URL="${MSO_REPO:-$CANONICAL_REPO_URL}"');
  });

  it("normalizes only recognized canonical origins before updating an existing checkout", () => {
    expect(core).toContain('if install_repo_is_canonical_url "$url" && [ "$url" != "$CANONICAL_REPO_URL" ]; then');
    expect(core).toContain('git -C "$DIR" remote set-url origin "$CANONICAL_REPO_URL"');
    expect(core).not.toContain('remote set-url origin "$REPO_URL"');
  });

  it("runs clone and fetch with terminal prompting disabled", () => {
    expect(core).toContain('GIT_TERMINAL_PROMPT=0');
    expect(core).toContain('GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -oBatchMode=yes}"');
    expect(core).toContain('install_git_noninteractive git -C "$DIR" fetch --quiet origin "$REF"');
    expect(core).toContain('install_git_noninteractive git clone --quiet --branch "$REF" "$REPO_URL" "$DIR"');
  });

  it("converts canonical SSH clone requests to public HTTPS but leaves noncanonical URLs outside that rewrite", () => {
    expect(core).toContain('git@github.com:rahmanef63/mso.git');
    expect(core).toContain('ssh://git@github.com/rahmanef63/mso');
    expect(core).toContain('if install_repo_is_canonical_url "$REPO_URL"; then REPO_URL="$CANONICAL_REPO_URL"; fi');
  });
});
