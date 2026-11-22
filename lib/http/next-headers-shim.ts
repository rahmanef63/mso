// Web-standard AsyncLocalStorage replacement for "next/headers" so route handlers
// and lib/auth/require-session can read per-request headers and cookies without Next.js.

import { AsyncLocalStorage } from "node:async_hooks";
import { RequestCookies } from "./next-server-shim";

const requestHeadersStore = new AsyncLocalStorage<Headers>();

export function runWithRequestHeaders<T>(reqHeaders: Headers, fn: () => T): T {
  return requestHeadersStore.run(reqHeaders, fn);
}

export async function headers(): Promise<Headers> {
  return requestHeadersStore.getStore() ?? new Headers();
}

export async function cookies(): Promise<RequestCookies> {
  const h = requestHeadersStore.getStore() ?? new Headers();
  return new RequestCookies(h);
}
