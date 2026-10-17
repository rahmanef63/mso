import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ManagedDomainRoute } from "@/lib/contracts/managed-domains";
import { childEnv } from "@/lib/host/child-env";
import { redactText } from "@/lib/security/redact-text";

const execute = promisify(execFile);

async function gatewayRoute(action: "inspect" | "ensure", input: ManagedDomainRoute): Promise<{ action: "created" | "unchanged" }> {
  try {
    const result = await execute(path.join(process.cwd(), "scripts", "mso-gateway"), ["app-route", action, input.hostname, input.tunnelId], {
      cwd: process.cwd(), encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024,
      env: { ...(childEnv() as NodeJS.ProcessEnv), MSO_GATEWAY_ROOT: process.cwd(), MSO_GATEWAY_ENV: process.env.MSO_DOMAIN_ENV ?? path.join(process.cwd(), ".env.local"), MSO_GATEWAY_LOCAL_URL: input.localOrigin,
        MSO_GATEWAY_EXPECT_PUBLIC_ORIGIN: `https://${input.cockpitHostname}`,
        MSO_GATEWAY_EXPECT_APP_HOST_TEMPLATE: input.hostTemplate ?? "",
      },
    });
    const value = JSON.parse(result.stdout);
    if (value.hostname !== input.hostname || value.tunnelId !== input.tunnelId || !["created", "unchanged"].includes(value.action)) throw new Error("gateway returned an invalid app-route receipt");
    return { action: value.action };
  } catch (error) {
    const detail = error as Error & { stderr?: string };
    throw new Error(`MSO-owned named tunnel: ${redactText(detail.stderr?.trim() || detail.message || "route operation failed", 512)}`);
  }
}

export async function inspectManagedDomainGateway(input: ManagedDomainRoute): Promise<void> {
  await gatewayRoute("inspect", input);
}
export function ensureManagedDomainGateway(input: ManagedDomainRoute): Promise<{ action: "created" | "unchanged" }> {
  return gatewayRoute("ensure", input);
}
