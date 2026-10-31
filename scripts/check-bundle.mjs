#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readBundleReport, bundleViolations } from './lib/bundle-report.mjs';

// A budget only means something against a build of THIS tree. `.next` is whatever was
// built last — often a different commit, since nobody builds in place here (it takes the
// live service down). Enforcing a tightened budget against a stale tree produces a
// failure that reads like a regression but describes history, so say which it is.
//
// `verify-build.sh` builds an archive of HEAD out of tree and sets
// MSO_BUNDLE_BUILD_IS_CURRENT=1, because there the build really does describe the source.
function staleBuild() {
  if (process.env.MSO_BUNDLE_BUILD_IS_CURRENT === '1') return null;
  let built;
  try {
    built = fs.statSync('.next/BUILD_ID').mtimeMs;
  } catch {
    return null;
  }
  try {
    const changed = execFileSync('git', ['status', '--porcelain', '--', '.', ':!docs/CHANGELOG.md'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (changed) return `working tree has uncommitted changes`;
  } catch {
    // Not a git checkout (or git is unavailable): the mtime check below still applies.
  }
  try {
    const newest = execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (newest && Number(newest) * 1000 > built) return `HEAD is newer than the build`;
  } catch {}
  return null;
}

try {
  const report = readBundleReport();
  const stale = staleBuild();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else for (const key of ['initial', 'entry', 'css', 'fonts']) {
    console.log(`bundle ${key}: ${(report[key].bytes / 1024).toFixed(1)} KiB raw / ${(report[key].gzip / 1024).toFixed(1)} KiB gzip (${report[key].files} files)`);
  }
  if (!process.argv.includes('--report-only')) {
    const failures = bundleViolations(report, JSON.parse(fs.readFileSync('scripts/bundle-budget.json', 'utf8')));
    if (failures.length && stale) {
      throw new Error(`${failures.join('\n')}\n.build/ is stale (${stale}); these bytes describe an older tree, not this one. Rebuild with scripts/verify-build.sh before reading this as a regression.`);
    }
    if (failures.length) throw new Error(failures.join('\n'));
    console.log('bundle: eager shell budget passed; optional engines remain deferred.');
  }
} catch (error) {
  console.error(`bundle: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
