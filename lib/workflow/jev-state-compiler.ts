import { createHash } from "node:crypto";
import { redactText } from "@/lib/security/redact-text";

const SECRET_KEY=/(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|credential|cookie)/i;
const MAX_DEPTH=6,MAX_ARRAY=32,MAX_KEYS=48,MAX_STRING=2_000,MAX_BYTES=24*1024;

function bounded(value:unknown,depth=0):unknown{
  if(depth>MAX_DEPTH)return "[depth-limit]";
  if(typeof value==="string")return redactText(value,MAX_STRING);
  if(typeof value==="number"||typeof value==="boolean"||value==null)return value;
  if(Array.isArray(value))return value.slice(0,MAX_ARRAY).map(item=>bounded(item,depth+1));
  if(typeof value!=="object")return String(value).slice(0,MAX_STRING);
  const out:Record<string,unknown>={};
  for(const [key,item] of Object.entries(value as Record<string,unknown>).slice(0,MAX_KEYS)){
    if(SECRET_KEY.test(key))continue;
    out[key.slice(0,120)]=bounded(item,depth+1);
  }
  return out;
}
export function compileJevState(value:unknown):Record<string,unknown>{
  const clean=bounded(value);
  const object=clean&&typeof clean==="object"&&!Array.isArray(clean)?clean as Record<string,unknown>:{value:clean};
  const json=JSON.stringify(object);
  if(Buffer.byteLength(json,"utf8")<=MAX_BYTES)return object;
  return {
    bounded:true,
    sha256:createHash("sha256").update(json).digest("hex"),
    preview:redactText(json,MAX_BYTES-256),
  };
}
export function estimateJevTokens(value:unknown):number{
  try{return Math.ceil(Buffer.byteLength(JSON.stringify(value),"utf8")/4);}catch{return 0;}
}
