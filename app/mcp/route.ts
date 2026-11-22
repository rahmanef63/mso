import { handleDeleteMcp, handleGetMcp, handleOptionsMcp, handlePostMcp, MAX_MCP_BODY_BYTES } from "./handler";

export { MAX_MCP_BODY_BYTES };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) { return handlePostMcp(req); }
export async function GET(req: Request) { return handleGetMcp(req); }
export async function OPTIONS(req: Request) { return handleOptionsMcp(req); }
export async function DELETE() { return handleDeleteMcp(); }
