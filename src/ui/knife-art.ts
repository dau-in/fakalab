/**
 * Hand-drawn knife artwork for the picker.
 *
 * Rendered thumbnails show the real model but read as small dark smudges in a
 * list, and they cannot follow the theme. These are drawn instead, in the same
 * language as the project's own icon: flat shapes, one material per shape, and
 * every colour taken from a CSS variable so a theme change carries them along.
 *
 * Coordinates are final, in a 64x64 box, with no group transform. That keeps
 * them checkable: scripts/preview-knife-art.ts rasterizes exactly these paths.
 */

/** What a shape is made of, which is what decides its colour. */
export type Material = "face" | "bevel" | "grip" | "grit" | "edge";

export interface ArtShape {
  d: string;
  material: Material;
  evenOdd?: boolean;
}

export const KNIFE_ART: Record<string, ArtShape[]> = {
  "bayonet-knife": [
    // pommel, then grip, so the grip covers the join
    { d: "M 7.4,52.0 L 13.8,58.2 L 15.6,56.4 L 9.2,50.2 Z", material: "bevel" },
    { d: "M 8.8,50.9 L 15.2,57.1 L 32.8,38.1 L 27.0,32.5 Z", material: "grip" },
    { d: "M 14.4,46.5 L 19.4,51.3 L 20.4,50.3 L 15.4,45.5 Z", material: "grit" },
    { d: "M 17.9,42.8 L 22.9,47.6 L 23.9,46.6 L 18.9,41.8 Z", material: "grit" },
    { d: "M 21.5,39.0 L 26.5,43.8 L 27.5,42.8 L 22.5,38.0 Z", material: "grit" },
    // guard across the blade
    { d: "M 23.9,31.6 L 33.9,41.2 L 35.9,39.0 L 25.9,29.4 Z", material: "bevel" },
    // blade, its spine bevel, and the sharpened edge
    { d: "M 33.6,36.0 L 49.5,17.5 L 56,8 L 29.0,31.6 Z", material: "face" },
    { d: "M 33.6,36.0 L 49.5,17.5 L 56,8 L 50.5,14.5 L 31.9,34.3 Z", material: "bevel" },
    { d: "M 29.0,31.6 L 56,8 L 54.6,9.6 L 30.2,33.0 Z", material: "edge" },
  ],
};

export function hasArt(slug: string): boolean {
  return slug in KNIFE_ART;
}
