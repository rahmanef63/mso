import { NextRequest } from "next/server";
import { handleDeleteThreads, handleGetThreads, handlePatchThreads, handlePostThreads } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) { return handleGetThreads(req); }
export async function POST(req: NextRequest) { return handlePostThreads(req); }
export async function DELETE(req: NextRequest) { return handleDeleteThreads(req); }
export async function PATCH(req: NextRequest) { return handlePatchThreads(req); }
