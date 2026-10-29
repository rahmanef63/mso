import { HostError } from "./host-error";
import { readFile, statReadableMeta } from "./fs";
import { writeFileGuarded } from "./guarded-write";
import { sha256Text, utf8Bytes } from "./hash";
import { editDiff } from "./fs-edit-diff";

const MAX_READ_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_WRITE_BYTES = 8 * 1024 * 1024; // 8 MiB

export interface EditFileInput {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  expectedSha256?: string;
  dryRun?: boolean;
}

export interface EditFileResult {
  ok: true;
  path: string;
  replacements: number;
  bytes: number;
  sha256: string;
  written: boolean;
  diff: string;
  diffTruncated: boolean;
  removedLines: number;
  addedLines: number;
  previousSha256?: string;
}

function countOccurrences(content: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

function checkExpectedSha(expectedSha256: string | undefined, currentContent: string): string | undefined {
  if (!expectedSha256) return undefined;
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new HostError("expected_sha256 must be a 64-character SHA-256 hex digest from fs_read");
  }
  const currentSha = sha256Text(currentContent);
  if (currentSha.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new HostError("File changed since fs_read; inspect it again before overwriting");
  }
  return currentSha;
}

export async function editFileGuarded(input: EditFileInput): Promise<EditFileResult> {
  const { path, oldString, newString, replaceAll = false, expectedSha256, dryRun = false } = input;

  if (oldString === "") {
    throw new HostError("old_string must not be empty");
  }

  const meta = await statReadableMeta(path);
  if (meta.kind !== "file") {
    throw new HostError("Not a regular file");
  }
  if (meta.sizeBytes > MAX_READ_BYTES) {
    throw new HostError(`File too large to edit (max ${MAX_READ_BYTES} bytes, file is ${meta.sizeBytes} bytes)`);
  }

  const currentContent = await readFile(path);
  const occurrences = countOccurrences(currentContent, oldString);

  if (occurrences === 0) {
    throw new HostError(`old_string not found in ${path}`);
  }

  if (occurrences > 1 && !replaceAll) {
    throw new HostError(
      `Found ${occurrences} occurrences of old_string in ${path}. Pass more surrounding context or set replace_all to true.`,
    );
  }

  let nextContent: string;
  if (replaceAll) {
    nextContent = currentContent.split(oldString).join(newString);
  } else {
    const idx = currentContent.indexOf(oldString);
    nextContent = currentContent.slice(0, idx) + newString + currentContent.slice(idx + oldString.length);
  }

  const nextBytes = utf8Bytes(nextContent);
  if (nextBytes > MAX_WRITE_BYTES) {
    throw new HostError(`Replacement would push file over limit (max ${MAX_WRITE_BYTES} bytes, resulting file is ${nextBytes} bytes)`);
  }

  const previousSha256 = checkExpectedSha(expectedSha256, currentContent);

  const diffResult = editDiff(currentContent, nextContent);

  if (dryRun) {
    return {
      ok: true,
      path,
      replacements: occurrences,
      bytes: nextBytes,
      sha256: sha256Text(nextContent),
      written: false,
      diff: diffResult.diff,
      diffTruncated: diffResult.truncated,
      removedLines: diffResult.removed,
      addedLines: diffResult.added,
      ...(previousSha256 ? { previousSha256 } : {}),
    };
  }

  const writeResult = await writeFileGuarded({
    path,
    content: nextContent,
    expectedSha256,
  });

  return {
    ok: true,
    path: writeResult.path,
    replacements: occurrences,
    bytes: writeResult.bytes,
    sha256: writeResult.sha256,
    written: true,
    diff: diffResult.diff,
    diffTruncated: diffResult.truncated,
    removedLines: diffResult.removed,
    addedLines: diffResult.added,
    ...(writeResult.previousSha256 ? { previousSha256: writeResult.previousSha256 } : {}),
  };
}
