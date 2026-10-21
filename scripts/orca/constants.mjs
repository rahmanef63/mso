/**
 * Orca acquisition constants and portable pins.
 *
 * All digests here are release facts measured from the official v1.4.230
 * artifacts (GitHub release .deb + nodejs.org Node tarball) and the tagged
 * upstream source tree. No operator-specific absolute paths belong here.
 */

export const SUPPORTED_TARGET = 'linux-x64-glibc'

export function isSupportedTarget(target) {
  return target === SUPPORTED_TARGET
}

/**
 * Fail early on hosts we have no verified binary for. `platform`/`arch`/`report`
 * are injectable so the pure test can exercise rejection without lying about
 * the running process; production callers pass nothing.
 */
export function assertSupportedHostPlatform({
  platform = process.platform,
  arch = process.arch,
  report
} = {}) {
  if (platform !== 'linux' || arch !== 'x64') {
    throw new Error(
      `Unsupported host platform ${platform}-${arch}; Orca acquisition supports ${SUPPORTED_TARGET} only`
    )
  }
  const resolved = report ?? process.report?.getReport?.()
  const glibcVersion = resolved?.header?.glibcVersionRuntime
  if (typeof glibcVersion !== 'string' || glibcVersion.length === 0) {
    throw new Error(
      `Unsupported libc on ${platform}-${arch}; Orca acquisition requires glibc (${SUPPORTED_TARGET})`
    )
  }
  return { platform, arch, libc: 'glibc', glibcVersion }
}

export const PINNED_NODE = Object.freeze({
  version: '24.21.0',
  archiveSha256: '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
  archiveSize: 58088022,
  executableSha256: '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c',
  archiveUrl: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz',
  tarMember: 'node-v24.21.0-linux-x64/bin/node'
})

export const ORCAD_VERSION = '0.1.0'
export const ORCA_VERSION = '1.4.230'

export const DEFAULT_PORT = 6769
export const DEFAULT_BIND = '127.0.0.1'

export const ORCA_DEB_URL =
  'https://github.com/stablyai/orca/releases/download/v1.4.230/orca-ide_1.4.230_amd64.deb'
export const ORCA_DEB_FILENAME = 'orca-ide_1.4.230_amd64.deb'
export const ORCA_DEB_SHA256 =
  '7758be00e6564c14e5793b6a61ffe1bb0e84749583d76013a129454835788e24'
export const ORCA_DEB_SIZE = 209670608
export const ORCA_DEB_PACKAGE = 'orca-ide'
export const ORCA_DEB_ARCHITECTURE = 'amd64'

/** GitHub release downloads redirect to release assets; nothing else is allowed. */
export const ORCA_DOWNLOAD_REDIRECT_HOSTS = Object.freeze([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com'
])

/** Tagged upstream source that produced the .deb (MIT license + notices). */
export const ORCA_SOURCE_COMMIT = 'b2879bd5aaac5d27c101ccf4171faa25d9f0bb1e'
export const ORCA_SOURCE_URL =
  'https://github.com/stablyai/orca/archive/b2879bd5aaac5d27c101ccf4171faa25d9f0bb1e.tar.gz'
export const ORCA_LICENSE_SHA256 =
  'ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3'
export const ORCA_LICENSE_SIZE = 1070
export const ORCA_THIRD_PARTY_NOTICES_SHA256 =
  '1e039dc5567ff96b755c80a384dd626a00a0c46c49e9994c86cb599efcc435fd'
export const ORCA_THIRD_PARTY_NOTICES_SIZE = 4675
export const ORCA_THIRD_PARTY_NOTICES_URL =
  'https://raw.githubusercontent.com/stablyai/orca/b2879bd5aaac5d27c101ccf4171faa25d9f0bb1e/docs/site/THIRD_PARTY_NOTICES.md'
export const ORCA_THIRD_PARTY_NOTICES_RELATIVE_PATH = 'docs/site/THIRD_PARTY_NOTICES.md'

/** Packaged Electron app.asar inside the verified .deb; used for MIT LICENSE. */
export const ORCA_APP_ASAR_PATH = 'opt/Orca/resources/app.asar'
export const ORCA_APP_ASAR_SHA256 =
  'b663113cb9549de55e70a2daaf1759ec59f5c744ebf7715798bbaaaf3d3e6988'

