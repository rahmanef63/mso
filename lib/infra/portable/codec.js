'use strict';
// integration-bundle v1 reference codec. Pure protocol code; no application store imports.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const FORMAT = 'integration-bundle', ENCRYPTED = FORMAT + '.encrypted', MAX_BYTES = 2 * 1024 * 1024;
const AAD = Buffer.from(ENCRYPTED + ':1:scrypt-32768-8-1:aes-256-gcm');
class BundleError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new BundleError(code); };
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('invalid_bundle_shape');
}
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) || ['constructor','prototype','__proto__'].includes(value)) fail('invalid_bundle_identity'); return value; }
function text(value,max=120) { if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))fail('invalid_bundle_text');return value; }
function validate(payload, allowSecrets=false) {
  exact(payload,['format','version','producer','exportedAt','mode','users']);
  if(payload.format!==FORMAT||payload.version!==1)fail('unsupported_bundle_version');
  exact(payload.producer,['name','version']);text(payload.producer.name,64);text(payload.producer.version,64);
  if(typeof payload.exportedAt!=='string'||!Number.isFinite(Date.parse(payload.exportedAt)))fail('invalid_export_date');
  if(!['metadata','secrets'].includes(payload.mode)||(!allowSecrets&&payload.mode!=='metadata'))fail('plaintext_credentials_forbidden');
  if(!Array.isArray(payload.users)||payload.users.length>100)fail('bundle_user_limit');
  const seen=new Set();let count=0;
  for(const user of payload.users){
    exact(user,['id','label','connections']);id(user.id);text(user.label);if(seen.has(user.id))fail('duplicate_bundle_user');seen.add(user.id);
    if(!Array.isArray(user.connections)||(count+=user.connections.length)>1000)fail('bundle_connection_limit');
    const connections=new Set();
    for(const c of user.connections){
      exact(c,['id','label','provider','source','authMethod','scope','fields','values']);
      id(c.id);id(c.provider);id(c.authMethod);text(c.label);text(c.scope,64);
      if(!['direct','composio','native-mcp'].includes(c.source))fail('invalid_bundle_source');
      const ref=c.provider+'/'+c.id;if(connections.has(ref))fail('duplicate_bundle_connection');connections.add(ref);
      if(!Array.isArray(c.fields)||c.fields.length>64)fail('bundle_field_limit');const keys=new Set();
      for(const f of c.fields){exact(f,['key','secret','configured']);if(typeof f.key!=='string'||!/^[A-Z][A-Z0-9_]{1,127}$/.test(f.key)||keys.has(f.key)||typeof f.secret!=='boolean'||typeof f.configured!=='boolean')fail('invalid_bundle_field');keys.add(f.key);}
      if(c.values!==undefined){
        if(!allowSecrets||payload.mode!=='secrets'||c.source!=='direct')fail('plaintext_or_external_credentials_forbidden');
        exact(c.values,[...keys]);for(const v of Object.values(c.values))if(typeof v!=='string'||v.length>4096||/[\x00-\x1f\x7f]/.test(v))fail('invalid_bundle_value');
      }
    }
  }
  if(Buffer.byteLength(JSON.stringify(payload))>MAX_BYTES)fail('bundle_too_large');return payload;
}
function depthCheck(value){
  const stack=[[value,0]];let nodes=0;
  while(stack.length){const [v,depth]=stack.pop();if(depth>12||++nodes>100000)fail('bundle_structure_limit');if(v&&typeof v==='object')for(const child of Object.values(v))stack.push([child,depth+1]);}
}
function parse(input){
  if(typeof input==='string'){
    if(Buffer.byteLength(input)>MAX_BYTES)fail('bundle_too_large');
    let depth=0,quoted=false,escaped=false;
    for(const ch of input){if(escaped){escaped=false;continue}if(quoted&&ch==='\\'){escaped=true;continue}if(ch==='"'){quoted=!quoted;continue}if(!quoted&&(ch==='{'||ch==='[')&&++depth>12)fail('bundle_structure_limit');if(!quoted&&(ch==='}'||ch===']'))depth--;}
    let result;try{result=JSON.parse(input)}catch{fail('invalid_json')}depthCheck(result);return result;
  }
  depthCheck(input);if(!input||Buffer.byteLength(JSON.stringify(input))>MAX_BYTES)fail('bundle_too_large');return input;
}
function pass(value){if(typeof value!=='string'||Buffer.byteLength(value)<12||Buffer.byteLength(value)>1024)fail('passphrase_minimum_12_bytes');return value;}
function base64(value,size){if(typeof value!=='string'||value.length>MAX_BYTES||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('invalid_envelope');const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value||(size&&bytes.length!==size))fail('invalid_envelope');return bytes;}
async function seal(payload,passphrase){
  validate(payload,true);pass(passphrase);
  const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=await scrypt(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  const plain=Buffer.from(JSON.stringify(payload));try{const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(AAD);const data=Buffer.concat([cipher.update(plain),cipher.final()]);
    const envelope={format:ENCRYPTED,version:1,kdf:{name:'scrypt',N:32768,r:8,p:1,salt:salt.toString('base64')},cipher:{name:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64')},data:data.toString('base64')};
    if(Buffer.byteLength(JSON.stringify(envelope))>MAX_BYTES)fail('bundle_too_large');return envelope;
  }finally{key.fill(0);plain.fill(0)}
}
async function open(input,passphrase){
  const d=parse(input);if(!d||typeof d!=='object'||Array.isArray(d))fail('invalid_bundle_shape');if(d.format!==ENCRYPTED)return validate(d,false);
  exact(d,['format','version','kdf','cipher','data']);exact(d.kdf,['name','N','r','p','salt']);exact(d.cipher,['name','iv','tag']);
  if(d.version!==1||d.kdf.name!=='scrypt'||d.kdf.N!==32768||d.kdf.r!==8||d.kdf.p!==1||d.cipher.name!=='aes-256-gcm')fail('unsupported_encryption');
  const salt=base64(d.kdf.salt,16),iv=base64(d.cipher.iv,12),tag=base64(d.cipher.tag,16),data=base64(d.data);pass(passphrase);
  const key=await scrypt(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});let plain;
  try{const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(AAD);decipher.setAuthTag(tag);try{plain=Buffer.concat([decipher.update(data),decipher.final()])}catch{fail('wrong_passphrase_or_tampered_bundle')}
    return validate(parse(plain.toString('utf8')),true);
  }finally{key.fill(0);plain?.fill(0)}
}
function payload(producer,users,mode='metadata'){return validate({format:FORMAT,version:1,producer,exportedAt:new Date().toISOString(),mode,users},mode==='secrets');}
module.exports={FORMAT,ENCRYPTED,MAX_BYTES,BundleError,id,validate,parse,seal,open,payload};
