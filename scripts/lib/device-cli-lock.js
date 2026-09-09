const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

// Process ownership and stale-lock recovery shared by device mutations.
exports.deviceMutationLock = function deviceMutationLock(storePath) {
const LOCK = `${storePath}.lock`;
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
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
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


return { acquireLock, releaseLock, LOCK };
};
