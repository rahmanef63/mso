import { NextRequest } from "next/server";
import { handleGetSetup, handleOptionsSetup, handlePostSetup } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() { return handleGetSetup(); }
export function OPTIONS(req: NextRequest) { return handleOptionsSetup(req); }
export async function POST(req: NextRequest) { return handlePostSetup(req); }
