import {MSO_ORIGIN} from "@/lib/mcp/ui-config";
import {NextRequest,NextResponse} from 'next/server';
import {getSessionContext} from '@/lib/auth/require-session';
import {audit} from '@/lib/host/audit-api';
import {exportIntegrationData,importIntegrationData,type TransferOptions} from '@/lib/infra/portable/data';
import {authorizeRawCredentialExport,consumeRawCredentialExportGrant} from '@/lib/infra/portable/export-grant';
import {exportRawCredentials,exportSelectionTree,type RawCredentialFormat} from '@/lib/infra/portable/raw-export';
import {transferBody} from '@/lib/infra/portable/http';
import {BundleError} from '@/lib/infra/portable/codec.js';
import {IntegrationError} from '@/lib/infra/identity';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','Pragma':'no-cache','Expires':'0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
let active=0,windowAt=0,requests=0;
export async function GET(){
  if((await getSessionContext())?.role!=="owner")return NextResponse.json({error:"owner_required"},{status:403,headers});
  return NextResponse.json({url:MSO_ORIGIN+"/integrations?transfer=1",format:"integration-bundle",version:1},{headers});
}
export async function POST(req:NextRequest){
  const ctx=await getSessionContext();if(ctx?.role!=='owner')return NextResponse.json({error:'owner_required'},{status:403,headers});
  if(Date.now()-windowAt>60000){windowAt=Date.now();requests=0}
  if(active>=2||++requests>30)return NextResponse.json({error:'transfer_rate_limited'},{status:429,headers});
  active++;let action='unknown';
  try{
    const body=await transferBody(req);action=String(body.action??'');const options=body as TransferOptions;
    if(action==='tree')return NextResponse.json(await exportSelectionTree(),{headers});
    if(action==='authorize-raw-export'){
      const result=authorizeRawCredentialExport(ctx.session.device_id??'unknown',body.password,body.selection);
      void audit({action:'infra.write',actor:ctx.session.device_id,target:'integrations',ok:true,detail:'transfer.raw.reauth'});
      return NextResponse.json(result,{headers});
    }
    if(action==='export-raw'){
      const format=body.format;if(format!=='json'&&format!=='env')throw new IntegrationError('invalid_raw_export_format');
      consumeRawCredentialExportGrant(ctx.session.device_id??'unknown',body.grant,body.selection);
      const file=await exportRawCredentials(body.selection,format as RawCredentialFormat);
      void audit({action:'infra.write',actor:ctx.session.device_id,target:'integrations',ok:true,detail:`transfer.raw.${format}.${file.connectionCount}`});
      return new NextResponse(file.content,{headers:{...headers,'Content-Type':file.contentType,'Content-Disposition':`attachment; filename="${file.filename}"`,'X-MSO-Credential-Export':'plaintext'}});
    }
    let result;
    if(action==='export')result={bundle:await exportIntegrationData(options)};
    else if(action==='import')result=await importIntegrationData(body.document,options);
    else throw new IntegrationError('invalid_transfer_action');
    void audit({action:'infra.write',actor:ctx.session.device_id,target:'integrations',ok:true,detail:`transfer.${action}.${body.apply?'apply':'prepare'}`});
    return NextResponse.json(result,{headers});
  }catch(e){
    const status=e instanceof IntegrationError?e.status:400,error=e instanceof IntegrationError||e instanceof BundleError?e.message:'transfer_failed';
    if(action==='authorize-raw-export')void audit({action:'infra.write',actor:ctx.session.device_id,target:'integrations',ok:false,detail:`transfer.raw.reauth.${error}`});
    return NextResponse.json({error},{status,headers});
  }finally{active--;}
}
