import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const loadModule = createRequire(import.meta.url);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function reject(message) { throw new Error(message); }
function hostname(value) {
  return typeof value === 'string' && value.length <= 253 && value.split('.').length > 1 &&
    value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function appHosts(template) {
  if (!template) return [];
  if (!template.startsWith('{id}') || template.split('{id}').length !== 2) reject('invalid managed app host template');
  const hosts = ['hermes', 'openclaw', '9router'].map((id) => template.replace('{id}', id));
  if (!hosts.every(hostname)) reject('invalid managed app host template');
  return hosts;
}
function readConfig(root, file) {
  const YAML = loadModule(path.join(root, 'node_modules/yaml'));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let stat, text;
  try {
    stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o022)) reject('unsafe named tunnel config');
    if (stat.size > 1024 * 1024) reject('named tunnel config is too large');
    text = fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
  const doc = YAML.parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) reject('invalid named tunnel YAML');
  const cfg = doc.toJS({ maxAliasCount: 10 });
  if (!object(cfg)) reject('invalid named tunnel config');
  return { doc, cfg, text, stat };
}
function validateConfig(cfg, file, publicOrigin, localOrigin, template, exact = false) {
  const publicHost = new URL(publicOrigin).hostname;
  const local = new URL(localOrigin), allowed = new Set(appHosts(template));
  if (allowed.has(publicHost)) reject('managed app host collides with cockpit');
  const rules = cfg.ingress;
  if (!Array.isArray(rules) || rules.length < 2 || rules.length > 5) reject('named config requires cockpit and exact managed app ingress');
  const last = rules.at(-1);
  if (!object(last) || Object.keys(last).some((key) => key !== 'service') || last.service !== 'http_status:404') reject('named config must end in http_status:404');
  const seen = new Set();
  for (const [index, rule] of rules.slice(0, -1).entries()) {
    if (!object(rule) || typeof rule.hostname !== 'string') reject('invalid exact ingress host');
    const host = rule.hostname.toLowerCase();
    if ((index === 0 && host !== publicHost) || (index > 0 && !allowed.has(host)) || seen.has(host)) reject('unrelated or duplicate ingress host');
    if (rule.path !== undefined) reject('path-limited ingress is not a managed application route');
    seen.add(host);
    let service;
    try { service = new URL(rule.service); } catch { reject('invalid ingress service'); }
    const octets = service.hostname.split('.');
    const loopback = ['localhost', '[::1]'].includes(service.hostname) ||
      (octets.length === 4 && octets[0] === '127' && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255));
    if (service.protocol !== 'http:' || !loopback || service.port !== local.port || service.pathname !== '/' ||
      service.username || service.password || service.search || service.hash || ((index > 0 || exact) && service.origin !== local.origin)) reject('ingress must target the selected MSO loopback origin');
    for (const request of [cfg.originRequest, rule.originRequest]) {
      if (request !== undefined && !object(request)) reject('invalid originRequest');
    }
    const override = rule.originRequest?.httpHostHeader ?? cfg.originRequest?.httpHostHeader;
    if (override !== undefined && (typeof override !== 'string' || override.toLowerCase() !== host)) reject('ingress Host override would bypass managed app routing');
  }
  let cred = cfg['credentials-file'];
  if (typeof cred !== 'string' || !cred.trim()) reject('named config requires credentials-file');
  cred = cred.trim();
  if (cred.startsWith('~/')) cred = path.join(process.env.HOME || '', cred.slice(2));
  if (!path.isAbsolute(cred)) cred = path.resolve(path.dirname(file), cred);
  const st = fs.lstatSync(cred);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077)) reject('credentials-file must be private and owner-owned');
}
function atomicReplace(file, snapshot, text) {
  const current = fs.lstatSync(file);
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== snapshot.stat.dev || current.ino !== snapshot.stat.ino ||
    current.mode !== snapshot.stat.mode || fs.readFileSync(file, 'utf8') !== snapshot.text) reject('named tunnel config changed concurrently');
  const temp = path.join(path.dirname(file), `.mso-app-route-${process.pid}-${randomBytes(6).toString('hex')}`);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, snapshot.stat.mode & 0o777);
  try {
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function execute(args) {
  const [root, file, publicOrigin, localOrigin, template, action = 'validate', host, tunnelId] = args;
  const snapshot = readConfig(root, file);
  validateConfig(snapshot.cfg, file, publicOrigin, localOrigin, template, action !== 'validate');
  if (action === 'validate') return;
  if (!['inspect', 'ensure'].includes(action) || !appHosts(template).includes(host)) reject('unknown managed app hostname or operation');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(tunnelId) || snapshot.cfg.tunnel !== tunnelId) reject('named tunnel UUID does not match the requested tunnel');
  const exists = snapshot.cfg.ingress.some((rule) => rule.hostname?.toLowerCase() === host);
  let text = snapshot.text;
  if (!exists && action === 'ensure') {
    const rule = { hostname: host, service: localOrigin };
    if (snapshot.cfg.originRequest?.httpHostHeader !== undefined) rule.originRequest = { httpHostHeader: host };
    const node = snapshot.doc.createNode(rule);
    snapshot.doc.get('ingress', true).items.splice(snapshot.cfg.ingress.length - 1, 0, node);
    validateConfig(snapshot.doc.toJS({ maxAliasCount: 10 }), file, publicOrigin, localOrigin, template, true);
    text = String(snapshot.doc);
    atomicReplace(file, snapshot, text);
  }
  return { action: exists ? 'unchanged' : 'created', tunnelId, hostname: host, configSha256: createHash('sha256').update(text).digest('hex') };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = execute(process.argv.slice(2)); if (result) process.stdout.write(JSON.stringify(result) + '\n'); }
  catch (error) { process.stderr.write(`mso gateway: ${error.code ? 'cannot safely read named config or credential metadata' : error.message}\n`); process.exitCode = 1; }
}
export { appHosts, readConfig, validateConfig, atomicReplace, execute };
