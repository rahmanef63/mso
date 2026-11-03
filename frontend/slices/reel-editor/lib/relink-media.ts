import type { Composition, MediaRef, MediaType } from "./mock-timeline";

/** Replace references to one recovered asset without changing timeline edits. */
export function replaceMedia(comp: Composition, oldUrl: string, media: MediaRef): Composition {
  return {
    ...comp,
    clips: comp.clips.map((clip) => clip.media?.url === oldUrl ? { ...clip, media } : clip),
  };
}

export function acceptsRelinkType(type: MediaType, mime: string): boolean {
  return !mime || mime.startsWith(type + "/");
}
