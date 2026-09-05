import {beforeEach,afterEach,it,expect,vi} from 'vitest';import {NextRequest} from 'next/server';
import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';
import sample from '@/schemas/integration-bundle-example.json';
vi.mock('server-only',()=>({}));vi.mock('@/lib/host/audit-api',()=>({audit:vi.fn()}));
const auth=vi.hoisted(()=>({role:'owner' as string}));vi.mock('@/lib/auth/require-session',()=>({getSessionContext:async()=>({role:auth.role,session:{device_id:'test-device'}})}));
let root:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'mso-transfer-route-'));process.env.OS_INFRA_STORE=path.join(root,'infra.json');auth.role='owner';vi.resetModules()});
afterEach(async()=>{delete process.env.OS_INFRA_STORE;await fs.rm(root,{recursive:true,force:true});vi.resetModules()});
const req=(body:unknown)=>new NextRequest('https://mso.rahmanef.com/api/v1/integrations/transfer',{method:'POST',headers:{'content-type':'application/json',origin:'https://mso.rahmanef.com'},body:JSON.stringify(body)});
it('refuses non-owner export and import',async()=>{const {POST}=await import('./route');auth.role='viewer';expect((await POST(req({action:'export'}))).status).toBe(403);expect((await POST(req({action:'import',document:sample}))).status).toBe(403)});
it('supports preview then confirmed application and returns only safe summaries',async()=>{const {POST}=await import('./route');const r=await POST(req({action:'import',document:sample}));expect(r.status).toBe(200);const p=await r.json();expect(p.applied).toBeUndefined();const applied=await POST(req({action:'import',document:sample,apply:true,confirm:p.planId}));expect(applied.status).toBe(200);const exportResult=await POST(req({action:'export'}));expect((await exportResult.json()).bundle.mode).toBe('metadata');expect(exportResult.headers.get('cache-control')).toContain('no-store')});
it('rejects giant, malformed, or non-JSON bodies',async()=>{const {POST}=await import('./route');expect((await POST(req({action:'import',document:'x'.repeat(3*1024*1024)}))).status).toBe(413);const request=req({action:'export'});request.headers.set('content-type','text/plain');expect((await POST(request)).status).toBe(415);expect((await POST(req({action:'export',includeSecrets:'true'}))).status).toBe(400)});

it("returns the configured public entrypoint instead of a VPS loopback URL",async()=>{const {GET}=await import("./route");const r=await GET();expect(r.status).toBe(200);expect((await r.json()).url).toBe("https://mso.rahmanef.com/integrations?transfer=1");auth.role="viewer";expect((await GET()).status).toBe(403)});
