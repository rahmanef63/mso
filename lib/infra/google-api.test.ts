import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeGoogleRead, GOOGLE_READ_OPERATIONS } from "./google-api";
const TOKEN = "TEST_GOOGLE_ACCESS_NOT_REAL";
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}))));
afterEach(() => vi.unstubAllGlobals());
describe("bounded Google read operations", () => {
  it("publishes exactly six typed read-only operations with strict argument schemas", () => {
    expect(GOOGLE_READ_OPERATIONS).toHaveLength(6);
    for (const row of GOOGLE_READ_OPERATIONS) { expect(row.readOnly).toBe(true); expect(row.inputSchema.additionalProperties).toBe(false); }
  });
  it("reads exact Search Console property strings without relabelling permissions", async () => {
    const data = { siteEntry: [{ siteUrl: "sc-domain:example.test", permissionLevel: "siteRestrictedUser" }] };
    vi.mocked(fetch).mockResolvedValueOnce(response(data));
    expect(await executeGoogleRead("google-search-console", TOKEN, "google.searchConsole.sites.list", {})).toEqual(data);
    expect(fetch).toHaveBeenCalledWith("https://www.googleapis.com/webmasters/v3/sites", expect.objectContaining({ method: "GET", redirect: "error", cache: "no-store" }));
  });
  it("preserves a URL-prefix property when encoding the analytics endpoint", async () => {
    await executeGoogleRead("google-search-console", TOKEN, "google.searchConsole.searchAnalytics.query", { siteUrl: "https://example.test/blog/", startDate: "2026-09-01", endDate: "2026-09-20", type: "image", rowLimit: 10 });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.test%2Fblog%2F/searchAnalytics/query");
    expect(JSON.parse(String(init?.body))).toMatchObject({ type: "image", rowLimit: 10, startRow: 0 });
  });
  it("lists existing sitemap metadata without invoking submission", async () => {
    await executeGoogleRead("google-search-console", TOKEN, "google.searchConsole.sitemaps.list", { siteUrl: "sc-domain:example.test" });
    expect(fetch).toHaveBeenCalledWith("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.test/sitemaps", expect.objectContaining({ method: "GET" }));
  });
  it("allows inspection of a real subdomain belonging to a domain property", async () => {
    await executeGoogleRead("google-search-console", TOKEN, "google.searchConsole.url.inspect", { siteUrl: "sc-domain:example.test", inspectionUrl: "https://sub.example.test/a" });
    expect(fetch).toHaveBeenCalledWith("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", expect.objectContaining({ method: "POST" }));
  });
  it.each(["https://example.test.evil.test/a", "https://evil.test/a", "https://user@example.test/a", "https://example.test/%2fsecret", "http://example.test/a"])("refuses out-of-property or malformed inspection %s", async inspectionUrl => {
    await expect(executeGoogleRead("google-search-console", TOKEN, "google.searchConsole.url.inspect", { siteUrl: "sc-domain:example.test", inspectionUrl })).rejects.toThrow("invalid_google_arguments");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["properties/1/../../accounts", "properties/1%2fadmin", "https://evil.test/", "properties/-1"])("refuses an unsafe GA property %s", async property => {
    await expect(executeGoogleRead("google-analytics", TOKEN, "google.analytics.report.run", { property, startDate: "2026-09-01", endDate: "2026-09-02", metrics: [{ name: "activeUsers" }] })).rejects.toThrow("invalid_google_arguments");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps GA pagination tokens and report counts without guessing totals", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ accountSummaries: [], nextPageToken: "next-page" }));
    expect(await executeGoogleRead("google-analytics", TOKEN, "google.analytics.accountSummaries.list", { pageSize: 5, pageToken: "page-2" })).toEqual({ accountSummaries: [], nextPageToken: "next-page" });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("pageToken=page-2");
    await executeGoogleRead("google-analytics", TOKEN, "google.analytics.report.run", { property: "properties/1234", startDate: "2026-09-01", endDate: "2026-09-02", metrics: [{ name: "activeUsers" }], dimensions: [{ name: "country" }], limit: 20 });
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("https://analyticsdata.googleapis.com/v1beta/properties/1234:runReport");
  });
  it.each([{ rowLimit: 1001 }, { rowLimit: 0 }, { startDate: "2026-02-30" }, { dimensions: ["query", "query"] }, { customUrl: "https://evil.test" }])("refuses bounds, invalid dates, duplicate dimensions or extra parameters %j", async change => {
    await expect(executeGoogleRead("google-search-console", TOKEN, "google.searchConsole.searchAnalytics.query", { siteUrl: "sc-domain:example.test", startDate: "2026-09-01", endDate: "2026-09-02", ...change })).rejects.toThrow("invalid_google_arguments");
  });
  it.each([401, 403, 429, 500])("does not reflect upstream secrets from HTTP %s", async status => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: { message: TOKEN, refresh_token: "PRIVATE_VALUE" } }, status));
    let error: unknown; try { await executeGoogleRead("google-search-console", TOKEN, "google.searchConsole.sites.list", {}); } catch (e) { error = e; }
    expect(String(error)).not.toMatch(/TEST_GOOGLE_ACCESS|PRIVATE_VALUE/); expect(String(error)).toMatch(/google_/);
  });
  it("never accepts a cross-provider operation or missing authorization", async () => {
    await expect(executeGoogleRead("google-analytics", TOKEN, "google.searchConsole.sites.list", {})).rejects.toThrow("provider_operation_mismatch");
    await expect(executeGoogleRead("google-search-console", "", "google.searchConsole.sites.list", {})).rejects.toThrow("authorization_required"); expect(fetch).not.toHaveBeenCalled();
  });
  it("caps responses and redacts a token reflected in success payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { headers: { "content-length": "9999999" } }));
    await expect(executeGoogleRead("google-search-console", TOKEN, "google.searchConsole.sites.list", {})).rejects.toThrow("response_limit");
    vi.mocked(fetch).mockResolvedValueOnce(response({ message: TOKEN, access_token: "OTHER_PRIVATE_TOKEN" }));
    expect(JSON.stringify(await executeGoogleRead("google-search-console", TOKEN, "google.searchConsole.sites.list", {}))).not.toMatch(/TEST_GOOGLE_ACCESS|OTHER_PRIVATE_TOKEN/);
  });
});
