import { it, expect } from 'vitest';
import { syncScIn, type ScRow } from './sc-sync';
import { emptyIntegrationState, resolveSharedConnection } from './identity';
// Deterministic in-memory fixtures, never provider credentials.
const fixtureValue=(label:string)=>`synthetic-${label.repeat(24)}`;
const row=(user='alice',id='main'):ScRow=>({user,id,provider:'composio',label:id,source:'sc',authMethod:'project-api-key',isDefault:true,values:{COMPOSIO_API_KEY:fixtureValue('a')}});
const input=(rows:ScRow[])=>({users:[...new Set(rows.map(r=>r.user))].map(id=>({id,label:id})),rows});
it('imports all users with strict isolation, no secret output, and idempotent repeat',()=>{
 const s=emptyIntegrationState(),a=row(),b={...row('bob'),values:{COMPOSIO_API_KEY:fixtureValue('b')}};
 const out=syncScIn(s,input([a,b]));expect(JSON.stringify(out)).not.toContain('synthetic');expect(s.users.alice.connections.composio.main.values.apiKey).toBe(a.values.COMPOSIO_API_KEY);expect(s.users.bob.connections.composio.main.values.apiKey).toBe(b.values.COMPOSIO_API_KEY);
 const snapshot=JSON.stringify(s);expect(syncScIn(s,input([a,b])).results.every(r=>r.action==='unchanged')).toBe(true);expect(JSON.stringify(s)).toBe(snapshot);
});
it('fills metadata-only connections and preserves conflicting credentials/defaults',()=>{
 const s=emptyIntegrationState(),a=row();syncScIn(s,input([{...a,values:{}}]));expect(syncScIn(s,input([a])).results[0].action).toBe('filled');
 const before=s.users.alice.connections.composio.main.values.apiKey;
 const other={...a,values:{COMPOSIO_API_KEY:fixtureValue('c')}};expect(syncScIn(s,input([other])).results[0].connection).toBe('sc-main');expect(s.users.alice.connections.composio.main.values.apiKey).toBe(before);expect(s.users.alice.defaults.composio).toBe('main');
 expect(()=>syncScIn(s,input([{...other,values:{COMPOSIO_API_KEY:fixtureValue('d')}}]))).toThrow('sc_sync_conflicting_alias');
});
it('preserves shared aliases and resolves backing collisions without copying credentials',()=>{
 const s=emptyIntegrationState(),a=row(),shared={...row('bob'),sharedFrom:{user:'alice',provider:'composio',connection:'main'}};
 syncScIn(s,input([shared,a]));const alias=s.users.bob.connections.composio.main;expect(alias.values).toEqual({});expect(resolveSharedConnection(s,'bob',alias).connection).toBe(s.users.alice.connections.composio.main);
 expect(syncScIn(s,input([shared,a])).results.every(r=>r.action==='unchanged')).toBe(true);
});
it('maps old DOKU checkout and MCP client identifiers to separate methods',()=>{
 const s=emptyIntegrationState(),base={...row(),provider:'doku'};
 syncScIn(s,input([{...base,id:'checkout',authMethod:'checkout-rest',values:{DOKU_CLIENT_ID:'client123',DOKU_SECRET_KEY:'synthetic-secret'}},{...base,id:'mcp',authMethod:'mcp-api-key',values:{DOKU_CLIENT_ID:'client456',DOKU_MCP_API_KEY:'synthetic-mcp-key',DOKU_MCP_ENV:'production'}}]));
 expect(s.users.alice.connections.doku.checkout.authMethod).toBe('payment');expect(s.users.alice.connections.doku.checkout.values.paymentClientId).toBe('client123');expect(s.users.alice.connections.doku.mcp.values.mcpClientId).toBe('client456');expect(s.users.alice.connections.doku.mcp.values.paymentClientId).toBeUndefined();
});
it('fails closed for unmapped values, external credentials, missing shares and active leases',()=>{
 const a=row();expect(()=>syncScIn(emptyIntegrationState(),input([{...a,values:{UNKNOWN:'secret'}}]))).toThrow('sc_sync_unmapped_field');
 expect(()=>syncScIn(emptyIntegrationState(),input([{...a,source:'composio'}]))).toThrow('sc_sync_external_requires_reauthorization');
 expect(()=>syncScIn(emptyIntegrationState(),input([{...a,sharedFrom:{user:'missing',provider:'composio',connection:'main'}}]))).toThrow('sc_sync_missing_shared_backing');
 const s=emptyIntegrationState();syncScIn(s,input([{...a,values:{}}]));s.users.alice.connections.composio.main.lease={id:'busy',until:Date.now()+60000};expect(()=>syncScIn(s,input([a]))).toThrow('connection_busy');
});
