import { readRequestJson, RequestBodyError } from "@/lib/security/request-body";
import { SetupError, SETUP_MAX_BODY } from "./setup-capability";
export async function readSetupJson(req: Request, maxBytes = SETUP_MAX_BODY): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) throw new SetupError("invalid_body_limit", 400);
  if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new SetupError("json_required", 415);
  try { return await readRequestJson(req, maxBytes); }
  catch (error) { throw new SetupError(error instanceof RequestBodyError ? error.message : "invalid_request", error instanceof RequestBodyError ? error.status : 400); }
}
