#!/usr/bin/env node
// Seed / list / revoke trusted login devices for mso (no Convex — flat JSON,
// same model as the VPS Control Room).
//
//   node scripts/approve-device.js <deviceId> [label]   # approve a device
//   node scripts/approve-device.js --list               # show approved + pending
//   node scripts/approve-device.js --revoke <deviceId>  # un-trust a device
//
// Store path = ~/.mso/auth-devices.json unless OS_DEVICE_STORE is set (must
// match what the mso service sees).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");

const STORE =
  process.env.OS_DEVICE_STORE || path.join(os.homedir(), ".mso", "auth-devices.json");
const DEVICE_ID_RE = /^[a-f0-9-]{16,128}$/i;

function read() {
  try {
    const p = JSON.parse(fs.readFileSync(STORE, "utf8"));
    return { approved: p.approved || {}, pending: p.pending || {} };
  } catch (error) {
    if (error && error.code === "ENOENT") return { approved: {}, pending: {} };
    throw error;
  }
}
function write(store) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true, mode: 0o700 });
  const tmp = `${STORE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE);
}

// The web process edits the same allowlist. Lock the full read-modify-write so a
// local revoke cannot be overwritten by a concurrent login `lastSeen` touch. The
// lock owner is recorded so a crashed helper/server is recoverable without turning
// a stale file into a permanent authentication outage.
const LOCK = `${STORE}.lock`;
const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 3000;
const LOCK_STALE_MS = 30000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms) { Atomics.wait(sleeper, 0, 0, ms); }
function pidIsGone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error && error.code === "ESRCH"; }
}
function abandonedLock() {
  try {
    const st = fs.statSync(LOCK);
    let owner = "";
    try { owner = fs.readFileSync(LOCK, "utf8"); } catch {}
    const pid = Number(owner.split(":", 1)[0]);
    if (Number.isInteger(pid) && pid > 1) return pidIsGone(pid);
    return Date.now() - st.mtimeMs > LOCK_STALE_MS;
  } catch (error) {
    if (error && error.code === "ENOENT") return true;
    throw error;
  }
}
function acquireLock() {
  fs.mkdirSync(path.dirname(STORE), { recursive: true, mode: 0o700 });
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const fd = fs.openSync(LOCK, "wx", 0o600);
      try { fs.writeFileSync(fd, token, "utf8"); }
      catch (error) { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(LOCK); } catch {} throw error; }
      return { fd, token };
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      if (abandonedLock()) { try { fs.unlinkSync(LOCK); } catch {} continue; }
      if (Date.now() >= deadline) throw new Error("security store is busy; retry the operation");
      sleep(LOCK_WAIT_MS);
    }
  }
}
function withMutation(fn) {
  const held = acquireLock();
  try { return fn(); }
  finally {
    try { fs.closeSync(held.fd); } catch {}
    let owner = "";
    try { owner = fs.readFileSync(LOCK, "utf8"); } catch {}
    if (owner === held.token) { try { fs.unlinkSync(LOCK); } catch {} }
  }
}
const ts = (t) => (t ? new Date(t).toISOString() : "—");

// Two ways to act on a device: copy the bare id (compose your own command), or
// copy the whole line below it and paste it. JSON.stringify does the quoting, so
// a label containing a quote or a space still pastes as ONE argument.
const approveCmd = (id, label) => `    mso device approve ${id} ${JSON.stringify(label || "my device")}`;
const revokeCmd = (id) => `    mso device revoke ${id}`;

const listApproved = (ap) => {
  if (!ap.length) return void console.log("  (none)");
  for (const [id, d] of ap) {
    console.log(`  ${id}  "${d.label}"  approved=${ts(d.approvedAt)} lastSeen=${ts(d.lastSeen)}`);
    console.log(revokeCmd(id));
  }
};
const listPending = (pd) => {
  if (!pd.length) return void console.log("  (none)");
  for (const [id, d] of pd) {
    console.log(`  ${id}  "${d.label}"  ip=${d.ip} attempts=${d.attempts} last=${ts(d.lastSeen)}`);
    console.log(approveCmd(id, d.label));
  }
};

const args = process.argv.slice(2);

if (args[0] === "--list") {
  const s = read();
  console.log(`store: ${STORE}\n\nAPPROVED:`);
  listApproved(Object.entries(s.approved));
  console.log("\nPENDING (typed correct password, awaiting approval):");
  listPending(Object.entries(s.pending));
  process.exit(0);
}

if (args[0] === "--pending") {
  const s = read();
  console.log(`store: ${STORE}\n\nPENDING (typed correct password, awaiting approval):`);
  listPending(Object.entries(s.pending));
  process.exit(0);
}

if (args[0] === "--revoke-all") {
  // Locks every browser out at once. Recoverable — approving is a local file
  // write that needs no session — but the confirmation is not optional, because
  // this is one keystroke away from `--revoke <id>`.
  const s = read();
  const ids = Object.keys(s.approved);
  if (!ids.length) { console.log("nothing to revoke — no approved devices"); process.exit(0); }
  const confirm = args[1];
  if (confirm !== "--yes" && confirm !== "-y") {
    console.error(`refusing: this revokes ALL ${ids.length} approved devices and signs every browser out.`);
    // Naming what they actually typed: "-yes" and "--yes" are one character apart
    // and a bare "re-run with --yes" leaves them re-reading their own line.
    if (confirm) console.error(`(you passed "${confirm}" — the flag is --yes or -y)`);
    console.error("re-run with --yes if that is what you want. Re-approve later with:");
    console.error("  mso device approve <deviceId> \"label\"");
    process.exit(1);
  }
  const revokedIds = withMutation(() => {
    const current = read();
    const currentIds = Object.keys(current.approved);
    current.approved = {};
    write(current);
    return currentIds;
  });
  console.log(`revoked ${revokedIds.length} device(s):`);
  for (const id of revokedIds) console.log(`  ${id}`);
  console.log("\nno device can sign in until you approve one again.");
  process.exit(0);
}

if (args[0] === "--revoke") {
  const id = args[1];
  if (!id) { console.error("usage: --revoke <deviceId>"); process.exit(1); }
  const result = withMutation(() => {
    const s = read();
    if (!s.approved[id]) return null;
    const label = s.approved[id].label;
    delete s.approved[id];
    write(s);
    return { label, left: Object.keys(s.approved).length };
  });
  if (!result) {
    console.error(`not approved: ${id}`);
    if (id === "all") console.error("to revoke every device: mso device revoke all --yes");
    process.exit(1);
  }
  const { label, left } = result;
  // Say what is left, so the obvious follow-up (`device list`) isn't needed — and
  // so revoking your last device is impossible to do without noticing.
  console.log(`revoked ${id}  "${label}"`);
  console.log(left ? `${left} device(s) still approved.` : "NO devices approved now — nothing can sign in until you approve one.");
  process.exit(0);
}

const id = args[0];
const label = args.slice(1).join(" ") || "seeded device";
if (!id || !DEVICE_ID_RE.test(id)) {
  console.error("usage: approve-device.js <deviceId> [label] | --list | --revoke <id>");
  console.error("deviceId must be 16-128 hex/uuid chars");
  process.exit(1);
}
const approvedLabel = withMutation(() => {
  const store = read();
  const pending = store.pending[id];
  store.approved[id] = {
    label: label !== "seeded device" ? label : (pending && pending.label) || label,
    approvedAt: Date.now(),
  };
  delete store.pending[id];
  write(store);
  return store.approved[id].label;
});
console.log(`approved ${id}  "${approvedLabel}"`);
console.log("-> that device can now sign in with the password.");
