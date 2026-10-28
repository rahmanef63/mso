import { NextRequest } from "next/server";
import { handleWorkflowWebhook } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HookContext = { params: Promise<{ hook: string[] }> };
// Next requires the handler to be exported under its HTTP verb name, so the five
// verbs are declared explicitly rather than generated: a computed export would
// satisfy the type checker but Next's route manifest reads the module statically.
export const GET = (req: NextRequest, ctx: HookContext) => handleWorkflowWebhook(req, ctx);
export const POST = (req: NextRequest, ctx: HookContext) => handleWorkflowWebhook(req, ctx);
export const PUT = (req: NextRequest, ctx: HookContext) => handleWorkflowWebhook(req, ctx);
export const PATCH = (req: NextRequest, ctx: HookContext) => handleWorkflowWebhook(req, ctx);
export const DELETE = (req: NextRequest, ctx: HookContext) => handleWorkflowWebhook(req, ctx);
