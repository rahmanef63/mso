import type { Metadata } from "next";
import { Copy } from "./copy";
import { PlatformInstallTabs } from "./platform-tabs";

export const metadata: Metadata = {
  title: "Install Manef Shell OS",
  description:
    "Install MSO on Linux, macOS, Windows/WSL2 or Android/Termux, or use iOS/iPadOS as the PWA client.",
};

const INSTALL = "curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash";
const AGENT_PROMPT = "Install or update MSO from this repo: https://github.com/rahmanef63/mso";

const REQUIREMENTS = [
  ["A machine you control", "Linux runs natively; macOS, Windows and Android use a supported Linux compatibility host."],
  ["Node 22.12+, 24.x or 26+", "The Linux runtime uses Node; the compatibility installers provision the same runtime inside their Linux guest."],
  ["A normal, non-root runtime user", "MSO executes host operations with that user's authority. Do not run the MSO runtime as root."],
  ["About 2 GB free disk", "Mostly the production build and dependencies. There is no required application database."],
] as const;

const STEPS = [
  {
    n: 1,
    title: "Run the platform installer",
    body: "Use the platform card above. Linux uses the canonical installer directly; the same POSIX command auto-routes macOS and Termux. Windows uses the PowerShell/WSL2 bootstrap.",
    code: INSTALL,
    note: "Compatibility hosts keep the Linux runtime contract intact instead of faking Linux host primitives on another OS.",
  },
  {
    n: 2,
    title: "Complete terminal onboarding",
    body: "On a fresh interactive host install, connect an Alfa AI platform from MSO's live supported-provider catalog. Explicitly zero-cost agent-capable models are marked FREE; OpenCode Zen and OpenRouter are supported API-key platforms, while OpenAI ChatGPT uses its separate device OAuth path. Then choose the model/preset and optionally add managed apps and reviewed skills. Headless installs do not hang; run mso onboard later.",
    code: "mso onboard\nmso skills available\nmso skills install ponytail caveman rtk -y",
    note: "Safe non-interactive defaults never silently connect accounts, install managed apps, or trust community skills.",
  },
  {
    n: 3,
    title: "Reach it safely",
    body: "MSO binds 127.0.0.1 by default. Use the local machine, SSH/WSL/Lima forwarding, Tailscale Serve, or a protected TLS reverse proxy instead of publishing the raw app port.",
    code: "ssh -N -L 4005:127.0.0.1:4005 you@your-server",
    note: "Pair a browser only after you are on HTTPS or localhost so the Secure session cookie can be stored correctly.",
  },
  {
    n: 4,
    title: "Pair your browser",
    body: "Open MSO and enter the owner password. New browser devices remain pending until explicitly approved.",
    code: "mso device pending\nmso device approve <deviceId> \"my laptop\"",
    note: "Approve only devices you control.",
  },
  {
    n: 5,
    title: "Verify the runtime",
    body: "Verify the actual host path rather than assuming an install succeeded because files exist.",
    code: "mso doctor\nmso --version",
    note: "Platform-specific capability gaps should be reported, not disguised as a healthy Linux host.",
  },
] as const;

export default function InstallPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl px-5 py-14 text-foreground sm:px-8">
      <header className="mb-10">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Manef Shell OS</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Install MSO on your machine
        </h1>
        <p className="mt-4 text-balance text-base leading-relaxed text-muted-foreground">
          One Linux host-runtime contract, multiple machine adapters. Linux runs directly; macOS
          uses Lima, Windows uses WSL2, and Android uses Termux + Ubuntu PRoot. iPhone and iPad
          use the full browser/PWA workspace against an MSO host.
        </p>
        <p className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">Public Alpha.</strong> MSO can execute
          commands as its runtime user. Compatibility layers preserve the Linux host contract;
          they do not claim Linux guest services are native macOS, Windows, Android or iOS services.
        </p>
      </header>

      <section className="mb-12">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Choose your platform</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Each tab includes prerequisites, exact commands, step-by-step setup, troubleshooting,
            verification, and links to the relevant official documentation.
          </p>
        </div>
        <PlatformInstallTabs />
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold">Before you start</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {REQUIREMENTS.map(([term, detail]) => (
            <div key={term} className="rounded-lg border border-border p-4">
              <dt className="text-sm font-medium">{term}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-12 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">Using an AI agent?</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Give it the repository and one sentence. It should detect the machine, use the supported
          platform bootstrap, preserve an existing install, and finish with mso doctor.
        </p>
        <Copy text={AGENT_PROMPT} />
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Already installed? Current MSO uses <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">mso update</code> or Settings → About.
          For an older build where those do not exist, re-run the installer above; it upgrades the existing checkout in place and preserves existing configuration/state.
        </p>
      </section>

      <section className="mb-12">
        <h2 className="mb-2 text-lg font-semibold">Shared MSO flow</h2>
        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">These are the common product steps after the platform-specific setup above.</p>
        <ol className="space-y-8">
          {STEPS.map((step) => (
            <li key={step.n} className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span aria-hidden className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-border text-sm font-medium tabular-nums">
                {step.n}
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-medium">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                <Copy text={step.code} />
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Note:</span> {step.note}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold">Drive it from a shell</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          On native Linux, the service installer creates a guarded <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">/usr/local/bin/mso</code> launcher plus the user-local fallback. Compatibility launchers delegate into the same Linux runtime so the CLI contract stays consistent across machines.
        </p>
        <Copy text={"mso -h\nmso doctor\nmso onboard\nmso skills available\nmso skills install ponytail caveman rtk -y"} />
      </section>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
        {[
          ["Source + full docs", "https://github.com/rahmanef63/mso"],
          ["Platform matrix", "https://github.com/rahmanef63/mso/blob/main/docs/PLATFORMS.md"],
          ["Install reference", "https://github.com/rahmanef63/mso/blob/main/docs/INSTALL.md"],
          ["CLI reference", "https://github.com/rahmanef63/mso/blob/main/docs/CLI.md"],
          ["Security model", "https://github.com/rahmanef63/mso/blob/main/SECURITY.md"],
        ].map(([label, href]) => (
          <a key={href} className="text-muted-foreground underline underline-offset-4 hover:text-foreground" href={href}>
            {label}
          </a>
        ))}
      </footer>
    </main>
  );
}
