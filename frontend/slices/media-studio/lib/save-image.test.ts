import { afterEach, describe, expect, it, vi } from "vitest";
import { autoName, DEFAULT_DIR, loadSavePrefs, saveImageToHost, saveSavePrefs } from "./save-image";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("media-studio save-image helpers", () => {
  it("falls back safely to default save preferences when storage is unavailable or malformed", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "{not-json",
      setItem: () => {},
    });
    expect(loadSavePrefs()).toEqual({ dir: DEFAULT_DIR, format: "png", quality: 92, remember: false });

    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    saveSavePrefs({ dir: "~/Assets", format: "webp", quality: 80, remember: true });
    expect(loadSavePrefs()).toEqual({ dir: "~/Assets", format: "webp", quality: 80, remember: true });
  });

  it("generates timestamped non-overwriting filenames and uploads PNG payloads", async () => {
    expect(autoName()).toMatch(/^studio-\d{8}-\d{6}$/);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const saved = await saveImageToHost("data:image/png;base64,iVBORw0KGgo=", {
      dir: "~/Pictures/Studio/",
      name: "banner",
      format: "png",
      quality: 92,
    });
    expect(saved).toBe("~/Pictures/Studio/banner.png");
  });
});
