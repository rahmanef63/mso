/** Width and height belong to the canvas, not the device or browser window. */
export function compactGraphViewport(width: number, height: number): boolean {
  return width > 0 && height > 0 && (width < 600 || height < 240);
}
