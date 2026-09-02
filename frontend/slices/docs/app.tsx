"use client";

import { ArrowUpRight, BookOpen, GitFork, LogIn, Rocket } from "lucide-react";
import { AppFrame, openWindow } from "@/features/appshell";
import { useSession } from "@/features/auth";
import { Button } from "@/components/ui/button";
import { DEEPER, INSTALL_GUIDE, REPO, START_HERE, type DocLink } from "./links";

// Docs window. The header is the ONE part that changes with session state: a
// signed-out visitor is browsing mock data and the most useful thing to offer is
// the way in (sign-in) and the way out (install your own). Signed in, that row
// would be noise — you are already in, on your own box.
export default function DocsApp() {
  const { status } = useSession();
  const signedOut = status === "out";

  return (
    <AppFrame>
      <div className="h-full overflow-y-auto p-5">
        <header className="mb-5">
          <h1 className="text-lg font-semibold tracking-tight">Manef Shell OS docs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {signedOut
              ? "You are signed out, so this shell is showing mock data. Sign in to reach the real host, or install MSO on a server of your own."
              : "Reference for this instance, its CLI, and the slices it is built from."}
          </p>
        </header>

        {signedOut ? (
          <div className="mb-6 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => openWindow("os-settings", "Settings")}>
              <LogIn className="size-4" aria-hidden />
              Sign in
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={INSTALL_GUIDE.href}>
                <Rocket className="size-4" aria-hidden />
                Install your own
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={REPO} target="_blank" rel="noopener noreferrer">
                <GitFork className="size-4" aria-hidden />
                GitHub
              </a>
            </Button>
          </div>
        ) : null}

        <Row link={INSTALL_GUIDE} icon={Rocket} featured />

        <Section title="Start here" links={START_HERE} />
        <Section title="Going deeper" links={DEEPER} />
      </div>
    </AppFrame>
  );
}

function Section({ title, links }: { title: string; links: DocLink[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">{title}</h2>
      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={l.href}>
            <Row link={l} icon={BookOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({
  link,
  icon: Icon,
  featured,
}: {
  link: DocLink;
  icon: typeof BookOpen;
  featured?: boolean;
}) {
  // The install guide is same-origin (this instance serves /install), so it is a
  // plain navigation. Everything else is github.com and opens in a new tab —
  // losing the shell to read a markdown file would be a bad trade.
  const external = link.href.startsWith("http");
  return (
    <a
      href={link.href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={
        "group flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent " +
        (featured ? "border-primary/40 bg-primary/5" : "border-border")
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-medium">
          {link.title}
          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{link.desc}</span>
      </span>
    </a>
  );
}
