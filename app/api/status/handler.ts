import os from "os";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { readRootList, writeRootList } from "@/lib/host/paths";

function accessPosture(req: NextRequest): { currentAccess: string; publicExposureWarning: string | null } {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const xff = req.headers.get("x-forwarded-for");
  const proto = req.headers.get("x-forwarded-proto");
  const h = host.toLowerCase();

  if (h.endsWith(".ts.net") || h.includes("tailnet")) {
    return { currentAccess: "Tailscale / private network", publicExposureWarning: null };
  }
  if (xff || proto) {
    return {
      currentAccess: "Reverse proxy",
      publicExposureWarning: "Confirm the proxy has HTTPS plus firewall, VPN, or an IP allowlist.",
    };
  }
  return {
    currentAccess: "Direct",
    publicExposureWarning: "Direct access detected. Do not expose the raw app port to the public internet.",
  };
}

export async function handleGetStatus(req: NextRequest): Promise<Response> {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    linuxUser: os.userInfo().username,
    readRoots: readRootList(),
    writeRoots: writeRootList(),
    ...accessPosture(req),
  });
}
