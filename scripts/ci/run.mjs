#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { planFor } from './plan.mjs';
import { runPipeline } from './runner.mjs';
try {
  const { values } = parseArgs({ options: {
    plan: { type: 'boolean', default: false }, profile: { type: 'string', default: 'verify' },
    sha: { type: 'string' }, repo: { type: 'string', default: process.cwd() },
  }, strict: true, allowPositionals: false });
  const plan = planFor(values.profile);
  if (values.plan) {
    console.log(JSON.stringify({ profile: values.profile, steps: plan, autoDeploy: false, githubActionsUsed: false }, null, 2));
  } else {
    if (!values.sha) throw new Error('--sha must be the exact committed SHA');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    const result = await runPipeline({
      repo: values.repo, expectedSha: values.sha, profile: values.profile,
      stateRoot: join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'mso-ci'), signal: controller.signal,
    });
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    console.log(JSON.stringify({
      status: result.report.status, commit: result.report.commit ?? null, reportPath: result.reportPath,
      releaseEligible: result.report.releaseEligible, batonlySync: result.report.batonlySync,
      steps: result.report.steps.map(({ id, status }) => ({ id, status })), reason: result.report.reason,
    }, null, 2));
    process.exitCode = result.exitCode;
  }
} catch (error) { console.error(`CI: ${error.message}`); process.exitCode = 2; }
