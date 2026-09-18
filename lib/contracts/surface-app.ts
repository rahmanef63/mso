export type SurfaceRenderer = "iframe" | "remote";
export type SurfacePresentation = "inline" | "fullscreen" | "pip";
export type SurfaceEnvironment = "development" | "preview" | "production" | "other";

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
  placements?: Array<"workflows" | "mcp-page">;
};


export type WorkflowEmbed = {
  id: string; title: string; description: string; origin: string; url: string;
  loginUrl?: string; renderer: SurfaceRenderer; sandbox: string; reason?: string;
};
