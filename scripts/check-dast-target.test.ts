import { describe, expect, it, vi } from "vitest";
import { probeDastTarget, requireDastTarget } from "./check-dast-target.mjs";

const TARGET = "https://mso.example.com/";

function reply(status: number, body = "") {
  return new Response(body, { status });
}

describe("probeDastTarget", () => {
  it("accepts a 200 from the application", async () => {
    const fetchImpl = vi.fn(async () => reply(200, "<title>MSO</title>"));
    await expect(probeDastTarget(TARGET, fetchImpl)).resolves.toEqual({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TARGET);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
  });

  it("rejects a 530 tunnel failure", async () => {
    const fetchImpl = async () => reply(530, "error code: 1033");
    await expect(probeDastTarget(TARGET, fetchImpl)).rejects.toThrow(/does not serve the application: HTTP 530/);
  });

  it("rejects a 200 whose body is the 1033 error page", async () => {
    const fetchImpl = async () => reply(200, "<title>Error 1033</title> error code: 1033");
    await expect(probeDastTarget(TARGET, fetchImpl)).rejects.toThrow(/Cloudflare error page \(1033\)/);
  });

  it("wraps a fetch failure with its message", async () => {
    const fetchImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND mso.example.com");
    };
    await expect(probeDastTarget(TARGET, fetchImpl)).rejects.toThrow(
      /does not serve the application: getaddrinfo ENOTFOUND mso\.example\.com/,
    );
  });
});

describe("requireDastTarget", () => {
  it("still rejects a non-HTTPS target", () => {
    expect(() => requireDastTarget("http://mso.example.com")).toThrow(/must use HTTPS/);
  });
});
