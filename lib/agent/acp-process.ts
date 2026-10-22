// ACP child-process lifecycle: spawn with an explicit argv and a detached process
// GROUP, bounded stderr ring, group kill (SIGTERM then SIGKILL after a grace period)
// and stream teardown. Knows nothing about JSON-RPC ids or permission policy.
import { spawn, type ChildProcess } from "node:child_process";
import { AcpError } from "./acp-errors";
import { writeAcpLine } from "./acp-framing";

const STDERR_RING_BYTES = 16 * 1024, KILL_GRACE_MS = 500;

export interface AcpProcessOptions {
  command: string; args?: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv;
  onStdout: (chunk: Buffer) => void;
  /** Fatal transport fault: the client must stop and reject every pending request. */
  onFailure: (error: AcpError) => void;
  onDiagnostic?: (text: string) => void;
}

export class AcpProcess {
  private readonly child: ChildProcess;
  private readonly stderrRing: string[] = [];
  private stderrBytes = 0;

  constructor(options: AcpProcessOptions) {
    // Explicit argv, no shell string, and a new process GROUP so abort kills what the
    // agent started, not only the direct pid.
    this.child = spawn(options.command, options.args ?? [], { cwd: options.cwd,
      env: options.env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    // EPIPE on a child that already died must reject the request, not crash the process.
    this.child.stdin?.on("error", (error: Error) => options.onFailure(new AcpError(`acp_stdin_closed:${error.message}`)));
    this.child.stdout?.on("data", (chunk: Buffer) => options.onStdout(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => this.appendStderr(chunk.toString("utf8")));
    this.child.once("error", (error: Error) => options.onFailure(new AcpError(`acp_spawn_failed:${error.message}`, 500)));
    this.child.once("exit", (code, signal) => options.onFailure(new AcpError(`acp_agent_exited:${signal ?? code ?? "unknown"}`)));
    this.onDiagnostic = options.onDiagnostic;
  }

  private readonly onDiagnostic?: (text: string) => void;

  /** Direct child pid; diagnostics and group-kill proof only. */
  get pid(): number | undefined { return this.child.pid; }

  /** One JSON line on stdin. Throws when the pipe is closed; `onWriteFailed` is the
   *  fatal path for a live pipe that refuses the write. */
  write(message: unknown, onWriteFailed: (error: unknown) => void): void {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) throw new AcpError("acp_stdin_closed");
    try { writeAcpLine(stdin, message); } catch (error) { onWriteFailed(error); }
  }

  /** The whole GROUP: an agent CLI forks helpers that would outlive the pid. */
  kill(): void {
    const pid = this.child.pid;
    if (!pid) return;
    try { process.kill(-pid, "SIGTERM"); } catch { try { this.child.kill("SIGTERM"); } catch { /* already gone */ } }
    setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }, KILL_GRACE_MS).unref?.();
  }

  /** Releases stdio handles; the caller owns the stop/reject bookkeeping. */
  close(): void {
    try { this.child.stdin?.end(); } catch { /* already closed */ }
    this.child.stdout?.destroy(); this.child.stderr?.destroy();
  }

  private appendStderr(text: string): void { // bounded ring, never parsed as protocol
    this.stderrRing.push(text); this.stderrBytes += Buffer.byteLength(text);
    while (this.stderrBytes > STDERR_RING_BYTES && this.stderrRing.length > 1) this.stderrBytes -= Buffer.byteLength(this.stderrRing.shift()!);
    this.onDiagnostic?.(text);
  }
}
