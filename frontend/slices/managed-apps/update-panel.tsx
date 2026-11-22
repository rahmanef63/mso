"use client";

import { useState } from "react";
import { Loader2, PackagePlus, RotateCcw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ManagedAppView } from "@/lib/managed-apps/types";
import { InstallPanel } from "./install-panel";
import { JobPanel } from "./job-panel";
import { RollbackPanel } from "./rollback-panel";
import { UninstallPanel } from "./uninstall-panel";
import { UpdateTab } from "./update-tab";
import { useUpdateCentre } from "./use-update-center";

type Section = "update" | "rollback" | "uninstall";

const SECTIONS: { id: Section; label: string; icon: typeof Upload }[] = [
  { id: "update", label: "Update", icon: Upload },
  { id: "rollback", label: "Rollback", icon: RotateCcw },
  { id: "uninstall", label: "Uninstall", icon: Trash2 },
];

// A toggle-button group rather than the Tabs primitive: `aria-pressed` is the
// one piece of state a screen reader needs here, and TabsTrigger forwards no
// aria props.
function SectionTabs({ value, onChange }: { value: Section; onChange: (next: Section) => void }) {
  return (
    <div role="group" aria-label="Update centre sections" className="flex flex-wrap gap-1">
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          type="button"
          size="sm"
          variant={value === id ? "secondary" : "ghost"}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          <Icon aria-hidden />
          {label}
        </Button>
      ))}
    </div>
  );
}

function Centre({ app, onChanged }: { app: ManagedAppView; onChanged: () => void }) {
  const centre = useUpdateCentre(app.id, onChanged);
  const [section, setSection] = useState<Section>("update");

  // Not installed: install is the only flow there is. The JobPanel comes WITH it —
  // leaving it to the branch below meant a started install reported nothing back at
  // all, because that branch never runs while the app is absent.
  if (!app.installed) {
    return (
      <>
        <InstallPanel appId={app.id} command={centre.status?.capabilities?.installCommand} centre={centre} />
        <JobPanel job={centre.job} onDismiss={centre.dismiss} onCancel={centre.cancel} />
      </>
    );
  }

  return (
    <>
      <SectionTabs value={section} onChange={setSection} />
      <div className="mt-3">
        {centre.loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Reading update status…
          </p>
        ) : section === "update" ? (
          <UpdateTab appId={app.id} centre={centre} />
        ) : section === "rollback" ? (
          <RollbackPanel appId={app.id} centre={centre} />
        ) : (
          <UninstallPanel appId={app.id} centre={centre} />
        )}
      </div>
      {/* Outside the section switch on purpose: a running update stays visible
          while the operator reads the rollback or uninstall copy. */}
      <JobPanel job={centre.job} onDismiss={centre.dismiss} onCancel={centre.cancel} />
    </>
  );
}

/** The update centre for one managed app, mounted inside its existing card. */
export function UpdateCentrePanel({ app, onChanged }: { app: ManagedAppView; onChanged: () => void }) {
  return (
    <section className="mt-4 rounded-lg border border-border p-3">
      <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold">
        <PackagePlus className="size-3.5" aria-hidden />
        AppDeck lifecycle
      </h4>
      <Centre app={app} onChanged={onChanged} />
    </section>
  );
}

/** Centred identity plus one action — what the window IS whenever there is no live vendor
 *  UI to frame. Three surfaces need exactly this shape (absent, stopped, state unknown),
 *  which is why it is a component rather than copied classes.
 *
 *  Children are left-aligned inside the centred column on purpose: the button is the focal
 *  point, but the optional provider fields under it are a form, and centred form rows are
 *  unusable. */
export function Hero({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-6 py-12 text-center">
        <div className="[&>svg]:size-10">{icon}</div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className="w-full space-y-4 text-left">{children}</div>
      </div>
    </div>
  );
}

/** The window while the app is absent. Opening it used to mount the vendor iframe
 *  regardless, which after an uninstall is a dead frame pointed at a 502, with the only
 *  Install button two clicks away behind a "manage" tab. */
export function InstallSurface({ app, icon, onChanged }: { app: ManagedAppView; icon: React.ReactNode; onChanged: () => void }) {
  const centre = useUpdateCentre(app.id, onChanged);
  return (
    <Hero icon={icon} title={app.name} description={app.description}>
      {/* "Absent" is sometimes a guess rather than a fact — see ManagedAppView.diagnostic.
          Shown ABOVE the Install button because it is the reason that button is about to
          fail: with no user bus, the install job dies at the step that registers the app's
          service, every time, after doing all of its other work. */}
      {app.diagnostic && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <p className="font-medium">This reading may be wrong</p>
          <p className="mt-1 text-amber-300/85">{app.diagnostic}</p>
        </div>
      )}
      <InstallPanel appId={app.id} command={centre.status?.capabilities?.installCommand} centre={centre} />
      <JobPanel job={centre.job} onDismiss={centre.dismiss} onCancel={centre.cancel} />
    </Hero>
  );
}
