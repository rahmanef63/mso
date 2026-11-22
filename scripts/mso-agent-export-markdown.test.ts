import { describe, expect, it, vi } from "vitest";
import {
  formatExportMarkdown,
} from "./mso-agent-export-markdown.mjs";
import { handleParityCommand } from "./mso-agent-cmd-parity.mjs";

describe("MSO Agent session export markdown formatter", () => {
  it("1. produces a document with roles marked and one line per successful tool call", () => {
    // Validates that successful tool outputs collapse to a single line without hiding turn roles.
    const session = {
      name: "milo",
      title: "File Inspection Session",
      model: "gpt-6.1-sol",
      history: [
        { role: "user", text: "Please inspect directory" },
        {
          role: "assistant",
          text: "Inspecting files now",
          toolUses: [{ id: "call_1", name: "fs_list" }],
        },
        {
          role: "tool",
          name: "fs_list",
          isError: false,
          content: "file1.txt\nfile2.txt\nfile3.txt\nfile4.txt",
        },
      ],
    };

    const markdown = formatExportMarkdown(session);

    // Verify role markers exist for user, assistant, and tool
    expect(markdown).toContain("### User");
    expect(markdown).toContain("### Assistant");
    expect(markdown).toContain("- **Tool** (fs_list):");

    // The successful tool call must collapse to a single line without embedded newlines
    const lines = markdown.split("\n");
    const toolLine = lines.find((line) => line.startsWith("- **Tool** (fs_list):"));
    expect(toolLine).toBeDefined();
    expect(toolLine).not.toContain("\n");
    expect(toolLine).toContain("file1.txt");
    expect(toolLine).toContain("file4.txt");
  });

  it("2. keeps a failed tool call expanded across multiple lines", () => {
    // Failed tool rows must stay expanded because concealing stack traces misrepresents session state.
    const session = {
      name: "milo",
      title: "Failure Diagnosis",
      model: "gpt-6.1-sol",
      history: [
        { role: "user", text: "Run failing task" },
        {
          role: "tool",
          name: "exec_cmd",
          isError: true,
          content: "Command failed with exit code 1:\nLine 1 of error trace\nLine 2 of error trace",
        },
      ],
    };

    const markdown = formatExportMarkdown(session);

    // Header indicates failure and content remains multi-line
    expect(markdown).toContain("- **Tool** (exec_cmd) [FAILED]:");
    expect(markdown).toContain("Line 1 of error trace");
    expect(markdown).toContain("Line 2 of error trace");

    // Check that error details occupy distinct lines rather than being flattened
    const lines = markdown.split("\n");
    const failHeaderIdx = lines.findIndex((l) => l.includes("[FAILED]"));
    expect(failHeaderIdx).toBeGreaterThanOrEqual(0);
    const subsequent = lines.slice(failHeaderIdx + 1);
    expect(subsequent.some((l) => l.includes("Line 1 of error trace"))).toBe(true);
    expect(subsequent.some((l) => l.includes("Line 2 of error trace"))).toBe(true);
  });

  it("3. contains zero ANSI escape bytes in the output", () => {
    // Transcripts must be free of terminal styling escape bytes so they render cleanly in any viewer.
    const session = {
      name: "milo",
      title: "Color Scrubbing Test",
      model: "gpt-6.1-sol",
      history: [
        { role: "user", text: "\x1b[32mGreen user text\x1b[0m" },
        { role: "assistant", text: "\x1b[34mBlue assistant\x1b[0m" },
        {
          role: "tool",
          name: "colored_tool",
          content: "\x1b[31mRed error output\x1b[0m\n\x1b[33mYellow warning\x1b[0m",
          isError: true,
        },
      ],
    };

    const markdown = formatExportMarkdown(session);

    // Byte 0x1b / \u001b (escape) must not be present anywhere in the exported text
    expect(markdown.includes("\x1b")).toBe(false);
    expect(/\u001b/.test(markdown)).toBe(false);
    expect(markdown).toContain("Green user text");
    expect(markdown).toContain("Blue assistant");
    expect(markdown).toContain("Red error output");
  });

  it("5. carries session name, model, and turn count in the header", () => {
    // Provenance header must document identity, active model, and conversation length.
    const session = {
      name: "operator-session",
      title: "Deployment Audit",
      model: "claude-sonnet-4-6",
      history: [
        { role: "user", text: "Turn 1" },
        { role: "assistant", text: "Reply 1" },
        { role: "user", text: "Turn 2" },
        { role: "assistant", text: "Reply 2" },
      ],
    };

    const markdown = formatExportMarkdown(session);

    expect(markdown).toMatch(/- \*\*Session\*\*:.*@?operator-session/);
    expect(markdown).toMatch(/- \*\*Model\*\*:.*claude-sonnet-4-6/);
    expect(markdown).toMatch(/- \*\*Turns\*\*:.*2/);
    expect(markdown).toContain("Deployment Audit");
  });

  it("refuses file flags before fetching and still prints remote transcripts", async () => {
    const printed: string[] = [];
    const api = vi.fn().mockResolvedValue({ session: { title: "Remote", history: [] } });
    const ctx = {
      session: { id: "local", history: [] }, api, runCli: vi.fn(),
      write: (s: string) => printed.push(s), C: {},
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const flags of [["--out", "export.md"], ["--out="], ["--force"], ["-f"]]) {
        expect(await handleParityCommand(ctx, "/export", ["remote", "--markdown", ...flags])).toBe("handled");
      }
      expect(api).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledTimes(4);
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("Omit --out"));
      expect(await handleParityCommand(ctx, "/export", ["remote", "--markdown"])).toBe("handled");
      expect(api).toHaveBeenCalledOnce();
      expect(printed.join("\n")).toContain("Remote");
    } finally {
      errors.mockRestore();
    }
  });
});
