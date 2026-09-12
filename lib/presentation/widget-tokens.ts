/**
 * Shared visual contract for ChatGPT Block and Page resources.
 *
 * Core values follow the MSO presentation palette. The widget keeps its own
 * small presentation aliases, but the public brand palette stays single-source.
 */
const DARK_TOKENS = String.raw`
--text:#f2f2f5;
--text-dim:rgba(242,242,245,.64);
--text-faint:rgba(242,242,245,.4);
--sep:rgba(255,255,255,.1);
--sep-strong:rgba(255,255,255,.18);
--grouped:#000;
--fill:rgba(120,120,128,.24);
--fill2:rgba(120,120,128,.36);
--window-bg:rgba(34,34,40,.82);
--surface:#1b1b20;
--field:rgba(255,255,255,.08);
--hover:rgba(255,255,255,.08);
--hover-strong:rgba(255,255,255,.14);
--inset:rgba(0,0,0,.25);
--shadow-pop:0 0 0 .5px rgba(255,255,255,.08),0 16px 40px -8px rgba(0,0,0,.6);
--warning:#ff9f0a;
--info:#409cff;
--destructive-text:#ff5f57;
--success-text:#65d486;
`;

export const MSO_WIDGET_TOKENS = String.raw`
:root,:root[data-theme="light"]{
color-scheme:light;
--text:#1c1c1f;
--text-dim:rgba(28,28,31,.66);
--text-faint:rgba(28,28,31,.38);
--sep:rgba(0,0,0,.1);
--sep-strong:rgba(0,0,0,.16);
--os-accent:#1f6df0;
--accent-text:#fff;
--grouped:#f2f2f7;
--fill:rgba(118,118,128,.12);
--fill2:rgba(118,118,128,.24);
--window-bg:rgba(248,248,251,.86);
--surface:#f4f4f7;
--field:rgba(255,255,255,.7);
--hover:rgba(0,0,0,.05);
--hover-strong:rgba(0,0,0,.09);
--inset:rgba(0,0,0,.04);
--shadow-pop:0 0 0 .5px rgba(0,0,0,.12),0 14px 38px -8px rgba(0,0,0,.32);
--success:#34c759;
--success-text:#176e32;
--warning:#ff9500;
--info:#0060df;
--destructive-text:#d70015;
--font-display:var(--font-family,ui-sans-serif,system-ui,sans-serif);
--font-body:var(--font-family,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
--font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;
--radius:var(--border-radius-md,.5rem);
--radius-control:var(--border-radius-sm,.375rem);
--radius-panel:var(--border-radius-lg,.75rem);
--radius-pill:999px;
--space-1:.25rem;--space-2:.5rem;--space-3:.75rem;--space-4:1rem;--space-5:1.25rem;--space-6:1.5rem;--space-8:2rem;
--type-caption:var(--font-text-xs-size,.75rem);--type-small:var(--font-text-sm-size,.875rem);--type-body:var(--font-text-md-size,1rem);
--type-title:var(--font-heading-md-size,1.5rem);--type-section:var(--font-heading-sm-size,1.125rem);
--line-body:var(--font-text-md-line-height,1.5);--line-title:var(--font-heading-md-line-height,1.25);
--weight-medium:var(--font-weight-medium,500);--weight-strong:var(--font-weight-semibold,600);
--control-size:2.75rem;--icon-size:1.25rem;--brand-size:2rem;
--stroke:1px;--focus-width:2px;--focus-gap:2px;
--measure:72rem;--measure-copy:65ch;
--scroll-thumb:var(--sep-strong);
}
:root[data-theme="dark"]{color-scheme:dark;${DARK_TOKENS}}
@media(prefers-color-scheme:dark){:root:not([data-theme]){color-scheme:dark;${DARK_TOKENS}}}
`;

/** Keep a ChatGPT widget synchronized with the host theme, with media fallback. */
export const MSO_WIDGET_THEME_SCRIPT = String.raw`
function applyHostTheme(){
  const theme=window.openai&&window.openai.theme;
  if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme;
  else document.documentElement.removeAttribute("data-theme");
}
`;

/** Standard MCP Apps host styles override the shared defaults without loading fonts remotely. */
export const MSO_HOST_STYLE_ALIASES = {
  "--text": "--color-text-primary", "--text-dim": "--color-text-secondary", "--text-faint": "--color-text-tertiary",
  "--surface": "--color-background-primary", "--field": "--color-background-secondary", "--hover": "--color-background-tertiary",
  "--sep": "--color-border-secondary", "--sep-strong": "--color-border-primary", "--os-accent": "--color-text-info",
  "--success-text": "--color-text-success", "--destructive-text": "--color-text-danger",
} as const;
