#!/usr/bin/env bash
# verify-build.sh — prove HEAD actually compiles, WITHOUT touching the .next that the
# live :4005 service is serving from.
#
# Why not simply run `next build` here, and why the pre-push hook keeps `--skip build`:
# the build's FIRST act is to delete everything in distDir except /^(cache|dev|lock)/
# (node_modules/next/dist/build/index.js, the 'clean' trace step). For ~30 s there is no
# .next/static, no .next/server, no BUILD_ID — and since two builds of byte-identical
# source emit different chunk filenames and a fresh BUILD_ID, every page already served
# keeps pointing at names that no longer exist even after it finishes. An in-place build
# in this directory is therefore an outage, not a check. docs/DEVELOPMENT.md says the
# same thing in prose; this script is the way to get the check without the outage.
#
# node_modules is COPIED, never symlinked. Turbopack hard-fails on a symlinked
# node_modules with "Symlink [project]/node_modules is invalid, it points out of the
# filesystem root". The copy costs ~7 s and the build writes nothing back into it.
#
# .env.local is deliberately NOT copied — the build succeeds without it, so no secret
# ever lands in a world-traversable /tmp path.
#
# Scope: this gates HEAD (the last commit), not the working tree, and always HEAD rather
# than the specific ref git hands the hook on stdin. That matches the commit-then-push
# flow this repo uses; pushing a non-HEAD ref would be gated against the wrong tree.
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"   # 0700
trap 'rm -rf "$TMP"' EXIT

git -C "$REPO" archive HEAD | tar -x -C "$TMP"
# Copy the contents, resolving a worktree's top-level dependency symlink only.
mkdir "$TMP/node_modules"
cp -a "$REPO/node_modules/." "$TMP/node_modules/"

cd "$TMP"
# nice/ionice: this box also serves prod. A build gate must not starve :4005.
nice -n 15 ionice -c2 -n7 node node_modules/.bin/next build
