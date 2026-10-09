import { afterEach, expect, it, vi } from "vitest";
const registerClient = vi.hoisted(() => vi.fn(async () => "fixture-client"));
vi.mock("@/lib/mcp/store", () => ({ registerClient }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("limits rotating forwarding headers before body/store work and reports protected capacity", async () => {
  vi.stubEnv("OS_MCP_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_OS_DEMO", "0");
  vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "0");
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_910_000_000_000);
  const { POST } = await import("./route");
  const request = (index: number) => new Request("https://fixture.invalid/oauth/register", {
    method: "POST", headers: { "x-forwarded-for": `198.51.100.${index}`, "content-type": "application/json" },
    body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: ["https://attacker.invalid/callback", "https://chatgpt.com/connector/oauth/example"] }),
  });
  for (let i = 0; i < 10; i++) expect((await POST(request(i))).status).toBe(201);
  expect((await POST(request(11))).status).toBe(429);
  expect(registerClient).toHaveBeenCalledTimes(10);
  clock.mockReturnValue(1_910_003_600_001);
  vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "1");
  for (let i = 0; i < 40; i++) expect((await POST(request(i))).status).toBe(201);
  const next = request(41), reader = vi.spyOn(next.body!, "getReader");
  expect((await POST(next)).status).toBe(429);
  expect(registerClient).toHaveBeenCalledTimes(50);
  expect(reader).not.toHaveBeenCalled();
  clock.mockReturnValue(1_910_007_200_002);
  registerClient.mockRejectedValueOnce(new Error("MCP client registration capacity reached"));
  const response = await POST(request(0));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: "temporarily_unavailable" });
});
