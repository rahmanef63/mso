import { afterEach, expect, it, vi } from "vitest";
const authenticate = vi.hoisted(() => vi.fn(async () => null));
vi.mock("./credentials", () => ({ authenticateA2AInboundToken: authenticate }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("bounds forged forwarding identities before authentication and caps trusted-proxy traffic globally", async () => {
  vi.stubEnv("OS_A2A_INBOUND_ENABLED", "1");
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://fixture.invalid");
  vi.stubEnv("NEXT_PUBLIC_OS_DEMO", "0");
  vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "0");
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
  const { handleA2ARequest } = await import("./server");
  const capabilities = { list: () => [], invoke: vi.fn(async () => ({ content: [] })) };
  const request = (index: number) => new Request("https://fixture.invalid/a2a/v1", {
    method: "POST", headers: { "x-forwarded-for": `198.51.100.${index % 250}`, "x-real-ip": String(index), authorization: "Bearer invalid" }, body: "{}",
  });
  for (let i = 0; i < 120; i++) expect((await handleA2ARequest(request(i), capabilities)).status).toBe(401);
  expect((await handleA2ARequest(request(121), capabilities)).status).toBe(429);
  expect(authenticate).toHaveBeenCalledTimes(120);
  clock.mockReturnValue(1_900_000_060_001);
  vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "1");
  for (let i = 0; i < 600; i++) expect((await handleA2ARequest(request(i), capabilities)).status).toBe(401);
  const next = request(601);
  const reader = vi.spyOn(next.body!, "getReader");
  expect((await handleA2ARequest(next, capabilities)).status).toBe(429);
  expect(authenticate).toHaveBeenCalledTimes(720);
  expect(reader).not.toHaveBeenCalled();
});
