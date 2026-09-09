import { describe, expect, it } from "vitest";
import { applyPrivatePageCachePolicy } from "./page-cache";

function apply(headers: HeadersInit, method = "GET") {
  const response = new Response(null);
  applyPrivatePageCachePolicy(response, new Request("https://mso.example.com/settings", { method, headers }));
  return response.headers;
}

describe("auth-sensitive page cache policy", () => {
  it("marks HTML private/no-store and varies on Cookie", () => {
    const headers = apply({ accept: "text/html" });
    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0, must-revalidate");
    expect(headers.get("pragma")).toBe("no-cache");
    expect(headers.get("expires")).toBe("0");
    expect((headers.get("vary") ?? "").toLowerCase()).toContain("cookie");
  });

  it("marks RSC navigation private/no-store", () => {
    expect(apply({ accept: "text/x-component", rsc: "1" }).get("cache-control")).toContain("no-store");
  });

  it("leaves static-byte shaped requests untouched", () => {
    expect(apply({ accept: "image/avif,image/webp,image/*" }).get("cache-control")).toBeNull();
    expect(apply({ accept: "*/*" }).get("cache-control")).toBeNull();
  });
});
