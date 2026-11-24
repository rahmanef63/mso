// Canvas geometry constants shared by the math, geometry, and preview modules.
// Kept separate so workflow-geometry.ts never imports workflow-canvas-math.ts
// (that would create a value cycle).
export const STUDIO_NODE_W = 186;
export const STUDIO_NODE_H = 72;
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.0;
