import { useEffect, useRef, useState } from "react";

/**
 * A knife drawn flat, painted in the current theme.
 *
 * The artwork ships with a material index in each pixel's red channel rather
 * than a colour, so one file per knife serves every theme. Reading the theme's
 * own custom properties and painting with them is what keeps the picker in
 * step with the rest of the interface.
 */

const MATERIALS = ["", "--art-face", "--art-bevel", "--art-grip", "--art-grit", "--art-edge"];

/**
 * Material indices are spaced across the byte in the file, since the canvas
 * this is read through may colour-manage what it is given and adjacent values
 * would not survive it.
 */
const MATERIAL_STEP = 51;

export function artUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}art/${slug}.png`;
}

function readPalette(): Array<[number, number, number] | null> {
  const style = getComputedStyle(document.documentElement);
  return MATERIALS.map((name) => {
    if (!name) return null;
    const value = style.getPropertyValue(name).trim();
    const hex = value.replace("#", "");
    if (hex.length !== 6) return [128, 128, 128];
    const number = Number.parseInt(hex, 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255] as [number, number, number];
  });
}

interface Props {
  slug: string;
  size?: number;
  /** Bumped by the app when the theme changes, to force a repaint. */
  theme: string;
}

export function KnifeArt({ slug, size = 40, theme }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<ImageData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(artUrl(slug))
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("missing"))))
      .then(createImageBitmap)
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        const scratch = document.createElement("canvas");
        scratch.width = bitmap.width;
        scratch.height = bitmap.height;
        const context = scratch.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(bitmap, 0, 0);
          setSource(context.getImageData(0, 0, bitmap.width, bitmap.height));
        }
        bitmap.close();
      })
      .catch(() => {
        // A knife with no drawing simply shows nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!source) return;
    const context = canvas.current?.getContext("2d");
    if (!context) return;

    const palette = readPalette();
    const out = new Uint8ClampedArray(source.data.length);
    for (let i = 0; i < source.width * source.height; i += 1) {
      const colour = palette[Math.round(source.data[i * 4] / MATERIAL_STEP)];
      if (!colour) continue;
      out[i * 4] = colour[0];
      out[i * 4 + 1] = colour[1];
      out[i * 4 + 2] = colour[2];
      out[i * 4 + 3] = 255;
    }
    context.clearRect(0, 0, source.width, source.height);
    context.putImageData(new ImageData(out, source.width, source.height), 0, 0);
  }, [source, theme]);

  return (
    <canvas
      ref={canvas}
      className="knife-art"
      width={source?.width ?? 64}
      height={source?.height ?? 64}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
