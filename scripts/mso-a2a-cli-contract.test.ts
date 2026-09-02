import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cli = readFileSync(path.join(process.cwd(), "bin", "mso"), "utf8");

describe("MSO A2A CLI contract", () => {
  it("exposes authenticated inbound, peer auth, and streaming commands", () => {
    expect(cli).toContain("a2a list|state|sessions|spawn <source-session> <objective> [title]|inbox <session>|discover <url>");
    expect(cli).toContain("stream <target> <message>");
    expect(cli).toContain("auth add <target> [label] [bearer|api-key|oauth2]");
    expect(cli).toContain("inbound create [label] [read|write|exec]");
    expect(cli).toContain("sessions|spawn <source-session> <objective> [title]|inbox <session>");
    expect(cli).toContain("local handoff <session> <objective>");
    expect(cli).toContain("local spawn <sourceSession> <objective> [title]");
    expect(cli).toContain("local inbox <session>");
  });

  it("keeps outbound credential secrets off jq/curl argv", () => {
    expect(cli).toContain(
      "# Non-secret metadata travels in env vars; the secret is read only from stdin.",
    );
    expect(cli).toContain('process.stdin.on("data",d=>secret+=d)');
    expect(cli).toContain("-H 'content-type: application/json' -d @-");
    expect(cli).toContain("printf '%s' \"$secret\" | a2a_credential_body");
    expect(cli).not.toMatch(/jq[^\n]*--arg\s+secret/);
    expect(cli).not.toMatch(/curl[^\n]*\$secret/);
  });

  it("binds a credential to an explicit Agent Card scheme when alternatives exist", () => {
    expect(cli).toContain("a2a_agent_schemes");
    expect(cli).toContain("Agent Card scheme [$default_scheme]");
    expect(cli).toContain("unknown Agent Card security scheme");
    expect(cli).toContain(
      'a2a_credential_body "$agent_id" "$label" "$kind" "$header_name" "$scheme_name"',
    );
  });
  it("keeps same-host session A2A explicit and never prints the internal bearer", () => {
    expect(cli).toContain('action:"local-handoff"');
    expect(cli).toContain('action:"local-spawn"');
    expect(cli).toContain("action=local-sessions");
    expect(cli).not.toContain("mso_local_a2a_");
  });
});
