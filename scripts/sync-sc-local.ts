/** Explicit owner-local migration: bun scripts/sync-sc-local.ts --source /installed/sc [--apply]. */
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readIntegrationState, mutateIntegrationState, INFRA_STORE_PATH } from '../lib/infra/connection-storage';
import { syncScIn, type ScInput, type ScRow } from '../lib/infra/sc-sync';
import { IntegrationError } from '../lib/infra/identity';
async function main(){
  const args=process.argv.slice(2),source=args[args.indexOf('--source')+1];
  if(args.indexOf('--source')<0||!path.isAbsolute(source)||args.some(a=>a!==source&&!['--source','--apply'].includes(a)))throw new IntegrationError('usage_source_absolute_path_required');
  const root=await fs.realpath(source),stat=await fs.stat(root);if(stat.uid!==process.getuid?.()||(stat.mode&0o002))throw new IntegrationError('unsafe_sc_source');
  const require=createRequire(path.join(root,'package.json'));
  const c=require('./lib/connections.js'),p=require('./lib/profiles.js'),{withStateLock}=require('./lib/portability/state-lock.js');
  const input:ScInput=withStateLock(()=>{
    const users=p.listProfiles().map((id:string)=>({id,label:p.profileOwner(id)||id}));
    // Refuse to silently lose legacy fields. Use SC's own migration first when present.
    if(users.some((u:{id:string})=>Object.keys(p.readProfile(u.id)).length))throw new IntegrationError('sc_legacy_migration_required');
    return{users,rows:users.flatMap((u:{id:string})=>c.list(u.id).map((r:ScRow)=>({...r,values:c.readValues(r.user,r.provider,r.id)})))};
  });
  const before=await readIntegrationState(),preview=syncScIn(structuredClone(before),input);
  if(!args.includes('--apply')){console.log(JSON.stringify({mode:'preview',...preview}));return;}
  const result=await mutateIntegrationState(async state=>{
    const result=syncScIn(structuredClone(state),input);
    const backup=`${INFRA_STORE_PATH}.sc-sync-${Date.now()}.backup`;
    await fs.writeFile(backup,JSON.stringify(state),{mode:0o600,flag:'wx'});
    syncScIn(state,input);return result;
  });
  const proof=syncScIn(structuredClone(await readIntegrationState()),input);
  if(proof.results.some(r=>r.action==='filled'))throw new IntegrationError('sc_sync_readback_failed');
  console.log(JSON.stringify({mode:'applied',readback:true,...result}));
}
main().catch(e=>{console.error(JSON.stringify({error:e instanceof IntegrationError?e.code:'sc_sync_failed_no_values_logged'}));process.exitCode=1;});
