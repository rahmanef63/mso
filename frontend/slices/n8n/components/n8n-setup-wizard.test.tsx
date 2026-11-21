import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { N8nLocalPanel } from "./n8n-local-panel";
import { N8nSetupWizard } from "./n8n-setup-wizard";
import { N8nSshPanel } from "./n8n-ssh-panel";

describe("low-code n8n setup wizard and panels", () => {
  it("renders guided tabs without em dashes or unrelated feature shortcuts", () => {
    const html = renderToStaticMarkup(
      <N8nSetupWizard
        existing={null}
        detected={{
          id: "n8n",
          name: "n8n",
          description: "n8n",
          managedAppId: "n8n",
          ownership: "detected-local",
          running: true,
          source: "docker",
          detectedEndpoint: "http://127.0.0.1:5678",
          detectedPath: "~/.n8n",
          recommendedAction: "connect",
          hint: "Detected existing n8n container on this computer.",
        }}
        configurable
        revision="rev-1"
        loadMessage=""
        onSaved={vi.fn(async () => {})}
        onRefresh={vi.fn()}
        onOpenManaged={vi.fn()}
      />,
    );
    expect(html).toContain("This computer");
    expect(html).toContain("HTTPS URL");
    expect(html).toContain("Remote SSH");
    expect(html).toContain("http://127.0.0.1:5678");
    expect(html).toContain("~/.n8n");
    expect(html).not.toContain("\u2014");
  });

  it("renders concrete non-coder placeholders on local and SSH panels", () => {
    const localHtml = renderToStaticMarkup(<N8nLocalPanel detected={null} onOpenManaged={vi.fn()} />);
    expect(localHtml).toContain("http://127.0.0.1:5678");
    expect(localHtml).toContain("~/.n8n");
    expect(localHtml).toContain("Check local n8n");
    expect(localHtml).not.toContain("\u2014");

    const sshHtml = renderToStaticMarkup(<N8nSshPanel />);
    expect(sshHtml).toContain("~/.ssh/id_ed25519");
    expect(sshHtml).toContain("192.168.1.50");
    expect(sshHtml).toContain("Test SSH connection");
    expect(sshHtml).toContain("Save and start tunnel");
    expect(sshHtml).not.toContain("\u2014");
  });
});
