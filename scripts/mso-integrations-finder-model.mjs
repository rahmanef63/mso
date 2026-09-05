const clean = (v) => String(v ?? "").replace(/[\r\n\t]+/g, " ").trim();
const pick = (items, id) => items?.find((x) => x.id === id) ?? null;
const suffix = (id, prefix) => id?.startsWith(prefix) ? id.slice(prefix.length) : null;
export function context(stack = []) {
  const last = (prefix) => [...stack].reverse().map((x) => suffix(x, prefix)).find((x) => x !== null) ?? null;
  return { user:last("user:"), provider:last("provider:"), connection:last("connection:"), source:last("source:"), auth:last("auth:") };
}
const branch = (id,label,hint,preview=[]) => ({id,label,hint,preview,kind:"branch"});
const action = (id,label,hint,preview=[]) => ({id,label,hint,preview,kind:"action"});
function provider(snapshot,id){ return pick(snapshot.catalog,id); }
function connection(snapshot,user,p,c){ return snapshot.connections?.find((x)=>x.user===user&&x.provider===p&&x.id===c) ?? null; }
function userRow(snapshot,id){ return pick(snapshot.users,id); }
function sourceRow(snapshot,p,s){ return provider(snapshot,p)?.sources?.find((x)=>x.id===s) ?? null; }
function methodRow(snapshot,p,s,m){ return sourceRow(snapshot,p,s)?.methods?.find((x)=>x.id===m) ?? null; }
function providerItems(snapshot,user){
  return (snapshot.catalog||[]).map((p)=>{const count=(snapshot.connections||[]).filter((c)=>c.user===user&&c.provider===p.id).length;return branch(`provider:${p.id}`,p.title,`${count} connection(s)`,[p.description,`${p.sources?.length||0} source/backend option(s)`]);});
}
function connectionItems(snapshot,user,p){
  const rows=(snapshot.connections||[]).filter((c)=>c.user===user&&c.provider===p);
  return [...rows.map((c)=>branch(`connection:${c.id}`,c.label,`${c.source} · ${c.authMethod} · ${c.state}${c.isDefault?" · default":""}`,[`id: ${c.id}`,`scope: ${c.scope}`,`source: ${c.source}`,`auth: ${c.authMethod}`])),branch("new","＋ New connection","choose source/backend and auth")];
}
function newConnectionLayer(snapshot,p,stack){
  const ctx=context(stack), last=stack.at(-1);
  if(last==="new") return (provider(snapshot,p)?.sources||[]).map((s)=>branch(`source:${s.id}`,s.label,`${s.methods?.length||0} auth method(s)`,[s.description||"",s.reference||""]));
  if(ctx.source && last===`source:${ctx.source}`) return (sourceRow(snapshot,p,ctx.source)?.methods||[]).map((m)=>branch(`auth:${m.id}`,m.label,m.scope,[`scope: ${m.scope}`,`${m.fields?.length||0} credential field(s)`]));
  if(ctx.auth && last===`auth:${ctx.auth}`) return [action("action:create-connection","Create named connection","label + stable connection ID",[`source: ${ctx.source}`,`auth: ${ctx.auth}`,`scope: ${methodRow(snapshot,p,ctx.source,ctx.auth)?.scope||""}`])];
  return null;
}
function connectionActions(snapshot,user,p,c){
  const row=connection(snapshot,user,p,c); if(!row) return [];
  const out=[];
  if(row.source==="direct") out.push(action("action:setup","Set / rotate credentials","private browser form"));
  if(row.source==="composio") out.push(action("action:authorize","Authorize account","Composio hosted authorization"));
  out.push(action("action:verify","Verify","live API/auth status"),action("action:route","Route","show exact execution identity"));
  if(!row.isDefault) out.push(action("action:connection-default","Make default","provider fallback for this user"));
  if(p==="hostinger"&&row.source==="direct") out.push(branch("mail","Hostinger Mail","orders, mailboxes, aliases and logs"));
  out.push(action("action:connection-rename","Rename label","metadata only"),action("action:connection-delete","Delete connection","destructive; exact confirmation"));
  return out;
}
function mailLayer(stack){
  const last=stack.at(-1);
  if(last==="mail") return [action("action:mail-orders","Mail orders","list account mail orders"),...['mailboxes','aliases','forwarders','autoreplies','catchalls','webhooks'].map((x)=>action(`action:mail-resource:${x}`,x[0].toUpperCase()+x.slice(1),`list ${x}`)),branch("logs","Mail logs","access/action/inbound/mailbox/outbound")];
  if(last==="logs") return ['access','action','inbound','mailbox-actions','outbound'].map((x)=>action(`action:mail-log:${x}`,x.replace('-', ' '),`${x} log`));
  return null;
}
function userActions(snapshot,user){ const row=userRow(snapshot,user); return [branch("providers","Connections & providers","manage named accounts/deployments"),action("action:user-default","Set as default user","fallback when no folder mapping matches"),action("action:user-bind","Use for current folder","longest folder mapping wins"),action("action:user-rename","Rename user","preserve connections and folder mappings"),action("action:user-duplicate","Duplicate user","metadata by default"),action("action:user-delete","Delete user","destructive; exact confirmation")].map((x)=>({...x,preview:x.preview?.length?x.preview:[`user: ${row?.label||user}`]})); }
export function layer(snapshot, stack=[]){
  const last=stack.at(-1), ctx=context(stack);
  if(!last) return [branch("connections","Connections","User → Provider → Connection → Source → Auth"),branch("users","Credential users","isolated account owners"),branch("catalog","Provider catalog","sources, auth methods and scope"),action("action:current","Current folder","show resolved credential user/binding"),action("action:transfer","Import / export JSON","portable metadata or encrypted direct credentials"),action("action:quit","Quit","return to shell")];
  if(last==="connections"||last==="users") return [...(snapshot.users||[]).map((u)=>branch(`user:${u.id}`,u.label,`${u.connectionCount} connection(s)${u.isDefault?' · default':''}`,u.isDefault?["default credential user"]:[])),action("action:user-add","＋ Add user","new isolated credential owner")];
  if(last==="catalog") return (snapshot.catalog||[]).map((p)=>branch(`provider:${p.id}`,p.title,`${p.sources?.length||0} source(s)`,[p.description]));
  if(stack[0]==="catalog" && ctx.provider && last===`provider:${ctx.provider}`) return (provider(snapshot,ctx.provider)?.sources||[]).map((s)=>branch(`source:${s.id}`,s.label,`${s.methods?.length||0} method(s)`,[s.description||"",s.reference||""]));
  if(stack[0]==="catalog" && ctx.source && last===`source:${ctx.source}`) return (sourceRow(snapshot,ctx.provider,ctx.source)?.methods||[]).map((m)=>action("action:noop",m.label,`${m.scope} · ${m.fields?.length||0} field(s)`,(m.fields||[]).map((f)=>f.label||f.key)));
  if(ctx.user && last===`user:${ctx.user}`) return stack[0]==="users" ? userActions(snapshot,ctx.user) : providerItems(snapshot,ctx.user);
  if(last==="providers" && ctx.user) return providerItems(snapshot,ctx.user);
  if(ctx.provider && last===`provider:${ctx.provider}`){
    if(stack[0]==="catalog") return [];
    return connectionItems(snapshot,ctx.user,ctx.provider);
  }
  const fresh=newConnectionLayer(snapshot,ctx.provider,stack); if(fresh) return fresh;
  if(ctx.connection && last===`connection:${ctx.connection}`) return connectionActions(snapshot,ctx.user,ctx.provider,ctx.connection);
  const mail=mailLayer(stack); if(mail) return mail;
  return [];
}
export function labelFor(snapshot, id, stackPrefix=[]){
  const ctx=context([...stackPrefix,id]);
  if(id==="connections")return"Connections";if(id==="users")return"Credential users";if(id==="catalog")return"Provider catalog";if(id==="providers")return"Providers";if(id==="new")return"New connection";if(id==="mail")return"Hostinger Mail";if(id==="logs")return"Mail logs";
  if(id.startsWith("user:")) return userRow(snapshot,ctx.user)?.label||ctx.user;
  if(id.startsWith("provider:")) return provider(snapshot,ctx.provider)?.title||ctx.provider;
  if(id.startsWith("connection:")) return connection(snapshot,ctx.user,ctx.provider,ctx.connection)?.label||ctx.connection;
  if(id.startsWith("source:")) return sourceRow(snapshot,ctx.provider,ctx.source)?.label||ctx.source;
  if(id.startsWith("auth:")) return methodRow(snapshot,ctx.provider,ctx.source,ctx.auth)?.label||ctx.auth;
  return clean(id);
}
export function columns(snapshot,stack=[]){const out=[];for(let d=0;d<=stack.length;d++){const prefix=stack.slice(0,d);out.push({title:d?labelFor(snapshot,stack[d-1],prefix.slice(0,-1)):"Integrations",nodeId:d?stack[d-1]:"root",items:layer(snapshot,prefix),selectedId:d<stack.length?stack[d]:null});}return out;}
