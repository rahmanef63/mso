import { readInfraProvider } from "./store";
import { obj, request } from "./http";
import type { InfraProviderValues } from "./types";

const API = "https://developers.hostinger.com/api/mail/v1";
const auth = (token: string) => ({ authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" });
const ID = /^[A-Za-z0-9._-]{3,128}$/;
const LOCAL = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,48}[A-Za-z0-9])?$/;

function resourceId(value: unknown, name: string) {
  const text = String(value ?? "");
  if (!ID.test(text)) throw new Error(`invalid Hostinger Mail ${name}`);
  return text;
}
function email(value: unknown) {
  const text = String(value ?? "").trim();
  if (text.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new Error("invalid email address");
  return text;
}
async function context(order?: unknown) {
  const values = await readInfraProvider("hostinger");
  const token = values.mailApiToken || values.apiToken;
  if (!token) throw new Error("Hostinger Mail is not configured");
  const stored = values.mailOrderId;
  const supplied = order ? resourceId(order, "order id") : undefined;
  if (stored && supplied && stored !== supplied) throw new Error("Hostinger Mail order does not match the selected connection");
  return { token, orderId: stored || supplied };
}
function redact(value: unknown, depth = 0): unknown {
  if (depth > 16) return "[depth limited]";
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /password|secret|token|authorization|api.?key/i.test(key) ? "[redacted]" : redact(item, depth + 1),
    ]));
  }
  return value;
}
async function call(token: string, path: string, method = "GET", body?: unknown) {
  const res = await request(`${API}${path}`, { method, headers: auth(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!res.ok) throw new Error(`Hostinger Mail HTTP ${res.status}`);
  return redact(res.body);
}
function totalRows(body: unknown) {
  const row = obj(body);
  return Number(obj(row.meta).total ?? (Array.isArray(row.data) ? row.data.length : 0));
}

export async function doctorHostingerMail(candidate?: InfraProviderValues) {
  const values = candidate ?? await readInfraProvider("hostinger");
  if (values.mailApiToken) {
    if (!values.mailOrderId) return null;
    const body = await call(values.mailApiToken, `/orders/${encodeURIComponent(values.mailOrderId)}/mailboxes?per_page=1`);
    return `mail token valid; ${totalRows(body)} mailbox(es) visible`;
  }
  if (values.apiToken) {
    const res = await request(`${API}/orders?per_page=1`, { headers: auth(values.apiToken) });
    if (res.ok) return `account token valid; Hostinger Mail API available; ${totalRows(res.body)} mail order(s)`;
    return null;
  }
  return null;
}

export async function listHostingerMailOrders() {
  const values = await readInfraProvider("hostinger");
  if (!values.apiToken || values.mailApiToken) throw new Error("Hostinger account API token required to list mail orders");
  return call(values.apiToken, "/orders?per_page=100");
}
export async function getHostingerMailPlan(order: unknown) {
  const selected = await context(order);
  if (!selected.orderId) throw new Error("Hostinger Mail order id required");
  return call(selected.token, `/orders/${encodeURIComponent(selected.orderId)}/plan`);
}

const LIST = new Set(["mailboxes", "aliases", "forwarders", "autoreplies", "catchalls", "webhooks"]);
export async function listHostingerMail(order: unknown, resource: unknown, page = 1) {
  const kind = String(resource);
  if (!LIST.has(kind)) throw new Error("unsupported Hostinger Mail resource");
  const selected = await context(order);
  if (!selected.orderId) throw new Error("Hostinger Mail order id required");
  const current = Math.max(1, Math.min(100, Number(page) || 1));
  return call(selected.token, `/orders/${encodeURIComponent(selected.orderId)}/${kind}?page=${current}&per_page=100`);
}

const LOGS = new Set(["access", "action", "inbound", "mailbox-actions", "outbound"]);
export async function listHostingerMailLogs(order: unknown, kind: unknown, page = 1) {
  const name = String(kind);
  if (!LOGS.has(name)) throw new Error("unsupported Hostinger Mail log");
  const selected = await context(order);
  if (!selected.orderId) throw new Error("Hostinger Mail order id required");
  const current = Math.max(1, Math.min(100, Number(page) || 1));
  return call(selected.token, `/orders/${encodeURIComponent(selected.orderId)}/logs/${name}?page=${current}&per_page=100`);
}

export async function mutateHostingerMail(operation: string, args: Record<string, unknown>) {
  const selected = await context(args.orderId);
  const mailbox = () => resourceId(args.mailboxId, "mailbox id");
  const id = (key: string) => resourceId(args[key], key);
  switch (operation) {
    case "alias.create": {
      const part = String(args.localPart ?? "").toLowerCase();
      if (!LOCAL.test(part) || part.length > 50) throw new Error("invalid alias local part");
      return call(selected.token, `/mailboxes/${mailbox()}/aliases`, "POST", { local_part: part });
    }
    case "alias.delete": return call(selected.token, `/aliases/${id("aliasId")}`, "DELETE");
    case "forwarder.create": return call(selected.token, `/mailboxes/${mailbox()}/forwarders`, "POST", { destination: email(args.destination), is_keep_copy_enabled: args.keepCopy === true });
    case "forwarder.delete": return call(selected.token, `/forwarders/${id("forwarderId")}`, "DELETE");
    case "forwarder.resend": return call(selected.token, `/forwarders/${id("forwarderId")}/confirmation/resend`, "POST");
    case "forwarder.keep-copy": return call(selected.token, `/forwarders/${id("forwarderId")}/keep-copy`, "PATCH", { is_keep_copy_enabled: args.keepCopy === true });
    case "autoreply.create":
    case "autoreply.update": {
      const subject = String(args.subject ?? ""), body = String(args.body ?? "");
      if (!subject || subject.length > 500 || !body || body.length > 20_000) throw new Error("invalid autoreply content");
      const payload = { subject, body, ...(args.displayName ? { display_name: String(args.displayName).slice(0, 255) } : {}), ...(args.startsAt ? { starts_at: String(args.startsAt) } : {}), ...(args.endsAt ? { ends_at: String(args.endsAt) } : {}) };
      return operation.endsWith("create")
        ? call(selected.token, `/mailboxes/${mailbox()}/autoreplies`, "POST", payload)
        : call(selected.token, `/autoreplies/${id("autoreplyId")}`, "PUT", payload);
    }
    case "autoreply.delete": return call(selected.token, `/autoreplies/${id("autoreplyId")}`, "DELETE");
    case "catchall.create": return call(selected.token, `/mailboxes/${mailbox()}/catchalls`, "POST");
    case "catchall.delete": return call(selected.token, `/catchalls/${id("catchallId")}`, "DELETE");
    case "catchall.resend": return call(selected.token, `/catchalls/${id("catchallId")}/confirmation/resend`, "POST");
    case "mailbox.delete": return call(selected.token, `/mailboxes/${mailbox()}`, "DELETE");
    default: throw new Error("unsupported Hostinger Mail mutation");
  }
}
