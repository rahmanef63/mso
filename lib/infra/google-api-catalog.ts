const str = (maxLength = 2048) => ({ type: "string", minLength: 1, maxLength });
const num = (minimum: number, maximum: number) => ({ type: "integer", minimum, maximum });
const day = { ...str(10), pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const names = (maxItems: number) => ({ type: "array", minItems: 1, maxItems, items: schema({ name: { ...str(80), pattern: "^[A-Za-z][A-Za-z0-9_]{0,79}$" } }, ["name"]) });
export const GOOGLE_READ_OPERATIONS = [
  { name: "google.searchConsole.sites.list", provider: "google-search-console", description: "List Google Search Console properties accessible to this exact account and their permissions. Empty data does not imply an indexing result.", inputSchema: schema({}), readOnly: true },
  { name: "google.searchConsole.searchAnalytics.query", provider: "google-search-console", description: "Read a bounded date/query/page performance report. Missing rows do not prove non-indexing. Reuse siteUrl exactly from sites.list.",
    inputSchema: schema({ siteUrl: str(), startDate: day, endDate: day, dimensions: { type: "array", maxItems: 5, uniqueItems: true, items: { enum: ["date", "query", "page", "country", "device", "searchAppearance"] } }, type: { enum: ["web", "image", "video", "news", "discover", "googleNews"] }, rowLimit: num(1, 1000), startRow: num(0, 100000) }, ["siteUrl", "startDate", "endDate"]), readOnly: true },
  { name: "google.searchConsole.sitemaps.list", provider: "google-search-console", description: "Read existing sitemap submissions for the exact selected property. Does not submit a sitemap.", inputSchema: schema({ siteUrl: str() }, ["siteUrl"]), readOnly: true },
  { name: "google.searchConsole.url.inspect", provider: "google-search-console", description: "Read Google's stored URL index inspection result. This is not a live crawl or indexing request.", inputSchema: schema({ siteUrl: str(), inspectionUrl: str(), languageCode: str(35) }, ["siteUrl", "inspectionUrl"]), readOnly: true },
  { name: "google.analytics.accountSummaries.list", provider: "google-analytics", description: "Read accessible Google Analytics accounts and property summaries; follow nextPageToken using the same connection.", inputSchema: schema({ pageSize: num(1, 200), pageToken: str(2048) }), readOnly: true },
  { name: "google.analytics.report.run", provider: "google-analytics", description: "Read a bounded GA4 Data API report for properties/N. This is not Measurement Protocol and cannot send events or change configuration.",
    inputSchema: schema({ property: { ...str(40), pattern: "^properties/[1-9][0-9]{0,19}$" }, startDate: day, endDate: day, metrics: names(10), dimensions: names(9), limit: num(1, 1000), offset: num(0, 100000) }, ["property", "startDate", "endDate", "metrics"]), readOnly: true },
] as const;
