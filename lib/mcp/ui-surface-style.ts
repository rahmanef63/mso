import { MSO_WIDGET_TOKENS } from "./ui-widget-tokens";

export const MSO_SURFACE_STYLE = String.raw`
${MSO_WIDGET_TOKENS}
:root{--page-height:680px;--safe-top:0px;--safe-right:0px;--safe-bottom:0px;--safe-left:0px;font-family:var(--font-body)}
*{box-sizing:border-box}
html,body{margin:0;min-width:0;background:transparent;color:var(--text)}
body{font:var(--type-small)/var(--line-body) var(--font-body)}
.surface{container:mso / size;display:flex;width:100%;height:var(--page-height);min-height:0;overflow:hidden;flex-direction:column;border:var(--stroke) solid var(--sep);border-radius:var(--radius-panel);background:var(--surface)}
.bar{display:flex;flex:none;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:var(--stroke) solid var(--sep);padding-left:max(var(--space-4),var(--safe-left));padding-right:max(var(--space-4),var(--safe-right))}
.brand{width:var(--brand-size);height:var(--brand-size);flex:none}.brand svg{display:block;width:100%;height:100%}
.heading{min-width:0;flex:1}.heading strong{display:block;font-size:var(--type-small);font-weight:var(--weight-strong)}
.heading span{display:block;font-size:var(--type-caption);color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tools,.row{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}.tools{flex-wrap:nowrap}
button,.button,select,input{font:var(--weight-medium) var(--type-small)/var(--line-body) var(--font-body);color:var(--text);min-height:var(--control-size);border:var(--stroke) solid var(--sep-strong);border-radius:var(--radius-control);background:var(--field);padding:var(--space-2) var(--space-3)}
button,.button{appearance:none;cursor:pointer;text-decoration:none}button:hover,.button:hover{background:var(--hover)}button:disabled{cursor:not-allowed;opacity:.6}
:is(button,a,select,input,summary):focus-visible{outline:var(--focus-width) solid var(--os-accent);outline-offset:var(--focus-gap)}
.primary{border-color:var(--text);background:var(--text);color:var(--surface)}.primary:hover{background:var(--text)}
.icon-button{width:var(--control-size);padding:var(--space-2);flex:none}.icon-button svg{display:block;width:var(--icon-size);height:var(--icon-size);margin:auto;stroke:currentColor;fill:none;stroke-width:1.5}
.page-nav{min-width:0;max-width:12rem;width:100%}.open-direct{font-size:var(--type-caption);color:inherit}
.open-feedback:empty,.mode-badge:empty{display:none}.open-feedback,.mode-badge{font-size:var(--type-caption);color:var(--text-dim)}
.page-feedback{padding:0 var(--space-4)}.page-feedback:has(>:not(:empty):not([hidden])){padding-block:var(--space-2)}
.body{min-height:0;flex:1 1 0;overflow:auto;margin:0 auto;width:100%;padding:var(--space-6);padding-bottom:max(var(--space-6),var(--safe-bottom));overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:var(--scroll-thumb) transparent}
.home{display:grid;gap:var(--space-5);max-width:var(--measure);margin:auto}
.hero h2{margin:0;font:var(--weight-strong) var(--type-title)/var(--line-title) var(--font-display)}.hero p{max-width:var(--measure-copy);margin:var(--space-2) 0 0;color:var(--text-dim)}
.section-title{margin:var(--space-2) 0 0;font-size:var(--type-caption);font-weight:var(--weight-strong);color:var(--text-dim)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:0 var(--space-6)}
.card{min-width:0;text-align:left;padding:var(--space-4) 0;border:0;border-bottom:var(--stroke) solid var(--sep);border-radius:0;background:transparent}.card strong{display:block;font-size:var(--type-body)}.card span{display:block;margin-top:var(--space-1);font-size:var(--type-small);color:var(--text-dim)}.tag{font-family:var(--font-mono);font-size:var(--type-caption)}
.stage{display:flex;min-height:100%;flex-direction:column;gap:var(--space-4)}.stage-head{display:flex;align-items:center;gap:var(--space-3)}
.stage-title{min-width:0;flex:1}.stage-title strong{display:block;font-size:var(--type-section)}.stage-title span{display:block;font-size:var(--type-caption);color:var(--text-dim);overflow-wrap:anywhere}
.stage-content{min-height:0;flex:1}.notice{padding:var(--space-5) 0}.notice h3{margin:0;font:var(--weight-strong) var(--type-section)/var(--line-title) var(--font-display)}.notice p{max-width:var(--measure-copy);margin:var(--space-2) 0;color:var(--text-dim)}.notice .row{margin-top:var(--space-4)}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-4)}.metric{padding:var(--space-4) 0;border-bottom:var(--stroke) solid var(--sep)}.metric span{display:block;font-size:var(--type-caption);color:var(--text-dim)}.metric strong{display:block;margin-top:var(--space-2);font-size:var(--type-title)}
.list{margin-top:var(--space-4)}.line{display:flex;align-items:baseline;gap:var(--space-4);min-height:var(--control-size);padding:var(--space-2) 0;border-bottom:var(--stroke) solid var(--sep);overflow-wrap:anywhere}.line span{color:var(--text-dim)}.line strong{margin-left:auto;min-width:0;text-align:right;overflow-wrap:anywhere}.mono{font-family:var(--font-mono)}
.loading{padding:var(--space-5) 0;color:var(--text-dim)}.error{color:var(--destructive-text)}
.project-input{display:block;width:100%;max-width:32rem;margin-block:var(--space-2) var(--space-4)}.report-preview{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--type-caption)/var(--line-body) var(--font-mono)}
.preview-frame{display:block;width:100%;height:clamp(16rem,60cqh,48rem);border:var(--stroke) solid var(--sep);border-radius:var(--radius);background:var(--field)}.preview-status{font-size:var(--type-caption);color:var(--text-dim)}.artifact-preview{max-width:100%;height:auto;border-radius:var(--radius)}
html[data-display-mode="fullscreen"],html[data-display-mode="fullscreen"] body{height:100%;width:100%;overflow:hidden}
html[data-display-mode="fullscreen"] .surface{height:100vh;height:100dvh;border:0;border-radius:0}
html[data-display-mode="fullscreen"] .bar{padding-top:max(var(--space-2),var(--safe-top))}
@container mso (max-width:36rem){.bar{gap:var(--space-2);padding-inline:var(--space-3)}.heading{display:none}.page-nav{flex:1;max-width:none}.body{padding:var(--space-4)}.tools .optional{display:none}.tools #open .open-label{display:none}.tools #open{font-size:var(--type-body);width:var(--control-size);padding:var(--space-2)}}
@container mso (max-width:22rem){.brand{width:var(--space-6);height:var(--space-6)}.bar{gap:var(--space-1);padding-inline:var(--space-2)}.page-nav{width:0}.body{padding:var(--space-3)}.metrics{gap:var(--space-2)}}
@container mso (max-height:20rem){.body{padding-block:var(--space-2)}.stage{gap:var(--space-2)}.stage-head .back{display:none}.preview-frame{height:12rem}.hero p{margin-block:var(--space-1)}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
@media(forced-colors:active){button,.button,select,input,.preview-frame{border-color:ButtonText}}
`;
