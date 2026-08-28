import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_SECRET_LEN, signSession } from "./session";

// Cookies ignore ports and paths (RFC 6265 §8.5), so anything that can write a
// cookie on this host — a sibling port, a proxied page, document.cookie — can add
// a SECOND `session=` cookie ahead of the real one. Reading only the first match
// hands every request a forged value and locks the user out with the valid cookie
// still in the jar, unfixable from the UI.
const SECRET = "s".repeat(MIN_SECRET_LEN);
const jar: { name: string; value: string }[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: (name: string) => jar.filter((cookie) => cookie.name === name),
  }),
}));
vi.mock("./device-store", () => ({
  getApprovedDevice: async (id: string) => id === "dev-1"
    ? { label: "device", approvedAt: 1, role: "operator" }
    : null,
}));

const valid = () => signSession({ issued_at: Date.now(), expires_at: Date.now() + 60_000, device_id: "dev-1" }, SECRET);

beforeEach(() => {
  jar.length = 0;
  process.env.OS_SESSION_SECRET = SECRET;
});

describe("getSession with a shadowed cookie", () => {
  it("accepts the real session even when a forged one sorts first", async () => {
    const { getSession } = await import("./require-session");
    jar.push({ name: "session", value: "EVIL" }, { name: "session", value: valid() });
    expect(await getSession()).toMatchObject({ device_id: "dev-1" });
  });

  it("still rejects when every candidate fails", async () => {
    const { getSession } = await import("./require-session");
    jar.push({ name: "session", value: "EVIL" }, { name: "session", value: "ALSO_EVIL" });
    expect(await getSession()).toBeNull();
  });

  it("rejects a signed session whose device is not approved", async () => {
    const { getSession } = await import("./require-session");
    jar.push({
      name: "session",
      value: signSession({ issued_at: Date.now(), expires_at: Date.now() + 60_000, device_id: "revoked" }, SECRET),
    });
    expect(await getSession()).toBeNull();
  });

  it("rechecks the live device role for every authorization decision", async () => {
    const { getSessionContext, requireSession } = await import("./require-session");
    jar.push({ name: "session", value: valid() });
    await expect(getSessionContext()).resolves.toMatchObject({ role: "operator" });
    await expect(requireSession("viewer")).resolves.toBe(true);
    await expect(requireSession("operator")).resolves.toBe(true);
    await expect(requireSession("owner")).resolves.toBe(false);
  });
});
