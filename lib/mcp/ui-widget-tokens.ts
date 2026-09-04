/**
 * Shared visual contract for ChatGPT Block and Page resources.
 *
 * Core values mirror rahmanef.com/app/globals.css. The widget keeps its own
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
--warning:#ff9500;
--info:#0060df;
--destructive-text:#d70015;
--font-display:"Plus Jakarta Sans",Inter,ui-sans-serif,system-ui,sans-serif;
--font-body:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
--font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;
--radius:10px;
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
