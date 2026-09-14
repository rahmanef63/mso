/**
 * Same-origin Integrations iframe theme bridge.
 *
 * Iframes do not inherit CSS custom properties from AppShell. Copy only the
 * reviewed visual tokens needed by the generated Integrations resource so its
 * Settings-like content follows the active shell preset/accent dynamically.
 */
export const INTEGRATION_FRAME_TOKEN_MAP = [
  ["--text", "--text"],
  ["--text-dim", "--text-dim"],
  ["--text-faint", "--text-faint"],
  ["--sep", "--sep"],
  ["--sep-strong", "--sep-strong"],
  ["--os-accent", "--accent"],
  ["--accent-text", "--accent-text"],
  ["--grouped", "--grouped"],
  ["--fill", "--fill"],
  ["--fill2", "--fill2"],
  ["--window-bg", "--window-bg"],
  ["--surface", "--surface"],
  ["--field", "--field"],
  ["--hover", "--hover"],
  ["--hover-strong", "--hover-strong"],
  ["--inset", "--inset"],
  ["--shadow-pop", "--shadow-pop"],
  ["--warning", "--warning"],
  ["--info", "--info"],
  ["--destructive-text", "--destructive-text"],
  ["--sidebar", "--sidebar"],
  ["--radius", "--radius"],
  ["--blur", "--blur"],
  ["--background", "--background"],
  ["--foreground", "--foreground"],
  ["--card", "--card"],
  ["--primary", "--primary"],
  ["--primary-foreground", "--primary-foreground"],
  ["--secondary", "--secondary"],
  ["--secondary-foreground", "--secondary-foreground"],
  ["--muted", "--muted"],
  ["--muted-foreground", "--muted-foreground"],
  ["--border", "--border"],
  ["--input", "--input"],
  ["--font-family", "--shell-font"],
] as const;

export type IntegrationTokenReader = (name: string) => string;

export function integrationFrameTokens(read: IntegrationTokenReader): Record<string, string> {
  return Object.fromEntries(
    INTEGRATION_FRAME_TOKEN_MAP
      .map(([local, shell]) => [local, read(shell).trim()] as const)
      .filter(([, value]) => value.length > 0),
  );
}

export function syncIntegrationFrameTokens(frame: HTMLIFrameElement): void {
  try {
    const target = frame.contentDocument?.documentElement;
    if (!target) return;
    const source = getComputedStyle(document.documentElement);
    const values = integrationFrameTokens((name) => source.getPropertyValue(name));
    for (const [name, value] of Object.entries(values)) target.style.setProperty(name, value);
    if (source.fontSize) target.style.fontSize = source.fontSize;
    const theme = document.documentElement.dataset.theme;
    if (theme === "light" || theme === "dark") target.dataset.theme = theme;
    else target.removeAttribute("data-theme");
  } catch {
    // The production manager is same-origin. Fail closed/no-op if an embedding
    // context changes that contract rather than attempting cross-origin access.
  }
}
