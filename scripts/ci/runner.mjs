import { execFileSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { planFor, verdict, exitFor } from './plan.mjs';
import { executeStep, childEnvironment } from './process.mjs';
import { createRun, saveReport, acquireLocks } from './store.mjs';
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: childEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export async function inspectRepository(repo, expectedSha) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) throw new Error('An exact 40-character commit SHA is required');
  const cwd = await realpath(repo);
  if (await realpath(git(cwd, 'rev-parse', '--show-toplevel')) !== cwd) throw new Error('Run from the repository root');
  const head = git(cwd, 'rev-parse', 'HEAD');
  if (head !== expectedSha) throw new Error('HEAD does not match the requested SHA');
  if (git(cwd, 'status', '--porcelain', '--untracked-files=all')) throw new Error('Checkout is dirty; commit or preserve changes before CI');
  return { cwd, head, identity: await realpath(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')) };
}
/** Trusted local CI only; never executes a webhook-supplied ref. */
export async function runPipeline({ repo, expectedSha, profile, stateRoot, signal }, deps = {}) {
  const steps = planFor(profile).map((step) => ({ ...step, status: 'NOT_RUN' }));
  const run = await createRun(stateRoot);
  const report = {
    schemaVersion: 1, runId: run.runId, profile, expectedSha, startedAt: new Date().toISOString(),
    status: 'BLOCKED', source: 'trusted-local-checkout', githubActionsUsed: false,
    merged: false, deployed: false, verifiedLive: false, releaseEligible: false,
    batonlySync: 'UNSYNCED', steps,
  };
  const inspect = deps.inspect ?? inspectRepository;
  const execute = deps.execute ?? executeStep;
  let release;
  await saveReport(run.path, report);
  try {
    let target = await inspect(repo, expectedSha);
    release = await acquireLocks(stateRoot, target.identity, run.runId);
    target = await inspect(repo, expectedSha);
    report.commit = target.head;
    for (const step of steps) {
      if (step.blocked) { step.status = 'BLOCKED'; step.reason = step.blocked; }
    }
    if (steps.some((step) => step.status === 'BLOCKED')) {
      report.reason = 'Security migration incomplete. No selected commands executed; release remains blocked.';
    } else {
      for (const step of steps) {
        if (signal?.aborted) { step.status = 'BLOCKED'; step.reason = 'Cancelled before execution'; break; }
        await inspect(repo, expectedSha);
        step.startedAt = new Date().toISOString();
        await saveReport(run.path, report);
        Object.assign(step, await execute(step, { cwd: target.cwd, logPath: join(run.path, `${step.id}.log`), signal }));
        await saveReport(run.path, report);
        if (step.status !== 'PASS') break;
      }
      await inspect(repo, expectedSha);
    }
    report.status = verdict(steps);
  } catch (error) {
    report.status = 'BLOCKED';
    report.reason = error.code ? `Runner operation unavailable (${error.code})` : error.message;
  } finally {
    if (release) {
      try { await release(); }
      catch { report.status = 'BLOCKED'; report.reason = 'Runner lock cleanup failed; owner review required'; }
    }
    report.finishedAt = new Date().toISOString();
    await saveReport(run.path, report);
  }
  return { report, reportPath: join(run.path, 'report.json'), exitCode: exitFor(report.status) };
}
