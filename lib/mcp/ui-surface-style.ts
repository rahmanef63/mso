import { MSO_WIDGET_TOKENS } from "./ui-widget-tokens";

export const MSO_SURFACE_STYLE = String.raw`
${MSO_WIDGET_TOKENS}
:root{font-family:var(--font-body);--page-height:680px;--safe-top:0px;--safe-right:0px;--safe-bottom:0px;--safe-left:0px}
*{box-sizing:border-box}
html,body{margin:0;min-width:0;background:transparent;color:var(--text)}
body{font-family:var(--font-body)}
.surface{display:flex;height:var(--page-height);min-height:0;overflow:hidden;flex-direction:column;border:1px solid var(--sep);border-radius:12px;background:var(--surface)}
.bar{display:flex;flex:0 0 auto;align-items:center;gap:10px;min-height:58px;padding:10px 16px;border-bottom:1px solid var(--sep);padding-left:max(16px,var(--safe-left));padding-right:max(16px,var(--safe-right))}
.brand{width:32px;height:32px;flex:0 0 32px}.brand svg{display:block;width:100%;height:100%}
.heading{min-width:0;flex:1}.heading strong{display:block;font-size:14px;line-height:1.25;font-weight:750}
.heading span{display:block;margin-top:2px;font-size:11px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tools,.row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.tools{justify-content:flex-end}
button,.button{appearance:none;border:1px solid var(--sep-strong);background:transparent;color:var(--text);border-radius:7px;padding:8px 11px;min-height:36px;font:600 12px/1.3 var(--font-body);cursor:pointer;text-decoration:none}
button:hover,.button:hover{background:var(--hover)}
button:focus-visible,.button:focus-visible{outline:2px solid var(--os-accent);outline-offset:2px}
.primary{border-color:var(--text);background:var(--text);color:var(--surface)}
.primary:hover{background:var(--text);filter:brightness(.92)}
.open-direct{font-size:11px;color:inherit}.open-feedback{display:none}
.mode-badge{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.body{min-height:0;flex:1 1 0;overflow:auto;margin:0 auto;width:100%;padding:20px;padding-bottom:max(20px,var(--safe-bottom));overscroll-behavior:contain;scrollbar-gutter:stable}
.home{display:grid;gap:16px;max-width:1040px;margin:auto}
.hero{padding:4px 0 12px}.hero h2{margin:0;font:750 25px/1.25 var(--font-display)}.hero p{max-width:64ch;margin:8px 0 0;font-size:14px;line-height:1.6;color:var(--text-dim)}
.section-title{margin:8px 0 0;font-size:12px;font-weight:650;color:var(--text-dim)}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 24px}
.card{min-width:0;text-align:left;padding:16px 0;border:0;border-bottom:1px solid var(--sep);border-radius:0;background:transparent}
.card:hover{background:var(--hover)}.card strong{display:block;font-size:14px}.card span{display:block;margin-top:6px;font-size:12px;line-height:1.5;color:var(--text-dim)}
.tag{font:10px var(--font-mono)}
.stage{display:flex;min-height:0;height:100%;flex-direction:column}.stage-head{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.back{flex:0 0 auto}.stage-title{min-width:0;flex:1}.stage-title strong{display:block;font-size:17px}.stage-title span{display:block;margin-top:4px;font-size:12px;color:var(--text-dim)}
.stage>div:last-child{min-height:0;display:flex;flex-direction:column;flex:1}
.notice{display:grid;min-height:240px;place-items:center;padding:24px;text-align:center}.notice>div{max-width:520px}.notice h3{margin:0;font:700 19px/1.35 var(--font-display)}.notice p{margin:10px 0 0;color:var(--text-dim);font-size:14px;line-height:1.6}.notice .row{justify-content:center;margin-top:20px}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.metric{padding:16px 0;border-bottom:1px solid var(--sep)}.metric span{display:block;font-size:12px;color:var(--text-dim)}.metric strong{display:block;margin-top:8px;font:700 24px var(--font-display)}
.list{margin-top:16px}.line{display:flex;align-items:center;gap:16px;min-height:44px;padding:10px 0;border-bottom:1px solid var(--sep);font-size:13px}.line span{color:var(--text-dim)}.line strong{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mono{font-family:var(--font-mono)}
.loading{display:grid;min-height:240px;place-items:center;color:var(--text-dim);font-size:14px}.error{color:var(--destructive-text)}
html[data-display-mode="fullscreen"],html[data-display-mode="fullscreen"] body{height:100%;width:100%;overflow:hidden}
html[data-display-mode="fullscreen"] .surface{height:100vh;height:100dvh;min-height:0;max-height:none;border:0;border-radius:0}
html[data-display-mode="fullscreen"] .surface>.bar{padding-top:max(10px,var(--safe-top))}
@media(max-width:660px){.bar{padding:10px 12px}.body{padding:16px}.grid{grid-template-columns:1fr 1fr}.tools{gap:5px}.tools button,.tools .button{padding:8px}.heading span{max-width:150px}}
@media(max-width:420px){.bar{gap:8px;flex-wrap:wrap}.tools{margin-left:auto}.tools .optional{display:none}.tools button,.tools .button{font-size:11px;min-height:40px}.body{padding:14px}.grid{grid-template-columns:1fr}.metrics{gap:12px}.metric strong{font-size:20px}}
@media(pointer:coarse){button,.button{min-height:44px}}
`;
