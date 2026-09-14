import {beforeEach,afterEach,it,expect,vi} from 'vitest';import {NextRequest} from 'next/server';
import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';
import sample from '@/schemas/integration-bundle-example.json';
vi.mock('server-only',()=>({}));const audit=vi.hoisted(()=>({write:vi.fn()}));vi.mock('@/lib/host/audit-api',()=>({audit:audit.write}));
const auth=vi.hoisted(()=>({role:'owner' as string}));vi.mock('@/lib/auth/require-session',()=>({getSessionContext:async()=>({role:auth.role,session:{device_id:'test-device'}})}));
let root:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'mso-transfer-route-'));process.env.OS_INFRA_STORE=path.join(root,'infra.json');process.env.OS_PUBLIC_ORIGIN='https://mso.example.test';process.env.OS_LOGIN_PASSWORD='fixture-owner-password';auth.role='owner';audit.write.mockReset();vi.resetModules()});
afterEach(async()=>{delete process.env.OS_INFRA_STORE;delete process.env.OS_PUBLIC_ORIGIN;delete process.env.OS_LOGIN_PASSWORD;await fs.rm(root,{recursive:true,force:true});vi.resetModules()});
const req=(body:unknown)=>new NextRequest('https://mso.example.test/api/v1/integrations/transfer',{method:'POST',headers:{'content-type':'application/json',origin:'https://mso.example.test'},body:JSON.stringify(body)});
it('refuses non-owner export and import',async()=>{const {POST}=await import('./route');auth.role='viewer';expect((await POST(req({action:'export'}))).status).toBe(403);expect((await POST(req({action:'import',document:sample}))).status).toBe(403)});
it('supports preview then confirmed application and returns only safe summaries',async()=>{const {POST}=await import('./route');const r=await POST(req({action:'import',document:sample}));expect(r.status).toBe(200);const p=await r.json();expect(p.applied).toBeUndefined();const applied=await POST(req({action:'import',document:sample,apply:true,confirm:p.planId}));expect(applied.status).toBe(200);const exportResult=await POST(req({action:'export'}));expect((await exportResult.json()).bundle.mode).toBe('metadata');expect(exportResult.headers.get('cache-control')).toContain('no-store')});
it('rejects giant, malformed, or non-JSON bodies',async()=>{const {POST}=await import('./route');expect((await POST(req({action:'import',document:'x'.repeat(3*1024*1024)}))).status).toBe(413);const request=req({action:'export'});request.headers.set('content-type','text/plain');expect((await POST(request)).status).toBe(415);expect((await POST(req({action:'export',includeSecrets:'true'}))).status).toBe(400)});

it("returns the configured public entrypoint instead of a VPS loopback URL",async()=>{const {GET}=await import("./route");const r=await GET();expect(r.status).toBe(200);expect((await r.json()).url).toBe("https://mso.example.test/integrations?transfer=1");auth.role="viewer";expect((await GET()).status).toBe(403)});

it('requires fresh owner password for a one-time raw download and keeps secrets out of metadata/audit',async()=>{
  const codec=await import('@/lib/infra/portable/codec.js'),{POST}=await import('./route');const secret='synthetic-raw-export-secret-123456';
  const payload=codec.validate({...structuredClone(sample),mode:'secrets'},true);payload.users[0].connections[0].values={GITHUB_TOKEN:secret,GH_OWNER:'sample-org'};const envelope=await codec.seal(payload,'bundle-passphrase');
  const preview=await (await POST(req({action:'import',document:envelope,passphrase:'bundle-passphrase'}))).json();expect((await POST(req({action:'import',document:envelope,passphrase:'bundle-passphrase',apply:true,confirm:preview.planId}))).status).toBe(200);
  const tree=await (await POST(req({action:'tree'}))).json();expect(JSON.stringify(tree)).not.toContain(secret);const selection=[{user:'sample-user',provider:'github',connection:'work'}];
  expect((await POST(req({action:'authorize-raw-export',password:'wrong-password',selection}))).status).toBe(401);const authorized=await POST(req({action:'authorize-raw-export',password:'fixture-owner-password',selection}));expect(authorized.status).toBe(200);const grant=(await authorized.json()).grant;expect(grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const raw=await POST(req({action:'export-raw',grant,format:'env',selection}));expect(raw.status).toBe(200);expect(raw.headers.get('content-disposition')).toContain('.env');expect(raw.headers.get('cache-control')).toContain('no-store');expect(raw.headers.get('x-mso-credential-export')).toBe('plaintext');expect(await raw.text()).toContain(secret);
  expect((await POST(req({action:'export-raw',grant,format:'env',selection}))).status).toBe(401);expect(JSON.stringify(audit.write.mock.calls)).not.toContain(secret);expect(JSON.stringify(audit.write.mock.calls)).not.toContain('fixture-owner-password');
});
