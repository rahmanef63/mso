import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';
import sample from '@/schemas/integration-bundle-example.json';
vi.mock('server-only',()=>({}));
let root:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'mso-transfer-'));process.env.OS_INFRA_STORE=path.join(root,'infra.json');vi.resetModules()});
afterEach(async()=>{delete process.env.OS_INFRA_STORE;await fs.rm(root,{recursive:true,force:true});vi.resetModules()});
const KEY='synthetic-transfer-test-key',PASS='long-synthetic-passphrase';
it('previews SC format without writing and imports mapped identities, not role/default settings',async()=>{
  const api=await import('./data'),{readIntegrationState}=await import('../connection-storage');
  const preview=await api.importIntegrationData(sample);expect(preview.createUsers).toEqual([{id:'sample-user',label:'Sample owner'}]);
  await expect(fs.stat(process.env.OS_INFRA_STORE!)).rejects.toMatchObject({code:'ENOENT'});
  await api.importIntegrationData(sample,{apply:true,confirm:preview.planId});const state=await readIntegrationState();
  expect(state.defaultUser).toBeNull();expect(state.bindings).toEqual([]);expect(state.users['sample-user'].defaults).toEqual({});
  expect(state.users['sample-user'].connections.github.work.authMethod).toBe('direct');expect(state.users['sample-user'].connections.github.work.values).toEqual({});
});
it('uses a keyed preview confirmation instead of exposing a plain digest of imported values',async()=>{
  const codec=await import('./codec.js'),api=await import('./data'),{readIntegrationState}=await import('../connection-storage');
  const payload=codec.validate({...structuredClone(sample),mode:'secrets'},true);payload.users[0].connections[0].values={GITHUB_TOKEN:KEY,GH_OWNER:'sample-org'};
  const envelope=await codec.seal(payload,PASS),preview=await api.importIntegrationData(envelope,{passphrase:PASS}),state=await readIntegrationState();
  const plain=createHash('sha256').update(JSON.stringify([payload,'','skip',state.users,state.defaultUser,state.bindings])).digest('hex');
  expect(preview.planId).toMatch(/^[a-f0-9]{64}$/);expect(preview.planId).not.toBe(plain);
  expect((await api.importIntegrationData(envelope,{passphrase:PASS})).planId).toBe(preview.planId);
});
it('roundtrips encrypted direct fields and rejects incorrect passphrase without mutation',async()=>{
  const codec=await import('./codec.js'),api=await import('./data'),{readIntegrationState}=await import('../connection-storage');
  const payload=codec.validate({...structuredClone(sample),mode:'secrets'},true);payload.users[0].connections[0].values={GITHUB_TOKEN:KEY,GH_OWNER:'sample-org'};
  const envelope=await codec.seal(payload,PASS);expect(JSON.stringify(envelope)).not.toContain(KEY);
  await expect(api.importIntegrationData(envelope,{passphrase:'not-the-right-passphrase'})).rejects.toThrow('wrong_passphrase');
  const p=await api.importIntegrationData(envelope,{passphrase:PASS});await api.importIntegrationData(envelope,{passphrase:PASS,apply:true,confirm:p.planId});
  const state=await readIntegrationState(),c=state.users['sample-user'].connections.github.work;expect(c.values).toEqual({apiKey:KEY,owner:'sample-org'});expect(c.verifiedAt).toBeUndefined();
  const exported=await api.exportIntegrationData({includeSecrets:true,passphrase:PASS});const restored=await codec.open(exported,PASS);expect(restored.users[0].connections[0].values).toEqual(payload.users[0].connections[0].values);
  expect((await fs.stat(process.env.OS_INFRA_STORE!)).mode&0o777).toBe(0o600);
});
it('rejects unencrypted secret fields and stale previews',async()=>{
  const api=await import('./data');const plaintext=structuredClone(sample) as unknown as Record<string,unknown>;plaintext.mode='secrets';await expect(api.importIntegrationData(plaintext)).rejects.toThrow('plaintext');
  const p=await api.importIntegrationData(sample);await api.importIntegrationData(sample,{apply:true,confirm:p.planId});await expect(api.importIntegrationData(sample,{apply:true,confirm:p.planId})).rejects.toThrow('destination_changed');
});
it('requires explicit review for conflicting or unsupported entries and preserves destination values',async()=>{
  const api=await import('./data');let p=await api.importIntegrationData(sample);await api.importIntegrationData(sample,{apply:true,confirm:p.planId});p=await api.importIntegrationData(sample);expect(p.connections[0].status).toBe('skip');await expect(api.importIntegrationData(sample,{apply:true,confirm:p.planId})).rejects.toThrow('accept_import_warnings');
  expect((await api.importIntegrationData(sample,{policy:'error'})).canApply).toBe(false);
  const unknown=structuredClone(sample);unknown.users[0].connections[0].provider='uninstalled-provider';const u=await api.importIntegrationData(unknown,{prefix:'copy-'});expect(u.warnings[0].reason).toBe('unsupported_provider_or_method');
});
it('resets external authorization instead of copying session identifiers',async()=>{
  const api=await import('./data'),{readIntegrationState}=await import('../connection-storage');const bundle=structuredClone(sample);Object.assign(bundle.users[0].connections[0],{source:'composio',authMethod:'oauth2',fields:[]});
  const p=await api.importIntegrationData(bundle);expect(p.requiresWarningAcceptance).toBe(true);await api.importIntegrationData(bundle,{apply:true,confirm:p.planId,acceptWarnings:true});const c=(await readIntegrationState()).users['sample-user'].connections.github.work;expect(c.source).toBe('composio');expect(c.external).toBeUndefined();expect(c.values).toEqual({});
});
