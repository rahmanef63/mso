import { NextRequest } from "next/server";
import { handleDeleteConfig, handleGetConfig, handlePostConfig } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() { return handleGetConfig(); }
export async function POST(req: NextRequest) { return handlePostConfig(req); }
export async function DELETE(req: NextRequest) { return handleDeleteConfig(req); }
