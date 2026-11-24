<script lang="ts">
  import type { LaunchMode, TileCategory } from "./create-app-draft.ts";
  import { LAUNCH_MODES, TILE_CATEGORIES, tileGlyphPath } from "./create-app-draft.ts";

  let {
    appId, title, description, url, mode, categoryId, issues, touched,
    onCategorySelect, onModeSelect, onChange,
  }: {
    appId: string;
    title: string;
    description: string;
    url: string;
    mode: LaunchMode;
    categoryId: string;
    issues: { field: string; message: string }[];
    touched: boolean;
    onCategorySelect: (id: string) => void;
    onModeSelect: (mode: LaunchMode) => void;
    onChange: (field: "id" | "title" | "description" | "url", value: string) => void;
  } = $props();

  let category = $derived(TILE_CATEGORIES.find((c: TileCategory) => c.id === categoryId) ?? TILE_CATEGORIES[0]!);
  let slug = $derived.by(() => appId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
  let issueOf = $derived((field: string) => issues.find((issue) => issue.field === field)?.message ?? null);
  let modeHint = $derived(LAUNCH_MODES.find((option) => option.id === mode)?.hint ?? "");
</script>

<div class="ca-builder">
  <div class="ca-preview" style={`--tile-accent:${category.accent};`}>
    <div class="ca-tile" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
        stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d={tileGlyphPath(category)}></path>
      </svg>
    </div>
    <div class="ca-preview-meta">
      <strong>{title.trim() || "New app"}</strong>
      <span class="ca-mono">/apps/{slug || "untitled"}</span>
      <span class="ca-preview-cat">{category.label}</span>
    </div>
  </div>

  <div class="ca-field">
    <label for="ca-id">App ID</label>
    <input id="ca-id" type="text" value={appId} placeholder="analytics-portal" autocomplete="off"
      oninput={(event) => onChange("id", event.currentTarget.value)}
      aria-invalid={touched && issueOf("id") ? "true" : undefined} aria-describedby="ca-id-hint" />
    <span id="ca-id-hint" class="ca-hint">
      {slug ? `Resolves to ${slug}` : "Lowercase letters, digits, hyphens. Derived from the title when left blank."}
    </span>
    {#if touched && issueOf("id")}<span class="ca-error">{issueOf("id")}</span>{/if}
  </div>

  <div class="ca-field">
    <label for="ca-title">Title</label>
    <input id="ca-title" type="text" value={title} placeholder="Analytics Portal" autocomplete="off"
      oninput={(event) => onChange("title", event.currentTarget.value)}
      aria-invalid={touched && issueOf("title") ? "true" : undefined} />
    {#if touched && issueOf("title")}<span class="ca-error">{issueOf("title")}</span>{/if}
  </div>

  <div class="ca-field">
    <label for="ca-desc">Description</label>
    <input id="ca-desc" type="text" value={description} placeholder="Short summary shown in the launcher"
      oninput={(event) => onChange("description", event.currentTarget.value)}
      aria-invalid={touched && issueOf("description") ? "true" : undefined} />
    <span class="ca-hint">{description.trim().length} / 240 characters</span>
    {#if touched && issueOf("description")}<span class="ca-error">{issueOf("description")}</span>{/if}
  </div>

  <div class="ca-field">
    <label for="ca-url">App URL</label>
    <input id="ca-url" type="url" value={url} placeholder="https://app.example.com/" autocomplete="off"
      oninput={(event) => onChange("url", event.currentTarget.value)}
      aria-invalid={touched && issueOf("url") ? "true" : undefined} />
    {#if touched && issueOf("url")}<span class="ca-error">{issueOf("url")}</span>{/if}
  </div>

  <div class="ca-field">
    <span class="ca-legend" id="ca-cat-label">Tile category</span>
    <div class="ca-cats" role="radiogroup" aria-labelledby="ca-cat-label">
      {#each TILE_CATEGORIES as option (option.id)}
        <button type="button" role="radio" aria-checked={categoryId === option.id}
          class:active={categoryId === option.id} onclick={() => onCategorySelect(option.id)}>
          <span class="ca-swatch" style={`background:${option.accent};`} aria-hidden="true"></span>
          {option.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="ca-field">
    <span class="ca-legend" id="ca-mode-label">Launch mode</span>
    <div class="ca-modes" role="radiogroup" aria-labelledby="ca-mode-label">
      {#each LAUNCH_MODES as option (option.id)}
        <button type="button" role="radio" aria-checked={mode === option.id}
          class:active={mode === option.id} onclick={() => onModeSelect(option.id)}>
          <strong>{option.label}</strong>
          <span class="ca-hint">{option.hint}</span>
        </button>
      {/each}
    </div>
    <span class="ca-hint">{modeHint}</span>
  </div>
</div>

<style>
  .ca-builder { display: grid; gap: 0.75rem; align-content: start; min-width: 0; }
  .ca-preview { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); }
  .ca-tile {
    display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 0.75rem;
    background: var(--tile-accent, var(--accent)); color: #fff; flex: 0 0 auto;
  }
  .ca-preview-meta { display: grid; gap: 0.125rem; min-width: 0; }
  .ca-preview-meta strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ca-preview-cat { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .ca-mono { font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .ca-field { display: grid; gap: 0.25rem; min-width: 0; }
  .ca-field label, .ca-legend { font-size: 0.875rem; font-weight: 600; }
  .ca-field input { width: 100%; min-height: var(--ui-control-height); }
  .ca-field input[aria-invalid="true"] { border-color: var(--danger); }
  .ca-hint { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .ca-error { font-size: 0.75rem; color: var(--danger); overflow-wrap: anywhere; }
  .ca-cats { display: flex; gap: 0.375rem; flex-wrap: wrap; }
  .ca-cats button { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; padding: 0.1875rem 0.5rem; }
  .ca-cats button.active { border-color: var(--accent); color: var(--accent); }
  .ca-swatch { width: 0.75rem; height: 0.75rem; border-radius: 999px; display: inline-block; }
  .ca-modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr)); gap: 0.375rem; }
  .ca-modes button { display: grid; gap: 0.125rem; text-align: left; font-size: 0.8125rem; padding: 0.5rem 0.625rem; }
  .ca-modes button.active { border-color: var(--accent); background: var(--surface); }
  @media (max-width: 400px) {
    .ca-cats button { flex: 1 1 calc(50% - 0.25rem); justify-content: center; }
  }
</style>
