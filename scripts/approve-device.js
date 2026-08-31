#!/usr/bin/env node
// Seed / list / revoke trusted login devices for mso (no Convex — flat JSON,
// same model as the VPS Control Room).
//
//   node scripts/approve-device.js <deviceId> [label] [--role viewer|operator|owner]
//   node scripts/approve-device.js --list               # show approved + pending
//   node scripts/approve-device.js --revoke <deviceId>  # un-trust a device
//
// Store path = ~/.mso/auth-devices.json unless OS_DEVICE_STORE is set (must
// match what the mso service sees).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { spawnSync } = require("child_process");
const { DEVICE_ROLES, normalizeApproved, parseApprovalArgs, roleOf, setRoleResult } = require("./lib/device-role-cli");

const STORE =
  process.env.OS_DEVICE_STORE || path.join(os.homedir(), ".mso", "auth-devices.json");
const DEVICE_ID_RE = /^[a-f0-9-]{16,128}$/i;

function read() {
  try {
    const p = JSON.parse(fs.readFileSync(STORE, "utf8"));
    const approved = normalizeApproved(p.approved);
    return { approved, pending: p.pending || {} };
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
const RECOVERY = `${LOCK}.recovery`;
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
  let fd;
  try {
    fd = fs.openSync(LOCK, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return false;
    const owner = fs.readFileSync(fd, "utf8");
    const pid = Number(owner.split(":", 1)[0]);
    if (Number.isInteger(pid) && pid > 1) return pidIsGone(pid);
    return Date.now() - st.mtimeMs > LOCK_STALE_MS;
  } catch (error) {
    if (error && error.code === "ENOENT") return true;
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}
function openExclusive(file, token) {
  // Publish only a fully-written owner record; linkSync is the atomic create point.
  const candidate = `${file}.${randomUUID()}.candidate`;
  let fd;
  try {
    fd = fs.openSync(candidate, "wx", 0o600);
    fs.writeFileSync(fd, token, "utf8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
  try { fs.linkSync(candidate, file); }
  finally { try { fs.unlinkSync(candidate); } catch {} }
  return { token };
}
function releaseLock(file, held) {
  let owner = "";
  try { owner = fs.readFileSync(file, "utf8"); } catch {}
  if (owner === held.token) { try { fs.unlinkSync(file); } catch {} }
}
function acquireLock() {
  fs.mkdirSync(path.dirname(STORE), { recursive: true, mode: 0o700 });
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    // Every process takes the recovery gate before inspecting or publishing LOCK.
    // This closes the stat/read/unlink ABA race where a stale recoverer could delete
    // a newly-created live lock at the same pathname.
    let gate;
    try { gate = openExclusive(RECOVERY, `${process.pid}:${randomUUID()}`); }
    catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
    }

    if (gate) {
      try {
        try { return openExclusive(LOCK, token); }
        catch (error) { if (!error || error.code !== "EEXIST") throw error; }

        if (abandonedLock()) {
          try { fs.unlinkSync(LOCK); }
          catch (error) { if (!error || error.code !== "ENOENT") throw error; }
          // Publish our owner record while the recovery gate is still held. Every
          // supported writer obeys this gate, so no contender can occupy the gap.
          try { return openExclusive(LOCK, token); }
          catch (error) { if (!error || error.code !== "EEXIST") throw error; }
        }
      } finally {
        // Never auto-break a recovery guard. A crash fails closed until manual
        // cleanup rather than risking a revocation-losing concurrent write.
        releaseLock(RECOVERY, gate);
      }
    }

    if (Date.now() >= deadline) throw new Error("security store is busy; retry the operation");
    sleep(LOCK_WAIT_MS);
  }
}

function withMutation(fn) {
  const held = acquireLock();
  try { return fn(); }
  finally { releaseLock(LOCK, held); }
}
const ts = (t) => (t ? new Date(t).toISOString() : "—");

// Two ways to act on a device: copy the bare id (compose your own command), or
// copy the whole line below it and paste it. JSON.stringify does the quoting, so
// a label containing a quote or a space still pastes as ONE argument.
const approveCmd = (id, label) => `    mso device approve ${id} ${JSON.stringify(label || "my device")} --role viewer`;
const revokeCmd = (id) => `    mso device revoke ${id}`;

// A live VNC WebSocket has already passed its session check, so changing the
// allowlist alone cannot evict it. The local CLI applies the same kill switch as
// the authenticated API. The binary override supports hermetic tests and unusual
// systemctl locations; the caller is already the host owner.
function terminateCamoufoxSessions() {
  const systemctl = process.env.MSO_SYSTEMCTL_BIN || "systemctl";
  const result = spawnSync(systemctl, ["--user", "stop", "camoufox-vnc.service"], {
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`device was revoked, but Camoufox session teardown failed (rc ${result.status}): ${(result.stderr || "").trim().slice(0, 160)}`);
  }
}

const listApproved = (ap) => {
  if (!ap.length) return void console.log("  (none)");
  for (const [id, d] of ap) {
    console.log(`  ${id}  "${d.label}"  role=${roleOf(d)} approved=${ts(d.approvedAt)} lastSeen=${ts(d.lastSeen)}`);
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


if (args[0] === "--set-role") {
  const result = setRoleResult({ args, deviceIdRe: DEVICE_ID_RE, withMutation, read, write });
  for (const line of result.lines) (result.error ? console.error : console.log)(line);
  process.exit(result.code);
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
  terminateCamoufoxSessions();
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
  terminateCamoufoxSessions();
  // Say what is left, so the obvious follow-up (`device list`) isn't needed — and
  // so revoking your last device is impossible to do without noticing.
  console.log(`revoked ${id}  "${label}"`);
  console.log(left ? `${left} device(s) still approved.` : "NO devices approved now — nothing can sign in until you approve one.");
  process.exit(0);
}

const { id, label, role } = parseApprovalArgs(args);
if (!id || !DEVICE_ID_RE.test(id) || !DEVICE_ROLES.has(role)) {
  console.error("usage: approve-device.js <deviceId> [label] [--role viewer|operator|owner] | --list | --set-role <id> <role> | --revoke <id>");
  console.error("deviceId must be 16-128 hex/uuid chars; role must be viewer, operator, or owner");
  process.exit(1);
}
const result = withMutation(() => {
  const store = read(), existing = store.approved[id];
  if (existing && roleOf(existing) !== role) throw new Error(`device is already approved as role=${roleOf(existing)}; use --set-role to change privileges`);
  if (existing) return { entry: existing, already: true };
  const pending = store.pending[id];
  store.approved[id] = {
    label: label !== "seeded device" ? label : (pending && pending.label) || label, approvedAt: Date.now(), role,
  };
  delete store.pending[id]; write(store);
  return { entry: store.approved[id], already: false };
});
console.log(`${result.already ? "already approved" : "approved"} ${id}  "${result.entry.label}"  role=${result.entry.role}`);
if (!result.already) console.log("-> that device can now sign in with the password.");
