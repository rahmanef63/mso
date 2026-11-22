// Web-standard replacement for "next/server" (NextRequest, NextResponse, NextURL)
// so MSO API/MCP/OAuth/A2A route handlers and middleware (proxy.ts) run natively on
// Bun/Node Web Fetch Request/Response without the Next.js framework dependency.

export type CookieOption = {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none" | "Strict" | "Lax" | "None" | boolean;
};

export type RequestCookie = { name: string; value: string };

const LOOPBACK_NORM = new Set(["127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

export class NextURL extends URL {
  basePath = "";
  constructor(input: string | URL, base?: string | URL) {
    super(String(input), base ? String(base) : "http://localhost");
    if (LOOPBACK_NORM.has(this.hostname.toLowerCase())) {
      this.hostname = "localhost";
    }
  }
  clone(): NextURL {
    const copy = new NextURL(this.toString());
    copy.basePath = this.basePath;
    return copy;
  }
}

export class RequestCookies {
  private map = new Map<string, string[]>();
  constructor(headers: Headers) {
    const raw = headers.get("cookie") ?? "";
    for (const part of raw.split(";")) {
      const idx = part.indexOf("=");
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (!name) continue;
      let decoded = val;
      try { decoded = decodeURIComponent(val); } catch { /* keep raw */ }
      const list = this.map.get(name) ?? [];
      list.push(decoded);
      this.map.set(name, list);
    }
  }
  get(name: string): RequestCookie | undefined {
    const list = this.map.get(name);
    return list && list.length > 0 ? { name, value: list[0] } : undefined;
  }
  getAll(name?: string): RequestCookie[] {
    if (name !== undefined) {
      return (this.map.get(name) ?? []).map((value) => ({ name, value }));
    }
    const out: RequestCookie[] = [];
    for (const [k, vals] of this.map.entries()) {
      for (const value of vals) out.push({ name: k, value });
    }
    return out;
  }
  has(name: string): boolean {
    return (this.map.get(name)?.length ?? 0) > 0;
  }
  set(name: string, value: string): this {
    this.map.set(name, [value]);
    return this;
  }
  delete(name: string): boolean {
    return this.map.delete(name);
  }
}

function formatSetCookie(name: string, value: string, opts: CookieOption = {}): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) {
    const s = typeof opts.sameSite === "string" ? opts.sameSite : "strict";
    parts.push(`SameSite=${s}`);
  }
  return parts.join("; ");
}

export class ResponseCookies {
  private jar = new Map<string, { value: string; options: CookieOption }>();
  private headers: Headers;
  constructor(headers: Headers) {
    this.headers = headers;
  }
  set(
    nameOrObj: string | ({ name: string; value: string } & CookieOption),
    value = "",
    options: CookieOption = {},
  ): this {
    const name = typeof nameOrObj === "string" ? nameOrObj : nameOrObj.name;
    const val = typeof nameOrObj === "string" ? value : nameOrObj.value;
    const opts = typeof nameOrObj === "string" ? options : nameOrObj;
    this.jar.set(name, { value: val, options: opts });
    this.syncHeaders();
    return this;
  }
  get(name: string): RequestCookie | undefined {
    const entry = this.jar.get(name);
    return entry ? { name, value: entry.value } : undefined;
  }
  getAll(name?: string): RequestCookie[] {
    if (name !== undefined) {
      const e = this.jar.get(name);
      return e ? [{ name, value: e.value }] : [];
    }
    return Array.from(this.jar.entries()).map(([k, v]) => ({ name: k, value: v.value }));
  }
  delete(name: string): this {
    this.set(name, "", { path: "/", maxAge: 0 });
    return this;
  }
  private syncHeaders(): void {
    this.headers.delete("set-cookie");
    for (const [name, { value, options }] of this.jar.entries()) {
      this.headers.append("set-cookie", formatSetCookie(name, value, options));
    }
  }
}

export class NextRequest extends Request {
  readonly nextUrl: NextURL;
  readonly cookies: RequestCookies;
  readonly ip?: string;
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const urlStr = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    super(input, init);
    this.nextUrl = new NextURL(urlStr);
    this.cookies = new RequestCookies(this.headers);
  }
}

type MiddlewareInit = ResponseInit & { request?: { headers?: Headers } };

function applyMiddlewareRequestHeaders(resHeaders: Headers, init?: MiddlewareInit): void {
  const reqHeaders = init?.request?.headers;
  if (!reqHeaders) return;
  const keys: string[] = [];
  reqHeaders.forEach((value, key) => {
    const lower = key.toLowerCase();
    keys.push(lower);
    resHeaders.set(`x-middleware-request-${lower}`, value);
  });
  if (keys.length > 0) {
    resHeaders.set("x-middleware-override-headers", keys.join(","));
  }
}

export class NextResponse<_Body = unknown> extends Response {
  readonly cookies: ResponseCookies;
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    this.cookies = new ResponseCookies(this.headers);
  }
  static json<JsonBody>(data: JsonBody, init?: ResponseInit): NextResponse<JsonBody> {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new NextResponse<JsonBody>(JSON.stringify(data), { ...init, headers });
  }
  static redirect(url: string | NextURL | URL, init?: number | ResponseInit): NextResponse {
    const status = typeof init === "number" ? init : (init?.status ?? 307);
    const headers = new Headers(typeof init === "object" ? init?.headers : undefined);
    headers.set("location", String(url));
    return new NextResponse(null, { ...(typeof init === "object" ? init : {}), status, headers });
  }
  static rewrite(destination: string | NextURL | URL, init?: MiddlewareInit): NextResponse {
    const headers = new Headers(init?.headers);
    headers.set("x-middleware-rewrite", String(destination));
    applyMiddlewareRequestHeaders(headers, init);
    return new NextResponse(null, { ...init, headers });
  }
  static next(init?: MiddlewareInit): NextResponse {
    const headers = new Headers(init?.headers);
    headers.set("x-middleware-next", "1");
    applyMiddlewareRequestHeaders(headers, init);
    return new NextResponse(null, { ...init, headers });
  }
}

export function parseRelativeURL(url: string, base: string): { url: string; isRelative: boolean } {
  const u = new URL(url, base);
  const b = new URL(base);
  if (u.origin === b.origin) {
    return { url: `${u.pathname}${u.search}${u.hash}`, isRelative: true };
  }
  return { url: u.toString(), isRelative: false };
}
