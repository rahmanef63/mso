#!/usr/bin/env node
import fs from 'node:fs';
import { readBundleReport, bundleViolations } from './lib/bundle-report.mjs';

try {
  const report = readBundleReport();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else for (const key of ['initial', 'entry', 'css', 'fonts']) {
    console.log(`bundle ${key}: ${(report[key].bytes / 1024).toFixed(1)} KiB raw / ${(report[key].gzip / 1024).toFixed(1)} KiB gzip (${report[key].files} files)`);
  }
  if (!process.argv.includes('--report-only')) {
    const failures = bundleViolations(report, JSON.parse(fs.readFileSync('scripts/bundle-budget.json', 'utf8')));
    if (failures.length) throw new Error(failures.join('\n'));
    console.log('bundle: eager shell budget passed; optional engines remain deferred.');
  }
} catch (error) {
  console.error(`bundle: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
