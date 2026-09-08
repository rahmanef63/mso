// The format table is the contract between Files (what to route, what to icon) and
// Preview (what to render). These pin the parts that are decisions rather than data:
// which formats are honestly unrenderable, that HTML is a kind of its own (it is
// fetched and sandboxed, never framed from the raw URL), and that an unknown
// extension lands somewhere sane instead of on an empty <img>.
import { describe, expect, it } from "vitest";
import { kindForName, kindForExt, isPreviewable, isTextual } from "./kinds";

describe("kindForName", () => {
  it("covers the formats Windows and macOS actually leave lying around", () => {
    expect(kindForName("holiday.HEIC")).toBe("image"); // iPhone default
    expect(kindForName("scan.tiff")).toBe("image");
    expect(kindForName("clip.m4v")).toBe("video"); // QuickTime export
    expect(kindForName("recording.wmv")).toBe("video");
    expect(kindForName("voice memo.m4a")).toBe("audio");
    expect(kindForName("track.opus")).toBe("audio");
    expect(kindForName("invoice.PDF")).toBe("pdf");
  });

  it("calls a document a document instead of pretending to render it", () => {
    // Every one of these opens as a blank frame if it is treated as previewable —
    // which reads as MSO being broken rather than as the browser having no decoder.
    for (const name of ["report.docx", "budget.xlsx", "deck.pptx", "notes.pages", "archive.zip", "Setup.exe", "disk.dmg"]) {
      expect(kindForName(name)).toBe("none");
      expect(isPreviewable(kindForName(name))).toBe(false);
    }
  });

  it("separates the kinds whose bytes the viewer reads itself", () => {
    expect(kindForName("index.html")).toBe("html");
    expect(kindForName("README.md")).toBe("markdown");
    expect(kindForName("rows.csv")).toBe("csv");
    expect(kindForName("server.log")).toBe("text");
    for (const kind of ["html", "markdown", "csv", "text"] as const) expect(isTextual(kind)).toBe(true);
    // Not textual — these render from a URL, so nothing is fetched.
    for (const kind of ["image", "video", "audio", "pdf", "none"] as const) expect(isTextual(kind)).toBe(false);
  });

  it("reads the well-known extension-less files as text", () => {
    expect(kindForName("Makefile")).toBe("text");
    expect(kindForName("Dockerfile")).toBe("text");
    expect(kindForName("LICENSE")).toBe("text");
    // …but not every extension-less blob: a random binary is not a text file.
    expect(kindForName("core")).toBe("none");
  });

  it("takes the extension from the last dot, and the name from the last slash", () => {
    expect(kindForName("/home/operator/photos/my.trip.2026.jpg")).toBe("image");
    expect(kindForName("/var/log/nginx/access.log")).toBe("text");
  });

  it("is case-insensitive and unknown-safe", () => {
    expect(kindForExt("JPEG")).toBe("image");
    expect(kindForExt("wat")).toBe("none");
    expect(kindForName("no-extension-at-all")).toBe("none");
  });
});
