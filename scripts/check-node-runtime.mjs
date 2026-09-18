#!/usr/bin/env node
// Dependency-free so installers and doctor can check before package installation.
import { pathToFileURL } from "node:url";
export const NODE_RUNTIME_RANGE = "^22.12.0 || ^24.0.0 || >=26.0.0";
export function supportedNodeRuntime(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor] = version.split(".").map(Number);
  return (major === 22 && minor >= 12) || major === 24 || major >= 26;
}
export function assertNodeRuntime(version = process.versions.node) {
  if (!supportedNodeRuntime(version)) throw new Error(`MSO requires Node ${NODE_RUNTIME_RANGE}; found ${version}. Upgrade Node before installing or verifying MSO.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { assertNodeRuntime(); console.log(`Node ${process.versions.node} is supported`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
