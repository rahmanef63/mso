<script lang="ts">
  import type { Loadable } from "./appdeck-detail";
  import type { AppLogs, JobSummary } from "./appdeck-schema";
  import { fmtStamp, hasActiveJob, jobTone, joinLogEntries, lastLine } from "./appdeck-view";

  let {
    jobs,
    logs,
    onjobs,
    onlogs,
  }: {
    jobs: Loadable<JobSummary[]>;
    logs: Loadable<AppLogs>;
    onjobs: () => void;
    onlogs: () => void;
  } = $props();

  let copied = $state<string | null>(null);
  let copyError = $state<string | null>(null);

  async function copy(label: string, text: string) {
    copyError = null;
    copied = null;
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      copied = label;
    } catch {
      copyError = "Clipboard access was refused. Select the text and copy it manually.";
    }
  }

  let live = $derived(jobs.kind === "ready" && hasActiveJob(jobs.data));
  let logText = $derived(logs.kind === "ready" ? joinLogEntries(logs.data.entries) : "");
  let jobText = $derived.by(() => {
    if (jobs.kind !== "ready") return "";
    return jobs.data
      .map((job) => `${job.id} ${job.kind} ${job.status} ${job.startedAt} ${job.exitCode ?? "-"} ${job.error ?? ""}`.trim())
      .join("\n");
  });
</script>

<div class="pane">
  <section aria-labelledby="jobs-heading" class="block">
    <div class="block-head">
      <h4 id="jobs-heading">Recent jobs</h4>
      <div class="row">
        <button disabled={jobs.kind === "loading"} onclick={onjobs}>
          {jobs.kind === "loading" ? "Loading..." : "Refresh jobs"}
        </button>
        <button class="ghost" disabled={!jobText} onclick={() => copy("jobs", jobText)}>Copy list</button>
      </div>
    </div>
    {#if live}
      <p class="hint" role="status">A job is still running. Refresh to follow it.</p>
    {/if}
    {#if jobs.kind === "idle" || jobs.kind === "loading"}
      <p class="hint">Reading install and update history...</p>
    {:else if jobs.kind === "error"}
      <p class="feedback error" role="alert">{jobs.message}</p>
    {:else if jobs.data.length === 0}
      <p class="hint">No install, update, uninstall, or restore jobs recorded for this app.</p>
    {:else}
      <ul class="jobs">
        {#each jobs.data as job (job.id)}
          <li data-tone={jobTone(job.status)}>
            <div class="job-head">
              <code>{job.id.slice(0, 8)}</code>
              <span class="pill" data-tone={jobTone(job.status)}>{job.status}</span>
              <span class="pill">{job.kind}</span>
            </div>
            <p class="job-meta">
              Started {fmtStamp(job.startedAt)}
              {#if job.endedAt}<span> · Ended {fmtStamp(job.endedAt)}</span>{/if}
              {#if job.exitCode !== null}<span> · Exit {job.exitCode}</span>{/if}
            </p>
            {#if job.error}<p class="job-error">{job.error}</p>{/if}
            {#if job.argv.length > 0}
              <p class="job-argv"><code>{job.argv.join(" ")}</code></p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-labelledby="logs-heading" class="block">
    <div class="block-head">
      <h4 id="logs-heading">Container and app log</h4>
      <div class="row">
        <button disabled={logs.kind === "loading"} onclick={onlogs}>
          {logs.kind === "loading" ? "Loading..." : "Refresh log"}
        </button>
        <button class="ghost" disabled={!logText} onclick={() => copy("log", logText)}>Copy log</button>
      </div>
    </div>
    {#if copied}
      <p class="feedback ok" role="status">{copied === "log" ? "Log copied." : "Job list copied."}</p>
    {/if}
    {#if copyError}
      <p class="feedback error" role="alert">{copyError}</p>
    {/if}
    {#if logs.kind === "idle" || logs.kind === "loading"}
      <p class="hint">Reading the last entries from the host...</p>
    {:else if logs.kind === "error"}
      <p class="feedback error" role="alert">{logs.message}</p>
    {:else if !logs.data.available || logs.data.entries.length === 0}
      <p class="hint">No logs available for this app right now.</p>
    {:else}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex: the log scrolls, so it must take focus -->
      <pre class="log" tabindex="0" aria-label="Application log, last entries">{logText}</pre>
      <p class="hint muted">Last line: {lastLine(logText) || "no entries"}</p>
    {/if}
  </section>
</div>

<style>
  .pane { display: grid; gap: 1rem; min-width: 0; }
  .block { display: grid; gap: 0.5rem; min-width: 0; padding-top: 0.75rem; border-top: 1px solid var(--border); }
  .block:first-child { border-top: 0; padding-top: 0; }
  .block-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  h4 { margin: 0; font-size: 0.9375rem; color: var(--text); }
  .row { display: flex; flex-wrap: wrap; gap: 0.375rem; }
  button {
    min-height: 2rem; padding: 0 0.75rem; border: 1px solid var(--border); border-radius: 0.375rem;
    background: var(--panel-solid); color: var(--text); font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  button.ghost { background: transparent; }
  .hint { margin: 0; font-size: 0.875rem; color: var(--text); overflow-wrap: anywhere; }
  .muted { color: var(--muted); font-size: 0.75rem; }
  .jobs { list-style: none; display: grid; gap: 0.5rem; margin: 0; padding: 0; }
  .jobs li {
    display: grid; gap: 0.25rem; min-width: 0; padding: 0.625rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .jobs li[data-tone="danger"] { border-color: var(--danger); }
  .job-head { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
  .job-head code { font-size: 0.8125rem; color: var(--text); }
  .job-meta { margin: 0; font-size: 0.75rem; color: var(--muted); }
  .job-error { margin: 0; font-size: 0.8125rem; color: var(--danger); overflow-wrap: anywhere; }
  .job-argv { margin: 0; font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill {
    padding: 0.0625rem 0.4375rem; border: 1px solid var(--border); border-radius: 999px;
    font-size: 0.6875rem; color: var(--muted);
  }
  .pill[data-tone="ok"] { color: var(--ok); border-color: var(--ok); background: var(--ok-bg); }
  .pill[data-tone="danger"] { color: var(--danger); border-color: var(--danger); background: var(--danger-bg); }
  .pill[data-tone="warn"] { color: var(--warn); border-color: var(--warn); background: var(--warn-bg); }
  .log {
    margin: 0; max-height: 18rem; overflow: auto; padding: 0.625rem; border: 1px solid var(--border);
    border-radius: 0.5rem; background: var(--panel-solid); color: var(--text);
    font-family: var(--font-mono); font-size: 0.75rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  @media (max-width: 400px) {
    .block-head { align-items: flex-start; }
  }
</style>
