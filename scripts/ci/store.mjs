import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, writeFile, rename, readFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
export async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
    throw new Error('CI state must be an owner-private non-symlink directory');
  }
}
export async function createRun(stateRoot) {
  await privateDirectory(stateRoot);
  const root = join(stateRoot, 'runs');
  await privateDirectory(root);
  const runId = randomUUID();
  const path = join(root, runId);
  await mkdir(path, { mode: 0o700 });
  return { runId, path };
}
export async function saveReport(runPath, report) {
  const tmp = join(runPath, `.report-${randomUUID()}.tmp`);
  const handle = await open(tmp, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await rename(tmp, join(runPath, 'report.json'));
}
export async function acquireLocks(stateRoot, repositoryIdentity, runId) {
  const root = join(stateRoot, 'locks');
  await privateDirectory(root);
  const key = createHash('sha256').update(repositoryIdentity).digest('hex').slice(0, 32);
  const owned = [];
  async function release() {
    for (const path of owned.reverse()) {
      const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
      if (owner.runId !== runId) throw new Error('CI lock ownership changed; refusing cleanup');
      await unlink(join(path, 'owner.json'));
      await rmdir(path);
    }
  }
  try {
    for (const name of ['host', `repo-${key}`]) {
      const path = join(root, name);
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, 'owner.json'), JSON.stringify({ runId, pid: process.pid }), { flag: 'wx', mode: 0o600 });
      owned.push(path);
    }
    return release;
  } catch (error) {
    await release();
    if (error.code === 'EEXIST') throw new Error('CI runner lock busy; no job started. Stale locks require owner review.');
    throw error;
  }
}
