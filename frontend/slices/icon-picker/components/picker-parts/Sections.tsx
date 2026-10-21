"use client";

import * as React from "react";
import { Grid, RecentCell } from "./cells";
import type { Style } from "../../lib/style-pref";

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</h4>
      <Grid>{children}</Grid>
    </section>
  );
}

export function RecentsSection({
  recents, style, activeValue, onPick,
}: { recents: readonly string[]; style: Style; activeValue: string; onPick: (v: string) => void }) {
  return (
    <section>
      <h4 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent</h4>
      <Grid>
        {recents.map((v, i) => (
          <RecentCell
            key={`r-${v}-${i}`}
            value={v}
            style={style}
            active={v === activeValue}
            onClick={() => onPick(v)}
          />
        ))}
      </Grid>
    </section>
  );
}
