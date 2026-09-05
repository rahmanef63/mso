import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const readInfraProvider = vi.fn();
const request = vi.fn();
vi.mock("./store", () => ({ readInfraProvider }));
vi.mock("./http", () => ({ obj: (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>, request }));
const api = await import("./hostinger-mail");
const TOKEN = "synthetic-hostinger-account-token-000001";
const MAIL = "synthetic-hostinger-mail-token-00000001";
afterEach(() => { vi.clearAllMocks(); });
function response(body: unknown, status = 200) { return { ok: status >= 200 && status < 300, status, body, text: JSON.stringify(body) }; }
describe("Hostinger Mail client", () => {
  it("verifies an account token through the official Mail orders endpoint", async () => {
    request.mockResolvedValue(response({ data: [{ id: "ORdemo" }], meta: { total: 1 } }));
    expect(await api.doctorHostingerMail({ apiToken: TOKEN })).toContain("1 mail order");
    expect(request.mock.calls[0][0]).toBe("https://developers.hostinger.com/api/mail/v1/orders?per_page=1");
    expect(request.mock.calls[0][1].headers.authorization).toBe(`Bearer ${TOKEN}`);
  });
  it("binds a scoped Mail token to its stored mail order", async () => {
    readInfraProvider.mockResolvedValue({ mailApiToken: MAIL, mailOrderId: "ORdemo" });
    request.mockResolvedValue(response({ data: [{ id: "ACdemo" }], meta: { total: 1 } }));
    await api.listHostingerMail(undefined, "mailboxes");
    expect(request.mock.calls[0][0]).toContain("/orders/ORdemo/mailboxes?page=1&per_page=100");
    await expect(api.listHostingerMail("ORother", "mailboxes")).rejects.toThrow("does not match");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("requires an account token to enumerate mail orders", async () => {
    readInfraProvider.mockResolvedValue({ mailApiToken: MAIL, mailOrderId: "ORdemo" });
    await expect(api.listHostingerMailOrders()).rejects.toThrow("account API token required");
    expect(request).not.toHaveBeenCalled();
  });
  it("only permits documented list/log resources", async () => {
    readInfraProvider.mockResolvedValue({ apiToken: TOKEN }); request.mockResolvedValue(response({ data: [] }));
    await api.listHostingerMail("ORdemo", "aliases", 2);
    await api.listHostingerMailLogs("ORdemo", "outbound", 3);
    expect(request.mock.calls[0][0]).toContain("/orders/ORdemo/aliases?page=2&per_page=100");
    expect(request.mock.calls[1][0]).toContain("/orders/ORdemo/logs/outbound?page=3&per_page=100");
    await expect(api.listHostingerMail("ORdemo", "messages")).rejects.toThrow("unsupported");
  });
  it("uses exact documented mutation routes and refuses secret-returning/unreviewed operations", async () => {
    readInfraProvider.mockResolvedValue({ apiToken: TOKEN }); request.mockResolvedValue(response({ id: "AA1" }, 201));
    await api.mutateHostingerMail("alias.create", { orderId: "ORdemo", mailboxId: "ACdemo", localPart: "support" });
    expect(request.mock.calls[0][0]).toContain("/mailboxes/ACdemo/aliases");
    expect(request.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ local_part: "support" });
    await expect(api.mutateHostingerMail("mailbox.create", { orderId: "ORdemo" })).rejects.toThrow("unsupported");
    await expect(api.mutateHostingerMail("webhook.create", { orderId: "ORdemo" })).rejects.toThrow("unsupported");
    await expect(api.mutateHostingerMail("api-token.create", { orderId: "ORdemo" })).rejects.toThrow("unsupported");
  });
});
it("fails closed for a rejected scoped Mail token instead of treating it as merely unverified", async () => {
  request.mockResolvedValue(response({}, 403));
  await expect(api.doctorHostingerMail({ mailApiToken: MAIL, mailOrderId: "ORdemo" })).rejects.toThrow("HTTP 403");
});
it("advertises scoped Mail credentials as mail-order scope instead of account scope", async () => {
  const { connectionMethod } = await import("./connection-registry");
  expect(connectionMethod("hostinger", "direct", "mail").scope).toBe("mail-order");
  expect(connectionMethod("hostinger", "direct", "direct").scope).toBe("account");
});
