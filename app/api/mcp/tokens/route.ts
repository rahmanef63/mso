import { handleDeleteTokens, handleGetTokens, handlePostTokens } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request) { return handleGetTokens(req); }
export async function POST(req: Request) { return handlePostTokens(req); }
export async function DELETE(req: Request) { return handleDeleteTokens(req); }
