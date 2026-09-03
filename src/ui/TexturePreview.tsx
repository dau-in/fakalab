import { useEffect, useRef } from "react";

interface Props {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** Draws decoded RGBA pixels at their native size; CSS scales them to fit. */
export function TexturePreview({ width, height, rgba }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
  }, [rgba, width, height]);

  return <canvas ref={canvas} width={width} height={height} />;
}
