export type SurfaceRenderer = "iframe" | "remote";
export type SurfacePresentation = "inline" | "fullscreen" | "pip";
export type SurfaceEnvironment = "development" | "preview" | "production" | "other";
export type SurfacePlacement = "workflows" | "n8n" | "mcp-page" | "shell";

export type SurfaceApp = {
  id: string;
  title: string;
  description: string;
  origin: string;
  startPath: string;
  renderer: SurfaceRenderer;
  presentation: SurfacePresentation;
  environment: SurfaceEnvironment;
  sandbox?: string;
  externalAuthPath?: string;
  reason?: string;
  project?: string;
  placements?: SurfacePlacement[];
  /** Owner-reviewed loopback application using an isolated MSO-derived session. */
  sessionUpstream?: string;
};

export type WorkflowEmbed = {
  id: string; title: string; description: string; origin: string; url?: string; blocked?: boolean;
  loginUrl?: string; renderer: SurfaceRenderer; sandbox: string; reason?: string;
  msoSession?: boolean;
};
