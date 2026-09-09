// Shared by the browser route and the MCP Page; theme values come from widget-tokens.
export const CONNECTION_MANAGER_STYLE = String.raw`
.integration .provider-mark svg{width:65%;height:65%;fill:currentColor}
.integration .integration-signin{display:inline-flex;align-items:center;min-height:44px;padding:10px 16px;margin-bottom:18px;border-radius:9px;text-decoration:none}
.integration .identity-guide[open]{padding-bottom:12px}
.integration .connection-state[data-ready=true]{color:var(--success-text);background:color-mix(in srgb,var(--success-text) 10%,var(--surface))}

.integration.manager{--integration-rail:224px;--integration-gap:24px;max-width:1180px;width:100%}
.integration .identity-heading,.integration .provider-heading,.integration .connection-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}
.integration .identity-heading :is(h1,h2){margin:0}.integration .identity-heading p{margin:5px 0 0}
.integration .identity-count{font:600 12px var(--font-body);color:var(--text-dim);white-space:nowrap}
.integration .identity-bar{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:22px 0}
.integration .identity-bar>label{flex:1;max-width:340px;min-width:160px;margin:0}
.integration .identity-bar select{margin-top:6px}
.integration .identity-tools{position:relative;margin:0;padding:0;border:0;background:none}
.integration .identity-tools summary{min-height:42px;display:flex;align-items:center;border:1px solid var(--sep-strong);border-radius:9px;padding:8px 13px;font-size:13px}
.integration .identity-tools[open] .identity-actions{position:absolute;right:0;top:100%;z-index:2;min-width:210px;background:var(--surface);padding:10px;border:1px solid var(--sep-strong);border-radius:12px;box-shadow:var(--shadow-pop)}
.integration .identity-tools .identity-actions{display:grid;margin-top:5px}
.integration .identity-layout{display:grid;grid-template-columns:var(--integration-rail) minmax(0,1fr);gap:var(--integration-gap);align-items:start}
.integration .identity-providers{display:grid;gap:5px;align-content:start;padding-right:18px;border-right:1px solid var(--sep)}
.integration .identity-providers input{margin-bottom:7px;font-size:14px}
.integration .identity-providers button{display:flex;text-align:left;align-items:center;gap:10px;padding:9px 10px;min-height:46px;border-color:transparent;background:transparent}
.integration .identity-providers button:hover{background:var(--hover)}
.integration [aria-pressed=true]{border-color:var(--sep-strong)!important;background:var(--field)!important;font-weight:700}
.integration .provider-mark{display:grid;place-items:center;flex:none;width:32px;height:32px;border:1px solid var(--sep-strong);border-radius:9px;background:var(--field);font:700 13px var(--font-body);color:var(--text)}
.integration .provider-heading .provider-mark{width:44px;height:44px;font-size:18px;border-radius:12px}
.integration .provider-title{display:flex;align-items:center;gap:12px;min-width:0}
.integration .provider-title h2{font-size:22px;margin:0}.integration .provider-title p{margin:4px 0 0}
.integration .provider-count{margin-left:auto;font:600 11px var(--font-body);color:var(--text-dim)}
.integration .identity-detail{min-width:0}.integration .identity-detail>p{max-width:66ch}
.integration .connection-card{border:1px solid var(--sep-strong);border-radius:14px;padding:20px;margin:14px 0;background:var(--field)}
.integration .connection-card h3{margin:0;font-size:17px;overflow-wrap:anywhere}
.integration .connection-heading{align-items:start}.integration .connection-heading small{margin:3px 0 0}
.integration .connection-state{font-size:12px;line-height:1.5;border:1px solid var(--sep-strong);border-radius:99px;padding:3px 9px;white-space:nowrap}
.integration .connection-state[data-ready=true]{color:var(--success-text);background:color-mix(in srgb,var(--success-text) 10%,var(--surface))}
.integration .identity-tags{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0;color:var(--text-dim);font-size:12px}
.integration .identity-tags span+span:before{content:"·";margin-right:6px}
.integration .identity-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.integration .identity-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}
.integration .identity-fields label{min-width:0}.integration .identity-fields input,.integration .identity-fields select{margin-top:6px}
.integration .identity-feedback{min-height:24px;margin:12px 0;color:var(--text-dim);overflow-wrap:anywhere}
.integration .identity-path{font:12px var(--font-mono);overflow-wrap:anywhere;margin:10px 0 18px;color:var(--text-dim)}
.integration .identity-check{display:flex;align-items:center;gap:8px}.integration .identity-check input{width:18px;height:18px;flex:none}
.integration .identity-empty{border:1px dashed var(--sep-strong);border-radius:14px;padding:28px;margin:20px 0;background:var(--field)}
.integration .identity-empty h3{margin:0 0 8px;font-size:17px}.integration .identity-empty p{max-width:50ch;margin-bottom:18px}
.integration .danger{color:var(--destructive-text)}.integration .identity-guide a{display:inline-block;margin:8px 12px 5px 0}
.integration .identity-guide li{font-size:13px}.integration .identity-muted{font-size:12px;color:var(--text-dim)}
.integration .identity-form{border:1px solid var(--sep-strong);border-radius:12px;padding:16px}
.integration .identity-readonly{padding:12px 16px;border-left:3px solid var(--os-accent);background:var(--field);font-size:13px}
.integration .identity-summary{display:flex;align-items:center;gap:18px;padding:16px 20px;margin-bottom:22px;border:1px solid var(--sep);border-radius:14px;background:var(--field)}
.integration .identity-ring{width:64px;height:64px;flex:none;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--os-accent) var(--ready-angle),var(--sep) 0)}
.integration .identity-ring strong{display:grid;place-items:center;width:50px;height:50px;border-radius:50%;background:var(--surface);font:700 18px var(--font-body)}
.integration .identity-summary dl{display:flex;gap:24px;flex-wrap:wrap;margin:0}.integration .identity-summary dt{font-size:12px;color:var(--text-dim)}.integration .identity-summary dd{font-weight:700;font-size:20px;margin:2px 0 0}
.integration :is(button,a,input,select,summary):focus-visible{outline:2px solid var(--os-accent);outline-offset:3px}
@media(max-width:760px){.integration.manager{--integration-rail:180px;--integration-gap:16px}.integration .identity-providers{padding-right:12px}.integration .identity-heading{align-items:start}.integration .identity-count{white-space:normal;text-align:right}.integration .identity-summary dl{gap:16px}}
@media(max-width:560px){.integration .identity-layout{grid-template-columns:1fr;gap:18px}.integration .identity-providers{grid-template-columns:repeat(2,minmax(0,1fr));max-height:240px;overflow-y:auto;padding:0 0 12px;border:0;border-bottom:1px solid var(--sep)}.integration .identity-providers input{grid-column:1/-1;position:sticky;top:0;background:var(--surface);z-index:1}.integration .identity-providers button{font-size:12px;padding:7px;gap:7px}.integration .identity-fields{grid-template-columns:1fr}.integration .identity-bar{gap:8px;margin:18px 0}.integration .identity-bar>label{max-width:none;flex-basis:100%}.integration .connection-card{padding:16px}.integration .provider-heading{align-items:start;flex-wrap:wrap}.integration .identity-summary{padding:14px;gap:14px}.integration .identity-summary dl{gap:14px}.integration .identity-summary dd{font-size:17px}.integration .identity-tools[open] .identity-actions{left:0;right:auto}.integration .identity-heading p{font-size:13px}}
`;
