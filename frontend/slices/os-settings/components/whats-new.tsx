"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { SettingsSection } from "@/features/shell-settings";
import { IS_DEMO } from "@/lib/demo";
import { parseChangelog } from "../lib/changelog";
import { ChangelogView } from "./changelog-view";

// "What's new", from docs/CHANGELOG.md — which is generated from git subjects, so
// it cannot drift from what actually shipped.
//
// This exists because a change that only lands in a terminal is a change the owner
// has to go looking for. The deploy already ships the file; this puts it where they
// already are.
//
// Parsed and rendered as records (see lib/changelog.ts). It used to run the raw
// file through the markdown helper and inject the result — which printed the
// generator's own "do not edit" preamble at the reader, and stretched the About
// pane by however many days had shipped. It is a bounded, scrolling list now.

export function WhatsNew() {
  const [md, setMd] = useState<string | null>(null);

  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    fetch("/api/changelog", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { markdown?: string } | null) => alive && setMd(d?.markdown ?? ""))
      .catch(() => alive && setMd(""));
    return () => {
      alive = false;
    };
  }, []);

  const days = useMemo(() => (md ? parseChangelog(md) : []), [md]);

  // Nothing to show is not a failure state — a fresh checkout has no generated
  // changelog, and an empty card would just be noise in Settings.
  if (!md || !days.length) return null;

  return (
    <SettingsSection
      icon={<Sparkles />}
      title="What's new"
      bare
      footnote="Generated from the commit history of this deployment, so it cannot drift from what shipped."
    >
      <ChangelogView days={days} />
    </SettingsSection>
  );
}
