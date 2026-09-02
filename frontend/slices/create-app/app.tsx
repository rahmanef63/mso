"use client";

import { useMemo, useState } from "react";
import { Check, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GLYPH_KEYS, createApp } from "@/features/app-store";
import { AppFrame, usePublishInspector } from "@/features/appshell";
import { cn } from "@/lib/utils";
import { IconPreview } from "./components/icon-preview";
import { GlyphPicker } from "./components/glyph-picker";
import { Field } from "./components/field";

type Runtime = "html" | "node" | "python" | "shell";

const RUNTIMES = [
  { value: "html" as const, label: "HTML" },
  { value: "node" as const, label: "Node" },
  { value: "python" as const, label: "Python" },
  { value: "shell" as const, label: "Shell" },
];

const ENTRY: Record<Runtime, string> = {
  html: "index.html",
  node: "main.js",
  python: "app.py",
  shell: "run.sh",
};

// CSS gradients for the icon tile. Literal hex is allowed for the swatches.
const GRADIENTS = [
  "linear-gradient(160deg,#22d3ee,#0891b2)",
  "linear-gradient(160deg,#a855f7,#6d28d9)",
  "linear-gradient(160deg,#f43f5e,#be123c)",
  "linear-gradient(160deg,#f59e0b,#d97706)",
  "linear-gradient(160deg,#34d058,#16a34a)",
  "linear-gradient(160deg,#6366f1,#4338ca)",
];

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Create App — author a new os-rr app and persist it via Convex. On create the
// app is installed; the shell's dynamic registry shows it in the dock instantly.
export default function CreateApp() {
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState<Runtime>("html");
  const [entry, setEntry] = useState(ENTRY.html);
  const [gradient, setGradient] = useState(GRADIENTS[0]);
  const [glyph, setGlyph] = useState(GLYPH_KEYS[0]);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = useMemo(() => slugify(name) || "untitled", [name]);
  const manifest = useMemo(
    () =>
      JSON.stringify(
        { appId: slug, title: name.trim() || "New app", runtime, entry, glyph, gradient },
        null,
        2,
      ),
    [slug, name, runtime, entry, glyph, gradient],
  );

  const pickRuntime = (r: Runtime) => {
    setRuntime(r);
    setEntry(ENTRY[r]);
  };

  // Surface the draft to the shell AI Inspector.
  usePublishInspector(
    "create-app",
    {
      subject: name.trim() || "New app",
      props: [
        { label: "Name", value: name.trim() || "—" },
        { label: "Slug", value: slug },
        { label: "Runtime", value: runtime },
        { label: "Entry", value: entry },
      ],
      context: `Creating app ${name.trim() || "untitled"} (${runtime})`,
      suggestions: ["Suggest a name", "What runtime should I use?", "Write a description"],
    },
    [name, slug, runtime, entry],
  );

  const handleCreate = async () => {
    if (created) return;
    setError(null);
    try {
      createApp({ appId: slug, title: name, glyph, gradient, runtime, entry });
      setCreated(true);
      setTimeout(() => {
        setName("");
        pickRuntime("html");
        setGradient(GRADIENTS[0]);
        setGlyph(GLYPH_KEYS[0]);
        setCreated(false);
      }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat app");
    }
  };

  // Single column on compact panes; the manifest preview + submit move into a
  // second column only when the PANE is wide (@xl container variant — above the
  // 520px default window so the desktop default stays visually unchanged).
  return (
    <AppFrame safeArea={false}>
      <ScrollArea className="h-full">
        <div className="mx-auto max-w-md p-5 [padding-bottom:calc(1.25rem+var(--sai-bottom))] @xl:max-w-3xl">
          <header className="flex items-center gap-3">
            <IconPreview glyph={glyph} gradient={gradient} />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{name.trim() || "New app"}</h2>
              <p className="truncate font-mono text-[11px] text-muted-foreground">/apps/{slug}</p>
            </div>
          </header>

          <Separator className="my-5" />

          <div className="grid grid-cols-1 gap-5 @xl:grid-cols-2 @xl:gap-x-8">
            <div className="space-y-5">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My App" autoFocus />
              </Field>

              <Field label="Runtime">
                <Segmented options={RUNTIMES} value={runtime} onChange={pickRuntime} className="w-full" />
              </Field>

              <Field label="Entry point">
                <Input value={entry} onChange={(e) => setEntry(e.target.value)} className="font-mono text-xs" />
              </Field>

              <Field label="Glyph">
                <GlyphPicker value={glyph} onChange={setGlyph} />
              </Field>

              <Field label="Accent">
                <div className="flex gap-2">
                  {GRADIENTS.map((g, i) => (
                    <Button
                      key={g}
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Accent ${i + 1}`}
                      onClick={() => setGradient(g)}
                      style={{ background: g }}
                      className={cn(
                        "size-7 rounded-full p-0 ring-offset-2 ring-offset-background transition",
                        gradient === g ? "ring-2 ring-primary" : "ring-1 ring-border hover:ring-foreground/40",
                      )}
                    />
                  ))}
                </div>
              </Field>
            </div>

            <div className="space-y-5">
              <Field label="manifest.json">
                <pre className="overflow-x-auto rounded-md border border-border bg-secondary/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {manifest}
                </pre>
              </Field>

              <Button className="w-full" disabled={created} onClick={handleCreate}>
                {created ? (
                  <>
                    <Check className="size-4" /> Created
                  </>
                ) : (
                  <>
                    <Rocket className="size-4" /> Create app
                  </>
                )}
              </Button>

              {error && <p className="text-center text-xs text-destructive">{error}</p>}

              {created && (
                <div className="flex justify-center">
                  <Badge variant="secondary">
                    <Check className="size-3" /> Added to dock
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </AppFrame>
  );
}
