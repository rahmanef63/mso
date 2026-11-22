"use client";

// The exact input object passed to the tool is the approval artifact. Mutation-critical
// values are never truncated; large values stay fully present inside a bounded scroll area.
export function canonicalToolInput(input: Record<string, unknown>): string {
  return JSON.stringify(input, null, 2);
}

function FullValue({ children }: { children: string }) {
  return (
    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 px-2 py-1 font-mono text-[10px]">
      {children}
    </pre>
  );
}

export function ToolArgs({ name, input }: { name: string; input: Record<string, unknown> }) {
  if (name === "exec.run") {
    return (
      <div className="mt-1.5 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact command</p>
        <FullValue>{String(input.cmd ?? "")}</FullValue>
        {input.cwd !== undefined ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Working directory</p>
            <FullValue>{String(input.cwd)}</FullValue>
          </>
        ) : null}
      </div>
    );
  }
  if (name === "fs.write") {
    const content = String(input.content ?? "");
    const bytes = new TextEncoder().encode(content).byteLength;
    return (
      <div className="mt-1.5 text-[11px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact destination</p>
        <FullValue>{String(input.path ?? "")}</FullValue>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Full content ({bytes} bytes)</p>
        <FullValue>{content}</FullValue>
      </div>
    );
  }
  if (name === "fs.move" || name === "fs.copy") {
    return (
      <div className="mt-1.5 text-[11px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact source</p>
        <FullValue>{String(input.from ?? "")}</FullValue>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact destination</p>
        <FullValue>{String(input.to ?? "")}</FullValue>
      </div>
    );
  }
  if (name === "fs.delete" || name === "fs.mkdir") {
    return (
      <div className="mt-1.5 text-[11px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact path</p>
        <FullValue>{String(input.path ?? "")}</FullValue>
      </div>
    );
  }
  const canonical = canonicalToolInput(input);
  if (canonical === "{}") return null;
  return (
    <div className="mt-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Complete arguments</p>
      <FullValue>{canonical}</FullValue>
    </div>
  );
}
