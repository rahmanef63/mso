import { describe, expect, it } from "vitest";
import { editDiff } from "./fs-edit-diff";

const lines = (text: string) => text.split("\n");

describe("editDiff", () => {
  it("reports a single-line substitution with its context", () => {
    const before = "const x = 1;\nexport const y = 2;\n";
    const after = "const x = 42;\nexport const y = 2;\n";

    const result = editDiff(before, after);

    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
    expect(result.truncated).toBe(false);
    expect(lines(result.diff)).toEqual([
      "@@ -1,2 +1,2 @@",
      "-const x = 1;",
      "+const x = 42;",
      " export const y = 2;",
    ]);
  });

  it("keeps three context lines on each side and nothing more", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\ni\n";
    const after = "a\nb\nc\nD\ne\nf\ng\nh\ni\n";

    const body = lines(editDiff(before, after).diff);

    expect(body[0]).toBe("@@ -1,7 +1,7 @@");
    expect(body.filter((line) => line.startsWith(" "))).toHaveLength(6);
    expect(body).toContain("-d");
    expect(body).toContain("+D");
    expect(body).not.toContain(" i");
  });

  it("hunk header names the real line number of the change", () => {
    const before = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 30", "LINE 30");

    const body = lines(editDiff(before, after).diff);

    // line 30 is the 31st line; three lines of context start at line 28.
    expect(body[0]).toBe("@@ -28,7 +28,7 @@");
    expect(body).toContain("-line 30");
    expect(body).toContain("+LINE 30");
  });

  it("drops context entirely when context is 0", () => {
    const body = lines(editDiff("a\nb\nc\n", "a\nB\nc\n", { context: 0 }).diff);
    expect(body).toEqual(["@@ -2,1 +2,1 @@", "-b", "+B"]);
  });

  it("handles an insertion at end of file with no trailing newline", () => {
    const result = editDiff("a\nb", "a\nb\nc");
    expect(result.added).toBe(1);
    expect(lines(result.diff)).toEqual(["@@ -1,2 +1,3 @@", " a", " b", "+c"]);
  });

  it("handles a deletion", () => {
    const result = editDiff("a\nb\nc\n", "a\nc\n");
    expect(result.removed).toBe(1);
    expect(result.added).toBe(0);
    expect(lines(result.diff)).toContain("-b");
  });

  it("reports every replaced region of a replace-all as one hunk", () => {
    const result = editDiff("x\nx\nx\n", "y\ny\ny\n");
    expect(result.removed).toBe(3);
    expect(result.added).toBe(3);
    expect(lines(result.diff).filter((line) => line === "-x")).toHaveLength(3);
    expect(lines(result.diff).filter((line) => line === "+y")).toHaveLength(3);
  });

  it("returns nothing when the text is unchanged", () => {
    expect(editDiff("same\n", "same\n")).toEqual({ diff: "", truncated: false, removed: 0, added: 0 });
  });

  it("truncates at maxLines and says how much it withheld, without losing the counts", () => {
    const before = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    const after = Array.from({ length: 80 }, (_, i) => `changed ${i}`).join("\n");

    const result = editDiff(before, after, { maxLines: 12 });
    const body = lines(result.diff);

    expect(result.truncated).toBe(true);
    expect(body.length).toBe(12);
    expect(body[body.length - 1]).toMatch(/^… \d+ more lines$/);
    // The counts describe the real change, not the truncated rendering.
    expect(result.removed).toBe(80);
    expect(result.added).toBe(80);
  });

  it("keeps CRLF content byte-faithful instead of normalising it", () => {
    const result = editDiff("a\r\nb\r\n", "a\r\nB\r\n");
    expect(lines(result.diff)).toContain("-b\r");
    expect(lines(result.diff)).toContain("+B\r");
  });
});