export const ORCAD_SERVER_TARGET_FILENAME = '.server-target'
export const ORCAD_NODE_RUNTIME_MARKER_FILENAME = '.runtime-node'
export const ORCAD_VERSION_FILENAME = '.version'
export const ORCAD_TEMPLATE_MANIFEST_FILENAME = 'orcad-template.json'
export const ORCAD_TEMPLATE_TARGETS_DIR = 'targets'
export const ORCAD_SERVER_ENTRY_FILENAME = 'orcad-server.js'
export const ORCAD_RUNTIMES_DIRNAME = 'runtimes'
export const ORCAD_NODE_RUNTIME_DIR_PREFIX = 'node-'
export const ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE = 'bin/node'
export const WEB_CLIENT_INDEX_FILENAME = 'web-index.html'

/** Directory layout inside the upstream .deb (data-only, never apt scripts). */
export const ORCA_DEB_TEMPLATE_DIR = 'opt/Orca/resources/orcad-template'
export const ORCA_DEB_WEB_DIR = 'opt/Orca/resources/app.asar.unpacked/out/web'

/**
 * The exact upstream common artifact list (order is part of the slot contract).
 * `out/mobile-web/*` assets beyond manifest.json are discovered from the
 * authenticated manifest and sorted, so the final slot is always 175 files.
 */
export const ORCAD_COMMON_FILES = Object.freeze([
  'out/cli/index.js',
  'out/package.json',
  'orcad.js',
  'orcad-server.js',
  'parcel-watcher-process-entry.js',
  'daemon-entry.js',
  'profile-state-writer-worker-entry.js',
  'profile-state-backup-worker-entry.js',
  'foreign-sqlite-reader-entry.js',
  'port-scan-command-worker-entry.js',
  'session-scanner-service-entry.js',
  'worker-thread-child-process-entry.js',
  'claude-profile-setup-worker-entry.js',
  'node_modules/@parcel/watcher/index.js',
  'node_modules/emojibase-data/en/shortcodes/emojibase.json',
  'node_modules/@linear/sdk/index.js',
  'node_modules/node-pty/package.json',
  'node_modules/node-pty/lib/conpty_console_list_agent.js',
  'node_modules/node-pty/lib/eventEmitter2.js',
  'node_modules/node-pty/lib/index.js',
  'node_modules/node-pty/lib/interfaces.js',
  'node_modules/node-pty/lib/shared/conout.js',
  'node_modules/node-pty/lib/terminal.js',
  'node_modules/node-pty/lib/types.js',
  'node_modules/node-pty/lib/unixTerminal.js',
  'node_modules/node-pty/lib/utils.js',
  'node_modules/node-pty/lib/windowsConoutConnection.js',
  'node_modules/node-pty/lib/windowsPtyAgent.js',
  'node_modules/node-pty/lib/windowsTerminal.js',
  'node_modules/node-pty/lib/worker/conoutSocketWorker.js',
  'ripgrep/licenses/JEMALLOC-COPYING',
  'ripgrep/licenses/LICENSE-MIT',
  'ripgrep/licenses/LLVM-LIBUNWIND-LICENSE.TXT',
  'ripgrep/licenses/MUSL-COPYRIGHT',
  'ripgrep/licenses/PCRE2-LICENCE.md',
  'ripgrep/licenses/README.md',
  'ripgrep/licenses/RUST-CRATE-NOTICES.txt',
  'ripgrep/licenses/SLJIT-LICENSE',
  'ripgrep/licenses/UNLICENSE',
  'native-chat-visuals/.claude-plugin/plugin.json',
  'native-chat-visuals/skills/orca-chat-visuals/SKILL.md',
  'out/mobile-web/manifest.json'
])

/** linux-x64-glibc target-specific artifacts, in slot order. */
export const ORCAD_TARGET_FILES = Object.freeze([
  ORCAD_SERVER_TARGET_FILENAME,
  ORCAD_NODE_RUNTIME_MARKER_FILENAME,
  'node_modules/@parcel/watcher/watcher.node',
  'node_modules/node-pty/build/Release/pty.node',
  'ripgrep/linux-x64/rg'
])

export const ORCAD_SLOT_FILE_COUNT = 175
