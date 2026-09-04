/**
 * A very small SVG path rasterizer, for looking at artwork before shipping it.
 *
 * Handles the subset the knife icons are drawn in: absolute and relative
 * moveto, lineto, horizontal and vertical lineto, cubic curves and close, with
 * even-odd or nonzero filling. No strokes, no transforms beyond one applied by
 * the caller, no text. It exists so drawn icons can be checked rather than
 * assumed, which is the same reason the pose renderer exists.
 */

export interface Point {
  x: number;
  y: number;
}

type Contour = Point[];

/** Flattens a path's `d` attribute into polygons, curves sampled as segments. */
export function flattenPath(d: string, samples = 16): Contour[] {
  const tokens = d.match(/[MmLlHhVvCcSsZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const contours: Contour[] = [];
  let current: Contour = [];

  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = "";
  let at = 0;

  const number = () => Number(tokens[at++]);
  const push = (px: number, py: number) => current.push({ x: px, y: py });

  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
    for (let i = 1; i <= samples; i += 1) {
      const t = i / samples;
      const u = 1 - t;
      push(
        u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey,
      );
    }
    x = ex;
    y = ey;
  };

  while (at < tokens.length) {
    const token = tokens[at];
    if (/[MmLlHhVvCcSsZz]/.test(token)) {
      command = token;
      at += 1;
    }

    switch (command) {
      case "M":
      case "m": {
        const nx = number();
        const ny = number();
        x = command === "M" ? nx : x + nx;
        y = command === "M" ? ny : y + ny;
        if (current.length > 1) contours.push(current);
        current = [];
        push(x, y);
        startX = x;
        startY = y;
        // Further coordinate pairs after a moveto are implicit linetos.
        command = command === "M" ? "L" : "l";
        break;
      }
      case "L":
      case "l": {
        const nx = number();
        const ny = number();
        x = command === "L" ? nx : x + nx;
        y = command === "L" ? ny : y + ny;
        push(x, y);
        break;
      }
      case "H":
      case "h": {
        const nx = number();
        x = command === "H" ? nx : x + nx;
        push(x, y);
        break;
      }
      case "V":
      case "v": {
        const ny = number();
        y = command === "V" ? ny : y + ny;
        push(x, y);
        break;
      }
      case "C":
      case "c": {
        const relative = command === "c";
        const x1 = number() + (relative ? x : 0);
        const y1 = number() + (relative ? y : 0);
        const x2 = number() + (relative ? x : 0);
        const y2 = number() + (relative ? y : 0);
        const ex = number() + (relative ? x : 0);
        const ey = number() + (relative ? y : 0);
        cubic(x1, y1, x2, y2, ex, ey);
        break;
      }
      case "Z":
      case "z": {
        if (current.length > 1) contours.push(current);
        current = [];
        x = startX;
        y = startY;
        push(x, y);
        break;
      }
      default:
        at += 1;
    }
  }

  if (current.length > 1) contours.push(current);
  return contours;
}

export interface Shape {
  d: string;
  color: [number, number, number];
  evenOdd?: boolean;
}

/**
 * Fills shapes in order onto an RGB buffer, supersampled for smooth edges.
 * `scale` maps the SVG's own units onto the output.
 */
export function rasterize(
  shapes: Shape[],
  size: number,
  viewBox: number,
  background: [number, number, number] = [0, 0, 0],
  supersample = 3,
): Uint8Array {
  const big = size * supersample;
  const scale = big / viewBox;
  const accum = new Float32Array(big * big * 3);
  for (let i = 0; i < big * big; i += 1) {
    for (let c = 0; c < 3; c += 1) accum[i * 3 + c] = background[c];
  }

  for (const shape of shapes) {
    const contours = flattenPath(shape.d).map((contour) =>
      contour.map((point) => ({ x: point.x * scale, y: point.y * scale })),
    );
    if (contours.length === 0) continue;

    let minY = Infinity;
    let maxY = -Infinity;
    for (const contour of contours) {
      for (const point of contour) {
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      }
    }

    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(big - 1, Math.ceil(maxY));

    for (let y = y0; y <= y1; y += 1) {
      const scan = y + 0.5;
      // Crossings with a winding direction, so both fill rules are available.
      const hits: Array<{ x: number; winding: number }> = [];

      for (const contour of contours) {
        for (let i = 0; i < contour.length; i += 1) {
          const a = contour[i];
          const b = contour[(i + 1) % contour.length];
          if (a.y === b.y) continue;
          if (scan < Math.min(a.y, b.y) || scan >= Math.max(a.y, b.y)) continue;
          const t = (scan - a.y) / (b.y - a.y);
          hits.push({ x: a.x + (b.x - a.x) * t, winding: b.y > a.y ? 1 : -1 });
        }
      }
      if (hits.length < 2) continue;
      hits.sort((a, b) => a.x - b.x);

      let winding = 0;
      for (let i = 0; i < hits.length - 1; i += 1) {
        winding += shape.evenOdd ? 1 : hits[i].winding;
        const inside = shape.evenOdd ? winding % 2 !== 0 : winding !== 0;
        if (!inside) continue;

        const from = Math.max(0, Math.ceil(hits[i].x - 0.5));
        const to = Math.min(big - 1, Math.floor(hits[i + 1].x - 0.5));
        for (let x = from; x <= to; x += 1) {
          const o = (y * big + x) * 3;
          for (let c = 0; c < 3; c += 1) accum[o + c] = shape.color[c];
        }
      }
    }
  }

  // Box down to the requested size, which is where the antialiasing comes from.
  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sums = [0, 0, 0];
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const o = ((y * supersample + sy) * big + x * supersample + sx) * 3;
          for (let c = 0; c < 3; c += 1) sums[c] += accum[o + c];
        }
      }
      const d = (y * size + x) * 3;
      const n = supersample * supersample;
      for (let c = 0; c < 3; c += 1) out[d + c] = sums[c] / n;
    }
  }
  return out;
}
