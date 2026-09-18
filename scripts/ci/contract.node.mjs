import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { planFor, verdict, exitFor } from './plan.mjs';
import { executeStep, childEnvironment } from './process.mjs';
import { acquireLocks, privateDirectory } from './store.mjs';
import { runPipeline, inspectRepository } from './runner.mjs';
const sha = 'a'.repeat(40);
async function fixture(fn) {
  const path = await mkdtemp(join(tmpdir(), 'mso-ci-test-'));
  try { return await fn(path); } finally { await rm(path, { recursive: true, force: true }); }
}
const inspect = async () => ({ cwd: '/synthetic', identity: '/synthetic/.git', head: sha });
const pass = async () => ({ status: 'PASS', exitCode: 0 });
test('fixed plans reject arbitrary shell/profile input', () => {
  assert.throws(() => planFor('verify; echo unsafe'));
  assert.equal(planFor('verify').length, 4);
  assert.equal(planFor('verify').at(-1).args[0], 'scripts/gates.sh');
});
test('security lanes remain visibly blocked, not waived', () => {
  assert.equal(planFor('security').length, 6);
  assert(planFor('security').every((step) => step.blocked));
  assert.equal(planFor('release').length, 10);
});
test('empty, partial and not-run evidence never passes', () => {
  assert.equal(verdict([]), 'BLOCKED');
  assert.equal(verdict([{ status: 'PASS' }, { status: 'NOT_RUN' }]), 'BLOCKED');
  assert.equal(verdict([{ status: 'FAIL' }, { status: 'NOT_RUN' }]), 'FAIL');
  assert.equal(exitFor('BLOCKED'), 2);
});
test('child environment does not inherit credentials or Git hook context', () => {
  const env = childEnvironment({ PATH: '/bin', HOME: '/home/test', GITHUB_TOKEN: 'not-a-token', GIT_DIR: '/wrong', OS_SESSION_SECRET: 'not-a-secret' });
  assert.equal(env.PATH, '/bin'); assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.GIT_DIR, undefined); assert.equal(env.OS_SESSION_SECRET, undefined);
  assert.equal(env.CI, undefined); // The wrapper must preserve the repository's local gate behavior.
});
test('private state refuses a symlink', () => fixture(async (root) => {
  await mkdir(join(root, 'target'), { mode: 0o700 });
  await symlink(join(root, 'target'), join(root, 'link'));
  await assert.rejects(privateDirectory(join(root, 'link')), /owner-private/);
}));
test('host lock prevents parallel repositories and releases safely', () => fixture(async (root) => {
  const release = await acquireLocks(root, '/one/.git', 'one');
  await assert.rejects(acquireLocks(root, '/two/.git', 'two'), /lock busy/);
  await release(); const next = await acquireLocks(root, '/two/.git', 'two'); await next();
}));
test('real child process success and private logs', () => fixture(async (root) => {
  const logPath = join(root, 'success.log');
  const result = await executeStep({ command: process.execPath, args: ['-e', 'console.log("fixture success")'], timeoutMs: 3000 }, { cwd: root, logPath });
  assert.equal(result.status, 'PASS'); assert.equal((await stat(logPath)).mode & 0o777, 0o600);
}));
test('real child nonzero exit fails', () => fixture(async (root) => {
  const result = await executeStep({ command: process.execPath, args: ['-e', 'process.exit(7)'], timeoutMs: 3000 }, { cwd: root, logPath: join(root, 'fail.log') });
  assert.equal(result.status, 'FAIL'); assert.equal(result.exitCode, 7);
}));
test('timeout is blocked, never success', () => fixture(async (root) => {
  const result = await executeStep({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 60 }, { cwd: root, logPath: join(root, 'timeout.log') });
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.timedOut, true);
}));
test('log overflow stays bounded and blocks evidence', () => fixture(async (root) => {
  const logPath = join(root, 'bounded.log');
  const result = await executeStep({ command: process.execPath, args: ['-e', 'console.log("x".repeat(5000))'], timeoutMs: 3000 }, { cwd: root, logPath, maxBytes: 64 });
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.logTruncated, true);
  assert.equal((await stat(logPath)).size, 64);
}));
test('cancellation terminates a real child', () => fixture(async (root) => {
  const controller = new AbortController(); controller.abort();
  const result = await executeStep({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 3000 }, { cwd: root, logPath: join(root, 'cancel.log'), signal: controller.signal });
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.cancelled, true);
}));
test('synthetic success never asserts release, deployment or Batonly sync', () => fixture(async (root) => {
  const result = await runPipeline({ repo: root, expectedSha: sha, profile: 'verify', stateRoot: root }, { inspect, execute: pass });
  assert.equal(result.report.status, 'PASS'); assert.equal(result.report.releaseEligible, false);
  assert.equal(result.report.deployed, false); assert.equal(result.report.verifiedLive, false);
  assert.equal(result.report.batonlySync, 'UNSYNCED');
  const saved = JSON.parse(await readFile(result.reportPath, 'utf8'));
  assert.equal(saved.commit, sha); assert.equal(saved.steps.length, 4);
  assert.equal((await stat(result.reportPath)).mode & 0o777, 0o600);
}));
test('first failure stops later steps but retains a report', () => fixture(async (root) => {
  let count = 0;
  const result = await runPipeline({ repo: root, expectedSha: sha, profile: 'verify', stateRoot: root }, { inspect, execute: async () => { count++; return { status: 'FAIL', exitCode: 1 }; } });
  assert.equal(count, 1); assert.equal(result.exitCode, 1);
  assert.deepEqual(result.report.steps.map((s) => s.status), ['FAIL', 'NOT_RUN', 'NOT_RUN', 'NOT_RUN']);
}));
test('blocked security never starts commands', () => fixture(async (root) => {
  let calls = 0;
  const result = await runPipeline({ repo: root, expectedSha: sha, profile: 'release', stateRoot: root }, { inspect, execute: async () => { calls++; return pass(); } });
  assert.equal(calls, 0); assert.equal(result.exitCode, 2);
  assert.equal(result.report.steps.filter((s) => s.status === 'BLOCKED').length, 6);
}));
test('preflight failure is persisted', () => fixture(async (root) => {
  const result = await runPipeline({ repo: root, expectedSha: sha, profile: 'verify', stateRoot: root }, { inspect: async () => { throw new Error('Checkout is dirty'); } });
  assert.equal(result.report.status, 'BLOCKED');
  assert.match((await readFile(result.reportPath, 'utf8')), /Checkout is dirty/);
}));
test('actual Git preflight rejects wrong SHA and untracked edits', () => fixture(async (root) => {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.email', 'ci@example.invalid'); git('config', 'user.name', 'CI fixture');
  await writeFile(join(root, 'one'), 'one'); git('add', 'one'); git('commit', '-m', 'fixture');
  const head = git('rev-parse', 'HEAD'); assert.equal((await inspectRepository(root, head)).head, head);
  await assert.rejects(inspectRepository(root, 'main'), /exact/);
  await assert.rejects(inspectRepository(root, sha), /does not match/);
  await writeFile(join(root, 'untracked'), 'two'); await assert.rejects(inspectRepository(root, head), /dirty/);
}));
