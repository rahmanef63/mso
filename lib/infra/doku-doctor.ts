import { createHmac, randomUUID } from "node:crypto";
import { obj, request, TIMEOUT_MS } from "./http";

const present = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

function paymentBase(environment: string): string {
  if (environment === "sandbox") return "https://api-sandbox.doku.com";
  if (environment === "production") return "https://api.doku.com";
  throw new Error("DOKU Payment invalid environment");
}
function mcpEndpoint(environment: string): string {
  if (environment === "sandbox")
    return "https://api-sandbox.doku.com/doku-mcp-server/mcp";
  if (environment === "production") return "https://mcp.doku.com/mcp";
  throw new Error("DOKU MCP invalid environment");
}
function mcpInitializeResult(body: unknown, text: string): boolean {
  const direct = obj(body);
  if (
    direct.jsonrpc === "2.0" &&
    direct.id === "mso-doku-doctor" &&
    direct.result &&
    typeof direct.result === "object"
  )
    return true;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const event = obj(JSON.parse(line.slice(5).trim()));
      if (
        event.jsonrpc === "2.0" &&
        event.id === "mso-doku-doctor" &&
        event.result &&
        typeof event.result === "object"
      )
        return true;
    } catch {}
  }
  return false;
}
async function payment(values: Record<string, string>): Promise<string | null> {
  if (
    !present(values.paymentClientId) ||
    !present(values.paymentSecretKey) ||
    !present(values.paymentEnvironment)
  )
    return null;
  const invoice = `MSO-CRED-CHECK-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const target = `/orders/v1/status/${invoice}`,
    requestId = randomUUID(),
    timestamp = new Date().toISOString();
  const raw = `Client-Id:${values.paymentClientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${target}`;
  const signature = `HMACSHA256=${createHmac("sha256", values.paymentSecretKey).update(raw).digest("base64")}`;
  const url = `${paymentBase(values.paymentEnvironment)}${target}`;
  let response;
  try {
    response = await request(
      url,
      {
        headers: {
          "Client-Id": values.paymentClientId,
          "Request-Id": requestId,
          "Request-Timestamp": timestamp,
          Signature: signature,
          accept: "application/json",
        },
      },
      TIMEOUT_MS,
    );
  } catch {
    throw new Error("DOKU Payment request failed");
  }
  if (response.status === 404) {
    const transactionMissing =
      /transaction\s+not\s+found/i.test(response.text) ||
      /\b404\d*01\b/.test(response.text);
    if (!transactionMissing) throw new Error("DOKU Payment HTTP 404");
  } else if (!response.ok)
    throw new Error(`DOKU Payment HTTP ${response.status}`);
  return `authenticated; ${values.paymentEnvironment} signed status lookup verified`;
}
async function mcp(values: Record<string, string>): Promise<string | null> {
  if (
    !present(values.mcpClientId) ||
    !present(values.mcpApiKey) ||
    !present(values.environment)
  )
    return null;
  const url = mcpEndpoint(values.environment);
  let response;
  try {
    response = await request(
      url,
      {
        method: "POST",
        headers: {
          "Client-Id": values.mcpClientId,
          authorization: `Basic ${Buffer.from(`${values.mcpApiKey}:`).toString("base64")}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "mso-doku-doctor",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "mso-integration-doctor", version: "1" },
          },
        }),
      },
      TIMEOUT_MS,
    );
  } catch {
    throw new Error("DOKU MCP request failed");
  }
  if (!response.ok) throw new Error(`DOKU MCP HTTP ${response.status}`);
  if (!mcpInitializeResult(response.body, response.text))
    throw new Error("DOKU MCP invalid initialize response");
  return `authenticated; ${values.environment} MCP initialize verified`;
}
export const doctorDoku = (values: Record<string, string>) =>
  present(values.paymentClientId) || present(values.paymentSecretKey)
    ? payment(values)
    : mcp(values);
