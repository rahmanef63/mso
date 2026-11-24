<script lang="ts">
  // Command input: IME-safe Enter/arrow handling, shell history on Up/Down,
  // Ctrl+C / Ctrl+L shortcuts. The parent owns sending, so the PTY stays the
  // single source of truth for session state.
  import { emptyHistory, pushHistory, stepHistory } from "./term-history";

  let {
    tabId,
    canType,
    sending = false,
    draft = $bindable(""),
    inputEl = $bindable<HTMLInputElement | undefined>(undefined),
    onsubmit,
    oninterrupt,
    onclear,
  }: {
    tabId: number;
    canType: boolean;
    sending?: boolean;
    draft?: string;
    inputEl?: HTMLInputElement | undefined;
    onsubmit: (text: string) => void;
    oninterrupt: () => void;
    onclear: () => void;
  } = $props();

  let history = $state(emptyHistory());

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canType) return;
    const text = draft;
    draft = "";
    history = pushHistory(history, text);
    onsubmit(text);
    inputEl?.focus();
  }

  function recall(delta: -1 | 1) {
    const next = stepHistory(history, delta);
    history = next.history;
    draft = next.value;
  }

  function onKeydown(event: KeyboardEvent) {
    // IME composition must never be hijacked: Enter/arrows belong to the input
    // method while it is composing a candidate.
    if (event.isComposing || event.keyCode === 229) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "ArrowUp") { event.preventDefault(); recall(-1); }
    else if (event.key === "ArrowDown") { event.preventDefault(); recall(1); }
    else if (mod && event.key === "c") { event.preventDefault(); oninterrupt(); }
    else if (mod && event.key === "l") { event.preventDefault(); onclear(); }
  }
</script>

<form class="input-row" onsubmit={submit}>
  <label class="sr-only" for={`term-cmd-${tabId}`}>Terminal command</label>
  <input
    id={`term-cmd-${tabId}`}
    class="cmd"
    type="text"
    bind:this={inputEl}
    bind:value={draft}
    onkeydown={onKeydown}
    placeholder={canType ? "Enter command and press Enter" : "Connect to send commands"}
    disabled={!canType}
    autocomplete="off"
    autocapitalize="off"
    spellcheck={false}
    enterkeyhint="send"
  />
  <button type="submit" class="primary" disabled={!canType}>{sending ? "Sending..." : "Send"}</button>
</form>

<style>
  .input-row { display: flex; flex-wrap: wrap; gap: 0.5rem; min-width: 0; }
  .cmd { flex: 1 1 11rem; min-width: 0; font-family: var(--font-mono); }
  .input-row button { flex: 0 0 auto; }
</style>
