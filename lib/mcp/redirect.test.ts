import { describe, expect, it } from "vitest";
import { denyUrl, selfUrl } from "./redirect";

const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";

describe("denyUrl", () => {
  it("reports the refusal back to the client instead of going nowhere", () => {
    // The bug this replaces: Cancel called history.back(), so ChatGPT waited on
    // a callback that never came and the user just saw a spinner.
    const url = new URL(denyUrl(CHATGPT, "st-1") as string);
    expect(url.origin + url.pathname).toBe(CHATGPT);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("st-1");
  });

  it("omits state when the client sent none, rather than sending an empty one", () => {
    expect(denyUrl(CHATGPT, "")).not.toContain("state=");
  });

  it("keeps a query the redirect target already carried", () => {
    const url = denyUrl("https://chatgpt.com/cb?tenant=acme", "s") as string;
    expect(url).toContain("tenant=acme");
    expect(url).toContain("error=access_denied");
  });

  it("percent-encodes a hostile state instead of splitting the query", () => {
    const url = denyUrl(CHATGPT, "a&code=evil") as string;
    expect(new URL(url).searchParams.get("code")).toBeNull();
  });

  it("refuses a target the success path would also refuse", () => {
    // Declining must not be a softer gate than approving.
    expect(denyUrl("http://evil.test/cb", "s")).toBeNull();
    expect(denyUrl("javascript:alert(1)", "s")).toBeNull();
    expect(denyUrl("not a url", "s")).toBeNull();
  });

  it("allows loopback, which is how a desktop client receives the answer", () => {
    expect(denyUrl("http://127.0.0.1:41234/cb", "s")).toContain("error=access_denied");
  });
});

describe("selfUrl", () => {
  const REQ = {
    response_type: "code",
    client_id: "mcpc_abc",
    redirect_uri: CHATGPT,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "st-1",
    scope: "read",
  };

  it("round-trips the whole request, so unlocking does not lose it", () => {
    // The bug this replaces: the unauthenticated screen linked to `/`, throwing
    // away a request the client had already committed a PKCE verifier to.
    const params = new URL(`https://mso.test${selfUrl(REQ)}`).searchParams;
    for (const [key, value] of Object.entries(REQ)) {
      expect(params.get(key), key).toBe(value);
    }
  });

  it("carries `resource`, which ChatGPT sends", () => {
    const params = new URL(
      `https://mso.test${selfUrl({ ...REQ, resource: "https://mso.example.com/mcp" })}`,
    ).searchParams;
    expect(params.get("resource")).toBe("https://mso.example.com/mcp");
  });

  it("drops anything the flow does not read", () => {
    const url = selfUrl({ ...REQ, utm_source: "x", "<script>": "y" });
    expect(url).not.toContain("utm_source");
    expect(url).not.toContain("script");
  });

  it("takes the first value of a repeated parameter, matching what the page reads", () => {
    const url = selfUrl({ ...REQ, redirect_uri: [CHATGPT, "https://evil.test/cb"] });
    expect(url).not.toContain("evil.test");
  });

  it("stays a relative path — it is a link back to this same page", () => {
    expect(selfUrl(REQ).startsWith("/oauth/authorize?")).toBe(true);
  });

  it("degrades to the bare path when there is nothing to carry", () => {
    expect(selfUrl({})).toBe("/oauth/authorize");
  });
});
