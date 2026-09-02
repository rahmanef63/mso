"use client";

import { useEffect, useMemo, useState } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FormDrawer } from "@/features/appshell";
import type { UpdateCommit } from "@/lib/host/self-update";
import { parseChangelog } from "../lib/changelog";
import { ChangelogView } from "./changelog-view";

// The docs behind the update button: what is ABOUT to land, then what already has.
//
// Two different sources on purpose. The incoming list comes from the update check
// (`git log HEAD..origin/main`) because docs/CHANGELOG.md in this checkout is, by
// definition, the OLD one — it is generated at ship time and arrives WITH the update
// it would describe. The shipped list is that file, rendered by the same component
// "What's new" uses, so the drawer and the panel below it cannot look like two
// different products.

const REPO = "https://github.com/rahmanef63/mso";

const DOCS: [string, string][] = [
  ["README — what MSO is, and the security model", `${REPO}#readme`],
  ["Full changelog", `${REPO}/blob/main/docs/CHANGELOG.md`],
  ["Progress log — why each change happened", `${REPO}/blob/main/docs/PROGRESS.md`],
  ["CLI reference", `${REPO}/blob/main/docs/CLI.md`],
];

const CAPTION = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function UpdateNotes({ commits }: { commits: UpdateCommit[] }) {
  const [shipped, setShipped] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/changelog", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { markdown?: string } | null) => alive && setShipped(d?.markdown ?? ""))
      .catch(() => alive && setShipped(""));
    return () => {
      alive = false;
    };
  }, []);

  const days = useMemo(() => (shipped ? parseChangelog(shipped) : []), [shipped]);

  return (
    <FormDrawer.Body className="space-y-4">
      {commits.length > 0 && (
        <section className="space-y-1.5">
          <h3 className={CAPTION}>Incoming</h3>
          {/* Bounded + scrolling like the shipped list below it: `git log
              HEAD..origin/main` is 25 commits at the cap, and an un-bounded list
              pushes the docs links off the end of the drawer. */}
          <ScrollArea className="max-h-44 rounded-lg border bg-background/40">
            <ul className="space-y-1.5 p-3">
              {commits.map((c) => (
                <li key={c.sha} className="flex gap-2 text-xs">
                  <GitCommitHorizontal className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="break-words text-foreground">{c.subject}</span>{" "}
                    <span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                      {c.sha} · {c.date}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </section>
      )}

      <section className="space-y-1.5">
        <h3 className={CAPTION}>{commits.length > 0 ? "Already shipped here" : "Shipped"}</h3>
        {shipped === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : days.length ? (
          <ChangelogView days={days} />
        ) : (
          <p className="text-xs text-muted-foreground">No changelog in this checkout yet.</p>
        )}
      </section>

      <section className="space-y-1 border-t pt-3 text-xs">
        <h3 className={CAPTION}>Docs</h3>
        {/* Real links, so ⌘-click and long-press-share behave. The repo is public;
            everything here is already in the commit history it points at. */}
        <ul className="space-y-1 pt-1">
          {DOCS.map(([label, href]) => (
            <li key={href}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-info underline-offset-2 hover:underline [@media(pointer:coarse)]:inline-block [@media(pointer:coarse)]:py-1.5"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </FormDrawer.Body>
  );
}
