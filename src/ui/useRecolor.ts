import { useDeferredValue, useMemo } from "react";

import { ORIGINAL_FINISH } from "../mdl/finish";
import { knifeTextures, type MdlFile } from "../mdl/parse";
import {
  applyFinishToPalette,
  applyFinishes,
  fitsPalettePath,
  isUntouched,
  type FinishLook,
  type RecoloredTexture,
} from "../mdl/recolor";
import { REGION_NONE, type RegionMask } from "../mdl/regions";

export interface RecolorState {
  textures: RecoloredTexture[];
  /** True while the slower path is catching up with the controls. */
  working: boolean;
  /** Whether pixel indices are being rewritten, not just the palette. */
  perPixel: boolean;
}

/**
 * Runs whichever path the current look needs.
 *
 * A tint depends only on the colour a pixel already had, so one finish over the
 * whole knife rewrites 768 bytes and keeps up with a slider being dragged.
 * Different finishes per part, or any pattern, make colour depend on position,
 * which means rewriting a quarter of a million indices and quantizing the
 * result. That is slow enough to be felt, so it runs off a deferred copy of the
 * look and the preview arrives a beat after the control does.
 */
export function useRecolor(
  model: MdlFile | null,
  mask: RegionMask | null,
  look: FinishLook,
): RecolorState {
  const perPixel = useMemo(
    () => !isUntouched(look, mask) && !fitsPalettePath(look, mask),
    [look, mask],
  );

  const deferred = useDeferredValue(look);
  const applied = perPixel ? deferred : look;

  const textures = useMemo(() => {
    if (!model) return [];
    const targets = knifeTextures(model);
    if (targets.length === 0) return [];

    if (fitsPalettePath(applied, mask) || isUntouched(applied, mask)) {
      const id = mask?.present[0] ?? REGION_NONE;
      const finish = applied.finishes[id] ?? ORIGINAL_FINISH;
      return targets.map((texture) => applyFinishToPalette(model, texture, finish));
    }

    return targets.map((texture) => applyFinishes(model, texture, mask, applied));
  }, [model, mask, applied]);

  return { textures, working: perPixel && deferred !== look, perPixel };
}
