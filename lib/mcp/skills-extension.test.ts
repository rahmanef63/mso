import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { dispatch } = await import("./dispatch");
const { CHATGPT_PUBLISHED_SKILLS, MCP_SKILLS_EXTENSION } = await import("./skills-extension");

describe("MCP Skills extension", () => {
  it("advertises the skills extension and exactly five official MSO skills", async () => {
    const initialized = await dispatch({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, "read", "skills-test");
    expect(initialized.result).toMatchObject({ capabilities: { extensions: { [MCP_SKILLS_EXTENSION]: {} } } });
    const listed = await dispatch({ id: 2, method: "skills/list", params: {} }, "read", "skills-test");
    const skills = (listed.result as { skills: Array<{ uri: string; frontmatter: Record<string, unknown>; resources: Array<{ uri: string; digest: string }> }>; nextCursor?: string }).skills;
    expect(skills).toHaveLength(5);
    expect(skills.map((skill) => skill.frontmatter.name)).toEqual([...CHATGPT_PUBLISHED_SKILLS]);
    expect((listed.result as { nextCursor?: string }).nextCursor).toBeUndefined();
    for (const skill of skills) {
      expect(skill.uri).toMatch(/^skill:\/\/mso\/[a-z0-9-]+\/SKILL\.md$/);
      expect(skill.frontmatter.description).toEqual(expect.any(String));
      expect(skill.resources.length).toBeGreaterThan(0);
      expect(skill.resources[0].uri).toBe(skill.uri);
      for (const resource of skill.resources) expect(resource.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it("returns exact entries and resources whose bytes match their digests", async () => {
    const listed = await dispatch({ id: 3, method: "skills/list", params: {} }, "read", "skills-test");
    const skill = (listed.result as { skills: Array<{ uri: string; resources: Array<{ uri: string; digest: string }> }> }).skills[0];
    const got = await dispatch({ id: 4, method: "skills/get", params: { uri: skill.uri } }, "read", "skills-test");
    expect((got.result as { skill: unknown }).skill).toEqual(skill);
    for (const resource of skill.resources) {
      const read = await dispatch({ id: 5, method: "resources/read", params: { uri: resource.uri } }, "read", "skills-test");
      const content = (read.result as { contents: Array<{ uri: string; text?: string; blob?: string }> }).contents[0];
      expect(content.uri).toBe(resource.uri);
      const bytes = content.text !== undefined ? Buffer.from(content.text, "utf8") : Buffer.from(content.blob ?? "", "base64");
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(resource.digest);
    }
  });

  it("fails closed for unpublished skills, unsafe resources and invented pagination", async () => {
    const unpublished = await dispatch({ id: 6, method: "skills/get", params: { uri: "skill://mso/anti-ai-slop-product-ui/SKILL.md" } }, "read", "skills-test");
    expect(unpublished.error).toMatchObject({ code: -32602 });
    const unsafe = await dispatch({ id: 7, method: "resources/read", params: { uri: "skill://mso/mso/%2e%2e/package.json" } }, "read", "skills-test");
    expect(unsafe.error).toMatchObject({ code: -32602 });
    const cursor = await dispatch({ id: 8, method: "skills/list", params: { cursor: "invented" } }, "read", "skills-test");
    expect(cursor.error).toMatchObject({ code: -32602 });
  });
});
