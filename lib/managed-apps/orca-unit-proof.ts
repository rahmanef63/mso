import "server-only";
import path from "node:path";
import { renderUnitText, systemdQuote } from "../../scripts/orca/unit-render.mjs";
import { ORCA_UNIT_MARKER, readTrustedConfig } from "./orca-unit-files";

export { ORCA_UNIT_MARKER, ownerUidMatches, readOrcaUnitText } from "./orca-unit-files";

const SERVICE_NAME = "mso-orca.service";
const CONTROL = /[\0\r\n]/;

/**
 * Exact proof that a unit file is the MSO-owned Orca USER unit.
 *
 * Ownership is granted only when the on-disk text is byte-for-byte the unit the
 * real installer renders from the trusted `managed-service.json` receipt. That
 * single comparison covers required sections/directives, `WorkingDirectory`,
 * `User`, `EnvironmentFile` (never rendered), duplicate sections, `Exec*` hooks,
 * runtime flags, the 1..65535 port, and the mandatory advertised endpoint.
 *
 * The expected `hostNode` is the exact launcher recorded by the installer, not
 * `release.nodeBinary` (the pinned child runtime) and not a basename guess.
 */
export type OrcaUnitProof = "owned" | "reinstall-required" | "not-owned";

/** Diagnostic-only shape check. This never grants ownership; it only lets the
 *  consumer say "old MSO unit, reinstall" instead of "foreign unit". */
function looksLikeMsoUnit(text: string, root: string, cliScript: string): boolean {
  if (!text.startsWith(`${ORCA_UNIT_MARKER}\n`)) return false;
  return text.includes(` ${systemdQuote(cliScript)} "run" "--managed-root" ${systemdQuote(root)}`);
}

export async function proveOwnedOrcaUnit(text: string, root: string, cliScript: string): Promise<OrcaUnitProof> {
  if (typeof text !== "string" || !path.isAbsolute(cliScript) || CONTROL.test(cliScript)) return "not-owned";
  const read = await readTrustedConfig(root);
  if (read.state === "missing" || read.state === "stale") {
    return looksLikeMsoUnit(text, root, cliScript) ? "reinstall-required" : "not-owned";
  }
  if (read.state !== "ok" || read.config.cliScript !== cliScript) return "not-owned";
  const { config } = read;
  const expected = renderUnitText({
    marker: ORCA_UNIT_MARKER,
    serviceName: SERVICE_NAME,
    hostNode: config.hostNode,
    cliScript,
    managedRoot: config.managedRoot,
    port: config.port,
    advertisedEndpoint: config.advertisedEndpoint
  });
  return text === expected ? "owned" : "not-owned";
}

export async function isOwnedOrcaUnit(text: string, root: string, cliScript: string): Promise<boolean> {
  return (await proveOwnedOrcaUnit(text, root, cliScript)) === "owned";
}
