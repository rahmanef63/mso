import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(async () => true),
  readFile: vi.fn(async () => "# Changelog\n\n- Fix things"),
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: mocks.requireSession,
}));

vi.mock("node:fs", () => ({
  promises: {
    readFile: mocks.readFile,
  },
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(true);
  mocks.readFile.mockResolvedValue("# Changelog\n\n- Fix things");
});

describe("GET /api/changelog", () => {
  it("returns 401 when unauthenticated to prevent leaking deployment history", async () => {
    mocks.requireSession.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("returns empty markdown without 500 when changelog file is absent", async () => {
    // When changelog has never been generated, handler must return 200 with generated:false
    mocks.readFile.mockRejectedValue(new Error("ENOENT: no such file or directory"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ markdown: "", generated: false });
  });

  it("serves changelog content with generated:true when file exists", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      markdown: "# Changelog\n\n- Fix things",
      generated: true,
    });
  });

  it("caps changelog body to 40,000 characters to prevent response bloat", async () => {
    const largeContent = "A".repeat(50_000);
    mocks.readFile.mockResolvedValue(largeContent);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.generated).toBe(true);
    expect(data.markdown.length).toBe(40_000);
    expect(data.markdown).toBe("A".repeat(40_000));
  });
});
