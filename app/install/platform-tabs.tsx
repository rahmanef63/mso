"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { PLATFORM_INSTALL_GUIDES } from "@/lib/platform-install-guides";
import { PLATFORM_SUPPORT, type MsoPlatformId } from "@/lib/platform-support";
import { Copy } from "./copy";

const PLATFORM_IDS = PLATFORM_SUPPORT.map((platform) => platform.id);

function isPlatformId(value: string | null): value is MsoPlatformId {
  return value !== null && PLATFORM_IDS.includes(value as MsoPlatformId);
}

const PLATFORM_CHANGE_EVENT = "mso:install-platform-change";

function currentPlatform(): MsoPlatformId {
  const selected = new URLSearchParams(window.location.search).get("platform");
  return isPlatformId(selected) ? selected : "linux";
}

function subscribePlatformChange(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(PLATFORM_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(PLATFORM_CHANGE_EVENT, onChange);
  };
}

export function PlatformInstallTabs() {
  const active = React.useSyncExternalStore<MsoPlatformId>(subscribePlatformChange, currentPlatform, () => "linux");

  const select = React.useCallback((id: MsoPlatformId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("platform", id);
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(PLATFORM_CHANGE_EVENT));
  }, []);

  const activePlatform = PLATFORM_SUPPORT.find((platform) => platform.id === active) ?? PLATFORM_SUPPORT[0];
  const guide = PLATFORM_INSTALL_GUIDES[active];

  const selectAndFocus = (id: MsoPlatformId) => {
    select(id);
    requestAnimationFrame(() => document.getElementById(`platform-tab-${id}`)?.focus());
  };

  const move = (current: MsoPlatformId, offset: number) => {
    const index = PLATFORM_IDS.indexOf(current);
    const next = PLATFORM_IDS[(index + offset + PLATFORM_IDS.length) % PLATFORM_IDS.length];
    selectAndFocus(next);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div
        role="tablist"
        aria-label="MSO installation platform"
        className="flex overflow-x-auto border-b border-border bg-muted/30 p-1.5"
      >
        {PLATFORM_SUPPORT.map((platform) => (
          <button
            key={platform.id}
            id={`platform-tab-${platform.id}`}
            type="button"
            role="tab"
            aria-selected={active === platform.id}
            aria-controls={`platform-panel-${platform.id}`}
            tabIndex={active === platform.id ? 0 : -1}
            onClick={() => select(platform.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") { event.preventDefault(); move(platform.id, 1); }
              if (event.key === "ArrowLeft") { event.preventDefault(); move(platform.id, -1); }
              if (event.key === "Home") { event.preventDefault(); selectAndFocus(PLATFORM_IDS[0]); }
              if (event.key === "End") { event.preventDefault(); selectAndFocus(PLATFORM_IDS[PLATFORM_IDS.length - 1]); }
            }}
            className={[
              "min-h-10 shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors",
              active === platform.id
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            ].join(" ")}
          >
            <span className="block whitespace-nowrap">{platform.label}</span>
            <span className="mt-0.5 block whitespace-nowrap text-[10px] font-normal text-muted-foreground">
              {platform.modeLabel}
            </span>
          </button>
        ))}
      </div>

      <div
        id={`platform-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`platform-tab-${active}`}
        className="p-4 sm:p-6"
      >
        <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold tracking-tight">{activePlatform.label}</h3>
              <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                {activePlatform.modeLabel}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{activePlatform.summary}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              MSO manages: <span className="font-medium text-foreground">{activePlatform.hostScope}</span>
            </p>
          </div>
          <p className="max-w-sm rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Best for:</span> {guide.bestFor}
          </p>
        </div>

        <section className="mt-6" aria-labelledby={`requirements-${active}`}>
          <h4 id={`requirements-${active}`} className="text-sm font-semibold">Before you start</h4>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {guide.prerequisites.map((item) => (
              <li key={item} className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-7" aria-labelledby={`steps-${active}`}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h4 id={`steps-${active}`} className="text-sm font-semibold">Step by step</h4>
              <p className="mt-1 text-xs text-muted-foreground">Follow in order. Commands can be copied directly.</p>
            </div>
            {activePlatform.installCommand ? (
              <span className="text-xs text-muted-foreground">{guide.steps.length} steps</span>
            ) : null}
          </div>
          <ol className="mt-4 space-y-5">
            {guide.steps.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                <span className="flex size-8 items-center justify-center rounded-full border border-border bg-muted/30 text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h5 className="text-sm font-semibold">{step.title}</h5>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  {step.command ? <Copy text={step.command} /> : null}
                  {step.note ? (
                    <p className="mt-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Note:</span> {step.note}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-7 grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold">Troubleshooting</h4>
            <ul className="mt-3 space-y-2">
              {guide.troubleshooting.map((item) => (
                <li key={item} className="rounded-lg border border-border px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold">{"Official links & references"}</h4>
            <div className="mt-3 space-y-2">
              {guide.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/40"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {link.label}
                    <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{link.description}</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
