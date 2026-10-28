import { NextRequest } from "next/server";
import { handleGetInfraProviders, handlePostInfraProviders, handleDeleteInfraProviders } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) => handleGetInfraProviders(req);
export const POST = (req: NextRequest) => handlePostInfraProviders(req);
export const DELETE = (req: NextRequest) => handleDeleteInfraProviders(req);
