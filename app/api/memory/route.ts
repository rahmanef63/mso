import { NextRequest } from "next/server";
import { handleDeleteMemory, handleGetMemory, handlePostMemory } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() { return handleGetMemory(); }
export async function POST(req: NextRequest) { return handlePostMemory(req); }
export async function DELETE(req: NextRequest) { return handleDeleteMemory(req); }
