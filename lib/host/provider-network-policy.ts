import { isIP } from "node:net";

// This code classifies a refusal; it never grants a server-side network request.
export const PRIVATE_ROUTE_CODE = "MSO_DEPLOYMENT_PRIVATE_ROUTE";
export function isDeploymentPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return isIP(address) === 6 && /^f[cd][0-9a-f]{2}:/i.test(address);
}
export function providerNetworkRefusal(message: string, privateRoute = false): Error {
  return Object.assign(new Error(message), { code: privateRoute ? PRIVATE_ROUTE_CODE : "MSO_FORBIDDEN_PROVIDER_ENDPOINT" });
}
