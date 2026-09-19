export const CANONICAL_MSO_REMOTE = "https://github.com/rahmanef63/mso.git";

const CANONICAL_FORMS = new Set([
  "https://github.com/rahmanef63/mso",
  CANONICAL_MSO_REMOTE,
  "https://github.com/rahmanef63/mso/",
  "https://github.com/rahmanef63/mso.git/",
  "git@github.com:rahmanef63/mso",
  "git@github.com:rahmanef63/mso.git",
  "ssh://git@github.com/rahmanef63/mso",
  "ssh://git@github.com/rahmanef63/mso.git",
]);

export type UpdateGitResult = { code: number; stdout: string; stderr: string };
export type UpdateGitRunner = (args: readonly string[], timeout?: number) => Promise<UpdateGitResult>;

export function isCanonicalMsoRemote(url: string): boolean {
  return CANONICAL_FORMS.has(url.trim());
}

export function updateGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND?.trim() || "ssh -oBatchMode=yes",
  };
}

export async function prepareUpdateOrigin(git: UpdateGitRunner): Promise<boolean> {
  const remote = await git(["remote", "get-url", "origin"]);
  if (remote.code !== 0 || !remote.stdout.trim()) return false;
  const url = remote.stdout.trim();
  if (isCanonicalMsoRemote(url) && url !== CANONICAL_MSO_REMOTE) {
    return (await git(["remote", "set-url", "origin", CANONICAL_MSO_REMOTE])).code === 0;
  }
  return true;
}
