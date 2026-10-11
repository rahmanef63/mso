#!/usr/bin/env node
// Only repository-owned shell artwork; never inspect a user's Files or Vault.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app-icons');
const names = ['files', 'code', 'terminal', 'claude', 'studio', 'reel', 'viewer', 'store', 'create', 'monitor', 'assistant', 'settings', 'links', 'docs'];
for (const family of ['', 'macos', 'windows']) for (const name of names) {
  const source = path.join(root, family, `${name}.webp`);
  const { width, height } = await sharp(source).metadata();
  if (width !== (family ? 256 : 192) || height !== width) throw new Error(`Unexpected source dimensions: ${family}/${name}`);
  await sharp(source).resize(128, 128).webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(path.join(root, family, `${name}-128.webp`));
}
console.log('Generated 42 public 128px shell icons; original artwork unchanged');
