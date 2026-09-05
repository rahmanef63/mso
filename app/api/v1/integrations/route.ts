import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { readSetupJson } from "@/lib/infra/setup-http";
import { queryIntegrationAction, manageIntegrationAction, executeIntegrationAction } from "@/lib/infra/connection-dispatch";
import { IntegrationError } from "@/lib/infra/identity";
import { audit } from "@/lib/host/audit-api";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer"};
export async function GET(req:NextRequest){
  if((await getSessionContext())?.role!=="owner")return NextResponse.json({error:"owner_required"},{status:403,headers});
  try{return NextResponse.json(await queryIntegrationAction(Object.fromEntries(req.nextUrl.searchParams)),{headers});}catch(e){return failure(e);}
}
function failure(e:unknown){const error=e instanceof IntegrationError?e:new IntegrationError("integration_operation_failed",400);return NextResponse.json({error:error.code},{status:error.status,headers});}
export async function POST(req:NextRequest){
  const ctx=await getSessionContext();if(ctx?.role!=="owner")return NextResponse.json({error:"owner_required"},{status:403,headers});
  try{const {mode,...input}=await readSetupJson(req);if(!["manage","execute"].includes(String(mode)))throw new IntegrationError("invalid_action_mode");
    const result=mode==="manage"?await manageIntegrationAction(input):await executeIntegrationAction(input);
    void audit({action:"infra.write",actor:ctx.session.device_id,target:String(input.user??"integrations"),ok:true,detail:`integrations.${String(mode)}`});
    return NextResponse.json(result,{headers});
  }catch(e){return failure(e);}
}
