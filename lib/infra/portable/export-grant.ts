import { createHash, randomBytes } from "node:crypto";
import { constantTimeEq, MAX_COMPARE_BYTES } from "@/lib/auth/session";
import { rateLimited } from "@/lib/host/rate-limit";
import { IntegrationError } from "../identity";
import { normalizeTransferSelection } from "./selection";

const TTL_MS=90_000,MAX_GRANTS=128;
const grants=new Map<string,{actor:string;selectionHash:string;expires:number}>();
function selectionHash(value:unknown){return createHash("sha256").update(JSON.stringify(normalizeTransferSelection(value)??null)).digest("hex");}
function prune(){const now=Date.now();for(const[token,row]of grants)if(row.expires<=now)grants.delete(token);while(grants.size>=MAX_GRANTS)grants.delete(grants.keys().next().value!);}
export function authorizeRawCredentialExport(actor:string,password:unknown,selection:unknown){
  const configured=process.env.OS_LOGIN_PASSWORD??"",candidate=typeof password==="string"&&password&&Buffer.byteLength(password,"utf8")<=MAX_COMPARE_BYTES?password:null;
  const valid=Boolean(candidate)&&configured.length>=6&&Buffer.byteLength(configured,"utf8")<=MAX_COMPARE_BYTES&&constantTimeEq(configured,candidate!);
  if(!valid){if(rateLimited(`integration.raw-export.reauth:${actor}`,5,60_000))throw new IntegrationError("reauth_rate_limited",429);throw new IntegrationError("bad_password",401);}
  prune();const grant=randomBytes(32).toString("base64url");grants.set(grant,{actor,selectionHash:selectionHash(selection),expires:Date.now()+TTL_MS});return{grant,expiresInSeconds:TTL_MS/1000};
}
export function consumeRawCredentialExportGrant(actor:string,grant:unknown,selection:unknown){
  if(typeof grant!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(grant))throw new IntegrationError("raw_export_reauth_required",401);
  const row=grants.get(grant);grants.delete(grant);
  if(!row||row.expires<=Date.now()||row.actor!==actor||row.selectionHash!==selectionHash(selection))throw new IntegrationError("raw_export_reauth_required",401);
}
