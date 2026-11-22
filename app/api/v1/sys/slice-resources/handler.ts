import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { knownSliceDirectories } from "@/lib/resources/slices";
import { aggregateSliceUsage, LEDGER_CAPACITY } from "@/lib/resources/ledger";
import { buildResourceReport, worstOffenders } from "@/lib/resources/report";
import { documentedOnlySlices, instrumentedSlices } from "@/lib/resources/attribution";
import { ENFORCEMENT_ENV, ENFORCEMENT_SCOPE, sliceResourceEnforcementEnabled } from "@/lib/resources/policy";

const headers = { "Cache-Control": "private, no-store" };

/**
 * GET /api/v1/sys/slice-resources — per-slice budget vs actual.
 *
 * Auth follows the neighbours exactly: `verifyAuth` runs the default-deny role
 * policy in lib/agent/server.ts, so this route is owner-only (it is not in
 * VIEWER_READ_PATHS and its path is unclassified, which fails up to owner). That is
 * the correct ceiling: the report names the owner's own operational cost profile.
 *
 * Scope is the whole installation, deliberately. MSO has no per-org or per-tenant
 * resource ledger — tenancy is a source-only preview seam (OS_TENANCY_MODE) and the
 * capability ledger is process-global, so a tenant-scoped view would be a fiction.
 * The report says so in `scope` rather than implying isolation it cannot provide.
 */
export async function handleGetSliceResources(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const context = await getSessionContext();
  if (context?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403 });

  const { buckets, dropped } = aggregateSliceUsage();
  const report = buildResourceReport({
    knownSlices: knownSliceDirectories(),
    buckets,
    droppedSamples: dropped,
    bufferCapacity: LEDGER_CAPACITY,
  });

  return NextResponse.json(
    {
      ...report,
      worst: worstOffenders(report),
      coverage: {
        slicesOnDisk: report.slices.length + report.unaccountedSlices.length,
        registered: report.slices.length,
        /** Slices whose capability calls record real ledger samples. */
        instrumented: instrumentedSlices().length,
        /** Slices documented by an owning route but not measured by the kernel. */
        documentedOnly: documentedOnlySlices(),
        detail: "Registration is complete for every slice on disk. Measurement is partial: a slice with no attributed capability call reports declared budgets with not-instrumented actuals.",
      },
      scope: {
        kind: "installation",
        detail: "The capability ledger is process-global. There is no per-organization or per-tenant resource accounting in MSO, so this report cannot be narrowed to one.",
      },
      enforcement: {
        enabled: sliceResourceEnforcementEnabled(),
        setting: ENFORCEMENT_ENV,
        applies_to: ENFORCEMENT_SCOPE,
        detail: "Reporting is always on. Refusal is off unless the operator sets this variable to 1.",
      },
    },
    { headers },
  );
}
