import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenClaw provider secrets stay out of child argv", () => {
  const script = readFileSync(path.join(process.cwd(), "scripts", "managed-app-install"), "utf8");
  it("uses provider env SecretRefs instead of provider key flags", () => {
    const openclaw = script.slice(script.indexOf("install_openclaw() {"), script.indexOf("openclaw_bin() {"));
    expect(openclaw).toContain("--secret-input-mode ref");
    expect(openclaw).not.toMatch(/--(?:anthropic|openai|openrouter|gemini|groq|xai|deepseek)-api-key/);
    expect(openclaw.slice(openclaw.indexOf('"$openclaw" onboard'))).not.toContain('"$KEY"');
  });
});
