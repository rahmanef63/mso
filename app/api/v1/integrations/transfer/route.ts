import {MSO_ORIGIN} from "@/lib/mcp/ui-config";
import {NextRequest,NextResponse} from 'next/server';
import {getSessionContext} from '@/lib/auth/require-session';
import {audit} from '@/lib/host/audit-api';
import {exportIntegrationData,importIntegrationData,type TransferOptions} from '@/lib/infra/portable/data';
import {transferBody} from '@/lib/infra/portable/http';
import {BundleError} from '@/lib/infra/portable/codec.js';
import {IntegrationError} from '@/lib/infra/identity';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
let active=0,windowAt=0,requests=0;
export async function GET(){
  if((await getSessionContext())?.role!=="owner")return NextResponse.json({error:"owner_required"},{status:403,headers});
  return NextResponse.json({url:MSO_ORIGIN+"/integrations?transfer=1",format:"integration-bundle",version:1},{headers});
}
export async function POST(req:NextRequest){
  const ctx=await getSessionContext();if(ctx?.role!=='owner')return NextResponse.json({error:'owner_required'},{status:403,headers});
  if(Date.now()-windowAt>60000){windowAt=Date.now();requests=0}
  if(active>=2||++requests>20)return NextResponse.json({error:'transfer_rate_limited'},{status:429,headers});
  active++;
  try{
    const body=await transferBody(req);const options=body as TransferOptions;
    let result;
    if(body.action==='export')result={bundle:await exportIntegrationData(options)};
    else if(body.action==='import')result=await importIntegrationData(body.document,options);
    else throw new IntegrationError('invalid_transfer_action');
    void audit({action:'infra.write',actor:ctx.session.device_id,target:'integrations',ok:true,detail:`transfer.${body.action}.${body.apply?'apply':'prepare'}`});
    return NextResponse.json(result,{headers});
  }catch(e){const status=e instanceof IntegrationError?e.status:400;const error=e instanceof IntegrationError||e instanceof BundleError?e.message:'transfer_failed';return NextResponse.json({error},{status,headers});}
  finally{active--;}
}
