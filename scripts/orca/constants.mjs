/**
 * Orca Node runtime pinned constants and paths.
 * Matches upstream release v1.4.230 and Node 24.21.0 linux-x64-glibc pin.
 */

export const SUPPORTED_TARGET = 'linux-x64-glibc'

export function isSupportedTarget(target) {
  return target === SUPPORTED_TARGET
}

export const PINNED_NODE = Object.freeze({
  version: '24.21.0',
  archiveSha256: '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
  executableSha256: '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c',
  archiveUrl: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz',
  tarMember: 'node-v24.21.0-linux-x64/bin/node'
})

export const ORCAD_VERSION = '0.1.0'
export const ORCA_VERSION = '1.4.230'

export const DEFAULT_PORT = 6769
export const OCCUPIED_SYSTEM_PORT = 6768
export const DEFAULT_BIND = '127.0.0.1'

export const ORCA_DEB_URL = 'https://github.com/stablyai/orca/releases/download/v1.4.230/orca-ide_1.4.230_amd64.deb'
export const ORCA_DEB_SHA256 = '7758be00e6564c14e5793b6a61ffe1bb0e84749583d76013a129454835788e24'
export const ORCA_DEB_SIZE = 209670608

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
