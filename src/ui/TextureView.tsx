import { useEffect, useMemo, useRef, useState } from "react";

import { knifeTextures, type MdlFile } from "../mdl/parse";
import type { RecoloredTexture } from "../mdl/recolor";
import { REGION_BLADE, REGION_HANDLE, type RegionMask } from "../mdl/regions";
import { decodeToRgba, readPalette, readPixels } from "../mdl/texture";

type Show = "after" | "before" | "regions";

const VIEWS: Array<{ id: Show; label: string }> = [
  { id: "after", label: "Now" },
  { id: "before", label: "Original" },
  { id: "regions", label: "Parts" },
];

interface Props {
  model: MdlFile | null;
  recolored: RecoloredTexture[];
  mask: RegionMask | null;
}

/**
 * The knife's texture as the file actually stores it, redrawn on every edit.
 *
 * A GoldSrc model carries its skin as one flat atlas of the knife's surfaces
 * unwrapped side by side, and every finish and pattern is ultimately a change
 * to those pixels. Watching it change makes the whole thing legible: which
 * piece of the sheet is the blade, how a pattern lands on it, and what
 * "rewrites the palette" versus "rewrites the pixels" actually means.
 */
export function TextureView({ model, recolored, mask }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [show, setShow] = useState<Show>("after");
  const [open, setOpen] = useState(true);

  const texture = useMemo(() => {
    if (!model) return null;
    return knifeTextures(model)[0] ?? null;
  }, [model]);

  useEffect(() => {
    if (!model || !texture || !open) return;
    const context = canvas.current?.getContext("2d");
    if (!context) return;

    const pixels = readPixels(model, texture);
    const { width, height } = texture;

    if (show === "regions" && mask) {
      // Parts tinted over a dimmed skin, so the split is visible without
      // losing sight of what it is splitting.
      const base = decodeToRgba(pixels, readPalette(model, texture));
      const out = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i += 1) {
        const region = mask.region[i];
        const tint =
          region === REGION_BLADE
            ? [90, 170, 240]
            : region === REGION_HANDLE
              ? [230, 150, 60]
              : null;
        for (let c = 0; c < 3; c += 1) {
          out[i * 4 + c] = tint
            ? base[i * 4 + c] * 0.4 + tint[c] * 0.6
            : base[i * 4 + c] * 0.25;
        }
        out[i * 4 + 3] = 255;
      }
      context.putImageData(new ImageData(out, width, height), 0, 0);
      return;
    }

    const swap = show === "after" ? recolored.find((entry) => entry.texture.index === texture.index) : null;
    const rgba = decodeToRgba(
      swap?.pixels ?? pixels,
      swap?.palette ?? readPalette(model, texture),
    );
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
  }, [model, texture, recolored, mask, show, open]);

  if (!texture) return null;

  return (
    <div className={`texture-view raised${open ? "" : " closed"}`}>
      <div className="texture-head">
        <span>Texture</span>
        <button type="button" className="cs-btn" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <>
          <canvas
            ref={canvas}
            width={texture.width}
            height={texture.height}
            title={`${texture.name} · ${texture.width}x${texture.height}`}
          />
          <div className="texture-tabs">
            {VIEWS.map((view) => (
              <button
                key={view.id}
                type="button"
                className="cs-btn"
                aria-pressed={show === view.id}
                disabled={view.id === "regions" && !mask}
                onClick={() => setShow(view.id)}
              >
                {view.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
