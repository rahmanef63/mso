import {MAX_BYTES} from './codec.js';
import {IntegrationError} from '../identity';
export async function transferBody(req:Request):Promise<Record<string,unknown>>{
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new IntegrationError('json_required',415);
  if(Number(req.headers.get('content-length'))>MAX_BYTES+16384)throw new IntegrationError('bundle_too_large',413);
  const reader=req.body?.getReader();if(!reader)throw new IntegrationError('invalid_transfer_request');let bytes=0;const chunks:Uint8Array[]=[];
  try{for(;;){let timer:ReturnType<typeof setTimeout>|undefined;const r=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new IntegrationError('request_timeout',408)),5000)})]).finally(()=>clearTimeout(timer));if(r.done)break;bytes+=r.value.byteLength;if(bytes>MAX_BYTES+16384)throw new IntegrationError('bundle_too_large',413);chunks.push(r.value);}
    let b;try{b=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new IntegrationError('invalid_json')}
    const allowed=['action','document','users','includeSecrets','passphrase','prefix','policy','apply','confirm','acceptWarnings'];
    if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!allowed.includes(k)))throw new IntegrationError('invalid_transfer_request');
    for(const k of ['apply','includeSecrets','acceptWarnings'])if(b[k]!==undefined&&typeof b[k]!=='boolean')throw new IntegrationError('invalid_transfer_request');
    for(const k of ['passphrase','confirm','prefix','policy'])if(b[k]!==undefined&&typeof b[k]!=='string')throw new IntegrationError('invalid_transfer_request');
    return b;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
