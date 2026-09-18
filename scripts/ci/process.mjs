import { spawn } from 'node:child_process';
import { openSync, closeSync, writeSync } from 'node:fs';
export function childEnvironment(source = process.env) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']) {
    if (source[key]) env[key] = source[key];
  }
  return { ...env, CI: 'true', NEXT_TELEMETRY_DISABLED: '1' };
}
/** Fixed argv, private bounded logs, and whole-process-group timeout/cancellation. */
export async function executeStep(step, { cwd, logPath, signal, maxBytes = 8 * 1024 * 1024 }) {
  const started = Date.now();
  const fd = openSync(logPath, 'wx', 0o600);
  let bytes = 0, truncated = false, timedOut = false, cancelled = false;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(step.command, step.args, {
        cwd, env: childEnvironment(), shell: false, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let finished = false, killTimer;
      function kill(sig) {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig);
          else child.kill(sig);
        } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      function stop() {
        kill('SIGTERM');
        killTimer = setTimeout(() => kill('SIGKILL'), 1500);
        killTimer.unref();
      }
      const timer = setTimeout(() => { timedOut = true; stop(); }, step.timeoutMs);
      const abort = () => { cancelled = true; stop(); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      function output(chunk) {
        const available = Math.max(0, maxBytes - bytes);
        const part = chunk.subarray(0, available);
        if (part.length) writeSync(fd, part);
        bytes += part.length;
        if (chunk.length > available) truncated = true;
      }
      child.stdout.on('data', output); child.stderr.on('data', output);
      function cleanup() {
        clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
      }
      child.on('error', (error) => { if (!finished) { finished = true; cleanup(); reject(error); } });
      child.on('close', (exitCode, exitSignal) => {
        if (finished) return;
        finished = true; cleanup();
        kill('SIGKILL');
        resolve({
          status: timedOut || cancelled || truncated ? 'BLOCKED' : exitCode === 0 ? 'PASS' : 'FAIL',
          exitCode, signal: exitSignal, timedOut, cancelled, logTruncated: truncated,
          durationMs: Date.now() - started,
        });
      });
    });
  } finally { closeSync(fd); }
}
