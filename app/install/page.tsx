import type { Metadata } from "next";
import { Copy } from "./copy";

// A PUBLIC page: no session, no shell, no client data fetch. Someone evaluating
// MSO lands here from a shared link and has to be able to read the whole story —
// what it is, what it costs them in risk, and the exact commands — without an
// account. It deliberately does NOT render the OS shell: the shell is ~338 KB of
// JS for a page whose job is to be read.
export const metadata: Metadata = {
  title: "Install Manef Shell OS on your own server",
  description:
    "One command installs MSO, makes the mso CLI immediately available, and opens guided terminal onboarding for AI providers, optional managed apps and reviewed skills.",
};

const INSTALL = "curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash";

const REQUIREMENTS = [
  ["A Linux server you own", "A $5 VPS is enough. Debian/Ubuntu, Fedora and Arch are covered by the installer."],
  ["Node 20.9 or newer", "The installer adds it via NodeSource if it is missing."],
  ["A normal, non-root user", "MSO runs as that user and can do whatever that user can do. Never install it as root."],
  ["About 2 GB free disk", "Mostly the build. The app itself is small; there is no database."],
];

const STEPS = [
  {
    n: 1,
    title: "Run the installer",
    body: "As your normal user, not root. It installs prerequisites, clones the repo, builds production, generates owner credentials, installs the service, and makes `mso` resolvable immediately through a guarded /usr/local/bin launcher plus the ~/.local/bin fallback.",
    code: INSTALL,
    note: "It prints your login password once. Save it — the secret is written only to .env.local on the server.",
  },
  {
    n: 2,
    title: "Complete terminal onboarding",
    body: "On a fresh interactive install, the same command opens /dev/tty after the service is healthy. Choose an Alfa provider (OpenAI ChatGPT OAuth or supported API-key providers including OpenRouter), a response preset, optional Hermes/OpenClaw installs, and reviewed skills. If no terminal exists, nothing hangs: run `mso onboard` later.",
    code: "mso onboard\nmso skills available\nmso skills install ponytail caveman rtk -y",
    note: "`-y` is available for a safe non-interactive install, but it does not silently connect accounts, install managed apps, or trust community skills you did not select.",
  },
  {
    n: 3,
    title: "Reach it",
    body: "The installer binds 127.0.0.1, so :4005 is closed to other machines by default. Tunnel in from whatever you browse on. The session cookie is Secure, so ordinary plain-http IP addresses are not a valid permanent login origin.",
    code: "ssh -N -L 4005:127.0.0.1:4005 you@your-server",
    note: "Then open http://localhost:4005. For something permanent use `tailscale serve 4005`, or a TLS reverse proxy pointed at 127.0.0.1:4005.",
  },
  {
    n: 4,
    title: "Pair your browser",
    body: "Open the app and enter the password. Your browser lands PENDING and shows a device id. Terminal onboarding approves only the local CLI device; browser devices remain explicit owner approvals.",
    code: "mso device pending\nmso device approve <deviceId> \"my laptop\"",
    note: "Device approval is a browser allowlist, not standards-based 2FA. Approve only devices you own.",
  },
  {
    n: 5,
    title: "Reload and sign in",
    body: "That browser can now log in. Approve later devices from Settings → Devices. Re-run `mso onboard` whenever you want to change the first-run choices.",
    code: undefined,
    note: undefined,
  },
] as const;

export default function InstallPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-14 text-foreground sm:px-8">
      <header className="mb-12">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Manef Shell OS</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Install it on your own server
        </h1>
        <p className="mt-4 text-balance text-base leading-relaxed text-muted-foreground">
          A browser terminal, file manager, live system metrics and a bring-your-own-key AI
          assistant for one Linux server you control. Open source, self-hosted, no account and
          no database. This page needs no login — the install does.
        </p>
        <p className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">Public Alpha.</strong> MSO is a normal
          non-root Node process on top of Linux. It is not an operating system, a distribution,
          or a hardened multi-tenant platform. One owner, one server.
        </p>
      </header>

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

      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold">Five steps</h2>
        <ol className="space-y-8">
          {STEPS.map((s) => (
            <li key={s.n} className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span
                aria-hidden
                className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-border text-sm font-medium tabular-nums"
              >
                {s.n}
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-medium">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                {s.code ? <Copy text={s.code} /> : null}
                {s.note ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Note:</span> {s.note}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold">Drive it from a shell</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The service install creates a guarded <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">/usr/local/bin/mso</code> launcher,
          because a child <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">curl | bash</code> process cannot export PATH back into its parent shell.
          The normal <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">~/.local/bin</code> fallback is persisted too. So the first command after install can be <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">mso -h</code>.
        </p>
        <Copy text={'mso -h\nmso doctor\nmso onboard\nmso skills available'} />
      </section>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
        {[
          ["Source + full docs", "https://github.com/rahmanef63/mso"],
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
