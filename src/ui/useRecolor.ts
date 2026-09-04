import { useDeferredValue, useMemo } from "react";

import { knifeTextures, type MdlFile } from "../mdl/parse";
import {
  needsPixelPath,
  recolorPixelsOf,
  recolorTextures,
  type Look,
  type RecoloredTexture,
} from "../mdl/recolor";
import type { RegionMask } from "../mdl/regions";

export interface RecolorState {
  textures: RecoloredTexture[];
  /** True while the slower path is catching up with the controls. */
  working: boolean;
  /** Whether pixel indices are being rewritten, not just the palette. */
  perPixel: boolean;
}

/**
 * Runs whichever recolor path the current look needs.
 *
 * One colour for the whole knife only rewrites a 768-byte palette, which is
 * fast enough to keep up with a slider being dragged. Colouring parts separately
 * or applying a pattern has to rewrite a quarter of a million pixel indices and
 * quantize the result, which takes long enough to be felt.
 *
 * So the expensive path runs off a deferred copy of the look: React keeps the
 * controls responsive and lets the preview arrive a beat later, rather than
 * stuttering the whole interface on every mouse move.
 */
export function useRecolor(
  model: MdlFile | null,
  mask: RegionMask | null,
  look: Look,
): RecolorState {
  const perPixel = useMemo(() => needsPixelPath(look, mask), [look, mask]);

  const deferred = useDeferredValue(look);
  const applied = perPixel ? deferred : look;

  const textures = useMemo(() => {
    if (!model) return [];
    const targets = knifeTextures(model);
    if (targets.length === 0) return [];

    if (!needsPixelPath(applied, mask)) {
      const first = mask?.present[0] ?? 0;
      const stops = applied.ramps[first] ?? Object.values(applied.ramps)[0] ?? [];
      return recolorTextures(model, targets, stops, applied.adjust);
    }

    return targets.map((texture) => recolorPixelsOf(model, texture, mask, applied));
  }, [model, mask, applied]);

  return { textures, working: perPixel && deferred !== look, perPixel };
}
