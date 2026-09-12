// Shared by the browser route and the MCP Page; theme values come from widget-tokens.
export const CONNECTION_MANAGER_STYLE = String.raw`
.integration .provider-mark svg{width:65%;height:65%;fill:currentColor}
.integration .integration-signin{display:inline-flex;align-items:center;min-height:var(--control-size);padding:var(--space-3) var(--space-4);margin-bottom:var(--space-4);border-radius:var(--radius-control);text-decoration:none}
.integration .identity-guide[open]{padding-bottom:var(--space-3)}
.integration .connection-state[data-ready=true]{color:var(--success-text);background:color-mix(in srgb,var(--success-text) 10%,var(--surface))}

.surface>.body.integration{margin:0 auto}
.integration.manager{container:integration / inline-size;--integration-rail:12rem;--integration-gap:var(--space-6);max-width:var(--measure);width:100%}
.integration .identity-heading,.integration .provider-heading,.integration .connection-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4)}
.integration .identity-heading :is(h1,h2){margin:0}.integration .identity-heading p{margin:var(--space-1) 0 0}
.integration .identity-count{font:600 var(--type-caption) var(--font-body);color:var(--text-dim);white-space:nowrap}
.integration .identity-bar{display:flex;gap:var(--space-3);align-items:end;flex-wrap:wrap;margin:var(--space-4) 0}
.integration .identity-bar>label{flex:1;max-width:340px;min-width:160px;margin:0}
.integration .identity-bar select{margin-top:var(--space-2)}
.integration .identity-tools{position:relative;margin:0;padding:0;border:0;background:none}
.integration .identity-tools summary{min-height:var(--control-size);display:flex;align-items:center;border:var(--stroke) solid var(--sep-strong);border-radius:var(--radius-control);padding:var(--space-2) var(--space-3);font-size:var(--type-small)}
.integration .identity-tools[open] .identity-actions{position:absolute;right:0;top:100%;z-index:2;min-width:210px;background:var(--surface);padding:var(--space-3);border:var(--stroke) solid var(--sep-strong);border-radius:var(--radius-panel);box-shadow:var(--shadow-pop)}
.integration .identity-tools .identity-actions{display:grid;margin-top:var(--space-1)}
.integration .identity-layout{display:grid;grid-template-columns:var(--integration-rail) minmax(0,1fr);gap:var(--integration-gap);align-items:start}
.integration .identity-providers{display:grid;gap:var(--space-1);align-content:start;padding-right:var(--space-4);border-right:var(--stroke) solid var(--sep)}
.integration .identity-providers input{margin-bottom:var(--space-2);font-size:var(--type-small)}
.integration .identity-providers button{display:flex;text-align:left;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);min-height:var(--control-size);border-color:transparent;background:transparent}
.integration .identity-providers button:hover{background:var(--hover)}
.integration [aria-pressed=true]{border-color:var(--sep-strong)!important;background:var(--field)!important;font-weight:700}
.integration .provider-mark{display:grid;place-items:center;flex:none;width:32px;height:32px;border:var(--stroke) solid var(--sep-strong);border-radius:var(--radius-control);background:var(--field);font:700 var(--type-small) var(--font-body);color:var(--text)}
.integration .provider-heading .provider-mark{width:44px;height:44px;font-size:var(--type-section);border-radius:var(--radius-panel)}
.integration .provider-title{display:flex;align-items:center;gap:var(--space-3);min-width:0}
.integration .provider-title h2{font-size:var(--type-title);margin:0}.integration .provider-title p{margin:var(--space-1) 0 0}
.integration .provider-count{margin-left:auto;font:600 var(--type-caption) var(--font-body);color:var(--text-dim)}
.integration .identity-detail{min-width:0}.integration .identity-detail>p{max-width:66ch}
.integration .connection-card{border:0;border-top:var(--stroke) solid var(--sep);border-radius:0;padding:var(--space-5) 0;margin:var(--space-4) 0 0;background:transparent}
.integration .connection-card h3{margin:0;font-size:var(--type-section);overflow-wrap:anywhere}
.integration .connection-heading{align-items:start}.integration .connection-heading small{margin:3px 0 0}
.integration .connection-state{font-size:var(--type-caption);line-height:1.5;border:var(--stroke) solid var(--sep-strong);border-radius:var(--radius-pill);padding:3px var(--space-2);white-space:nowrap}
.integration .connection-state[data-ready=true]{color:var(--success-text);background:color-mix(in srgb,var(--success-text) 10%,var(--surface))}
.integration .identity-tags{display:flex;flex-wrap:wrap;gap:var(--space-2);margin:var(--space-3) 0;color:var(--text-dim);font-size:var(--type-caption)}
.integration .identity-actions{display:flex;gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-4)}.integration .identity-workbench{margin-top:0}.integration .identity-credential-status{display:grid;gap:var(--space-2);margin:var(--space-3) 0;font-size:var(--type-small)}.integration .identity-credential-status>div{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:var(--space-2);padding:var(--space-2) 0;border-bottom:var(--stroke) solid var(--sep)}.integration .credential-field-state{font-size:var(--type-caption);color:var(--warning)}.integration .credential-field-state[data-stored=true]{color:var(--success-text)}
.integration .identity-fields{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);margin:var(--space-4) 0}
.integration .identity-fields label{min-width:0}.integration .identity-fields input,.integration .identity-fields select{margin-top:var(--space-2)}
.integration .identity-feedback{min-height:24px;margin:var(--space-3) 0;color:var(--text-dim);overflow-wrap:anywhere}
.integration .identity-path{font:var(--type-caption) var(--font-mono);overflow-wrap:anywhere;margin:var(--space-3) 0 var(--space-4);color:var(--text-dim)}
.integration .identity-check{display:flex;align-items:center;gap:var(--space-2)}.integration .identity-check input{width:18px;height:18px;flex:none}
.integration .identity-empty{border:0;border-top:var(--stroke) solid var(--sep);border-radius:0;padding:var(--space-6) 0;margin:var(--space-5) 0;background:transparent}
.integration .identity-empty h3{margin:0 0 var(--space-2);font-size:var(--type-section)}.integration .identity-empty p{max-width:50ch;margin-bottom:var(--space-4)}
.integration .danger{color:var(--destructive-text)}.integration .identity-guide a{display:inline-block;margin:var(--space-2) var(--space-3) var(--space-1) 0}
.integration .identity-guide li{font-size:var(--type-small)}.integration .identity-muted{font-size:var(--type-caption);color:var(--text-dim)}
.integration .identity-form{border:var(--stroke) solid var(--sep-strong);border-radius:var(--radius-panel);padding:var(--space-4)}
.integration .identity-readonly{padding:var(--space-3) var(--space-4);border-left:3px solid var(--os-accent);background:var(--field);font-size:var(--type-small)}
.integration .identity-summary{display:flex;align-items:center;gap:var(--space-4);padding:0 0 var(--space-4);margin-bottom:var(--space-6);border:0;border-bottom:var(--stroke) solid var(--sep);border-radius:0;background:transparent}
.integration .identity-ring{width:64px;height:64px;flex:none;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--os-accent) var(--ready-angle),var(--sep) 0)}
.integration .identity-ring strong{display:grid;place-items:center;width:50px;height:50px;border-radius:50%;background:var(--surface);font:700 var(--type-section) var(--font-body)}
.integration .identity-summary dl{display:flex;gap:var(--space-6);flex-wrap:wrap;margin:0}.integration .identity-summary dt{font-size:var(--type-caption);color:var(--text-dim)}.integration .identity-summary dd{font-weight:700;font-size:var(--type-section);margin:2px 0 0}
.integration :is(button,a,input,select,summary):focus-visible{outline:var(--focus-width) solid var(--os-accent);outline-offset:var(--focus-gap)}
@container integration (max-width:48rem){.surface>.body.integration{margin:0 auto}
.integration.manager{--integration-rail:180px;--integration-gap:var(--space-4)}.integration .identity-providers{padding-right:var(--space-3)}.integration .identity-heading{align-items:start}.integration .identity-count{white-space:normal;text-align:right}.integration .identity-summary dl{gap:var(--space-4)}}
@container integration (max-width:35rem){.integration .owner-picker{max-width:none;flex-basis:100%}.integration .identity-workbench{width:100%}.integration .identity-layout{grid-template-columns:1fr;gap:var(--space-4)}.integration .identity-providers{display:none;grid-template-columns:repeat(2,minmax(0,1fr));padding:0 0 var(--space-3);border:0;border-bottom:var(--stroke) solid var(--sep)}.integration .identity-providers input{grid-column:1/-1;position:sticky;top:0;background:var(--surface);z-index:1}.integration .identity-providers button{font-size:var(--type-caption);padding:var(--space-2);gap:var(--space-2)}.integration .identity-fields{grid-template-columns:1fr}.integration .identity-bar{gap:var(--space-2);margin:var(--space-4) 0}.integration .identity-bar>label{max-width:none;flex-basis:100%}.integration .connection-card{padding:var(--space-4)}.integration .provider-heading{align-items:start;flex-wrap:wrap}.integration .identity-summary{padding:0 0 var(--space-4);gap:var(--space-3)}.integration .identity-summary dl{gap:var(--space-3)}.integration .identity-summary dd{font-size:var(--type-section)}.integration .identity-tools[open] .identity-actions{left:0;right:auto}.integration .identity-heading p{font-size:var(--type-small)}}

.integration .owner-picker{position:relative;min-width:220px;flex:1;max-width:340px}.integration .identity-picker-label{display:block;margin-bottom:var(--space-2);font-size:var(--type-caption);font-weight:650;color:var(--text-dim)}.integration .owner-picker-trigger{display:flex;align-items:center;width:100%;justify-content:space-between;text-align:left;background:var(--field);border-color:var(--sep-strong)}
.integration .owner-picker-popup{position:absolute;z-index:3;top:calc(100% + 6px);left:0;right:0;max-height:240px;overflow:auto;padding:var(--space-2);background:var(--surface);border:var(--stroke) solid var(--sep-strong);border-radius:var(--radius);box-shadow:var(--shadow-pop)}
.integration .owner-picker-option{display:flex;width:100%;text-align:left;background:transparent;border-color:transparent}.integration .owner-picker-option:hover,.integration .owner-picker-option:focus-visible,.integration .owner-picker-option[aria-selected=true]{background:var(--hover);border-color:var(--sep-strong)}.integration .owner-picker-option[aria-selected=true]{font-weight:700}
.integration .service-picker{display:none}
.integration .identity-context{flex:1;min-width:0;margin:0;padding:0;background:transparent;border:0}
.integration .identity-context>summary{display:flex;align-items:center;min-height:var(--control-size);padding:var(--space-2) var(--space-3);border:var(--stroke) solid var(--sep-strong);border-radius:var(--radius-control);font-size:var(--type-small);font-weight:var(--weight-medium);overflow-wrap:anywhere}
.integration .identity-context>summary::before{content:"+";margin-right:var(--space-2)}.integration .identity-context[open]>summary::before{content:"−"}
.integration .identity-context-controls{display:flex;align-items:end;gap:var(--space-2);flex-wrap:wrap;padding-top:var(--space-3)}
.integration .identity-context .owner-picker{min-width:0;flex-basis:100%;max-width:none}
.integration .identity-bar{align-items:start}
.integration .identity-context .identity-workbench{width:auto}

.integration .identity-summary{padding-block:var(--space-3);margin-bottom:var(--space-4)}
.integration .identity-ring{display:none}
.integration .identity-providers{overflow:visible}
@container integration (max-width:35rem){.integration .service-picker{display:block;margin-bottom:var(--space-4)}.integration .connection-card{padding-inline:0}.integration .identity-summary dl{gap:var(--space-4)}.integration .identity-tools[open] .identity-actions{position:static;box-shadow:none;min-width:0}.integration .identity-credential-status>div{grid-template-columns:minmax(0,1fr) auto}.integration .identity-credential-status>div>button{grid-column:1/-1;justify-self:start}}
@container mso (max-height:20rem){.integration .service-picker{margin-bottom:var(--space-2);font-size:0}.integration .service-picker select{font-size:var(--type-small);margin:0}.integration .identity-heading,.integration .identity-summary{display:none}.integration .identity-bar{margin-block:var(--space-2)}.integration .identity-picker-label{display:none}}
`;