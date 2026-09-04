/**
 * The per-texel region mask, generated at curation time by
 * scripts/build-regions.ts and shipped as a PNG next to each model.
 *
 * Red channel: which part of the knife a texel belongs to.
 * Green channel: how far up the knife it sits, grip at 0 and tip at 255.
 */

export const REGION_NONE = 0;
export const REGION_HANDLE = 1;
export const REGION_BLADE = 2;

export interface Region {
  id: number;
  name: string;
}

export const REGIONS: Region[] = [
  { id: REGION_HANDLE, name: "Handle" },
  { id: REGION_BLADE, name: "Blade" },
];

export interface RegionMask {
  width: number;
  height: number;
  /** REGION_* per texel. */
  region: Uint8Array;
  /** Position along the knife per texel, 0-255. */
  along: Uint8Array;
  /** Which regions actually occur; a few knives are one region throughout. */
  present: number[];
}

export function maskUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}regions/${slug}.png`;
}

/**
 * Reads the mask through the browser's own PNG decoder. The mask has to line up
 * with the texture texel for texel, so any resampling would corrupt it; drawing
 * at natural size onto a canvas of the same size avoids that.
 */
export async function loadRegionMask(slug: string): Promise<RegionMask | null> {
  const response = await fetch(maskUrl(slug));
  if (!response.ok) return null;

  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const count = canvas.width * canvas.height;
  const region = new Uint8Array(count);
  const along = new Uint8Array(count);
  const seen = new Set<number>();

  for (let i = 0; i < count; i += 1) {
    region[i] = data[i * 4];
    along[i] = data[i * 4 + 1];
    if (region[i] !== REGION_NONE) seen.add(region[i]);
  }

  return {
    width: canvas.width,
    height: canvas.height,
    region,
    along,
    present: REGIONS.map((entry) => entry.id).filter((id) => seen.has(id)),
  };
}
