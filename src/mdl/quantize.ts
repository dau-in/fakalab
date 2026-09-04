/**
 * Reduces an RGB image back to 256 colors, so it can be written into a GoldSrc
 * texture.
 *
 * The whole-knife recolor never needs this: recoloring a palette entry recolors
 * every pixel using it, and the file's pixel bytes are untouched. Colouring the
 * blade differently from the handle does need it, because a palette entry is
 * shared across the whole texture, and so does any pattern, because the colour
 * then depends on where a pixel is rather than only on how bright it was.
 *
 * This still edits in place. The pixel array is width * height bytes and the
 * palette is 768, before and after, so the file's size and every offset in it
 * stay exactly as they were.
 *
 * Median cut, on a histogram rather than the pixels: the colour space is
 * reduced to 5 bits a channel first, which turns a quarter of a million pixels
 * into at most 32768 buckets and makes the splitting cheap.
 */

const BITS = 5;
const LEVELS = 1 << BITS; // 32
const BUCKETS = LEVELS ** 3;
const SHIFT = 8 - BITS;

export interface QuantizedImage {
  /** One byte per pixel, indexing the palette. */
  pixels: Uint8Array;
  /** 256 RGB triplets, 768 bytes. */
  palette: Uint8Array;
}

interface Box {
  /** Inclusive bucket bounds per channel. */
  min: [number, number, number];
  max: [number, number, number];
  count: number;
  /** Sum of each channel over the pixels inside, for the average. */
  sum: [number, number, number];
}

const bucketOf = (r: number, g: number, b: number) =>
  ((r >> SHIFT) << (BITS * 2)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);

/** Walks every occupied bucket in a box, calling back with its coordinates. */
function eachBucket(
  box: Box,
  counts: Uint32Array,
  visit: (bucket: number, r: number, g: number, b: number, count: number) => void,
): void {
  for (let r = box.min[0]; r <= box.max[0]; r += 1) {
    for (let g = box.min[1]; g <= box.max[1]; g += 1) {
      for (let b = box.min[2]; b <= box.max[2]; b += 1) {
        const bucket = (r << (BITS * 2)) | (g << BITS) | b;
        const count = counts[bucket];
        if (count > 0) visit(bucket, r, g, b, count);
      }
    }
  }
}

/** Recomputes a box's population and colour sums from the histogram. */
function measure(box: Box, counts: Uint32Array, sums: Float64Array): void {
  box.count = 0;
  box.sum = [0, 0, 0];
  eachBucket(box, counts, (bucket, _r, _g, _b, count) => {
    box.count += count;
    box.sum[0] += sums[bucket * 3];
    box.sum[1] += sums[bucket * 3 + 1];
    box.sum[2] += sums[bucket * 3 + 2];
  });
}

/** Shrinks a box to the occupied buckets it actually contains. */
function tighten(box: Box, counts: Uint32Array): void {
  const min: [number, number, number] = [LEVELS, LEVELS, LEVELS];
  const max: [number, number, number] = [-1, -1, -1];

  eachBucket(box, counts, (_bucket, r, g, b) => {
    const point = [r, g, b];
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  });

  if (max[0] >= 0) {
    box.min = min;
    box.max = max;
  }
}

/**
 * Builds a palette of at most `size` colours covering the image, and maps every
 * pixel onto it. `dither` spreads the rounding error into neighbouring pixels,
 * which matters for smooth gradients and does nothing useful for flat areas.
 */
export function quantize(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  size = 256,
  dither = true,
): QuantizedImage {
  const counts = new Uint32Array(BUCKETS);
  const sums = new Float64Array(BUCKETS * 3);

  for (let i = 0; i < width * height; i += 1) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const bucket = bucketOf(r, g, b);
    counts[bucket] += 1;
    sums[bucket * 3] += r;
    sums[bucket * 3 + 1] += g;
    sums[bucket * 3 + 2] += b;
  }

  const first: Box = {
    min: [0, 0, 0],
    max: [LEVELS - 1, LEVELS - 1, LEVELS - 1],
    count: 0,
    sum: [0, 0, 0],
  };
  tighten(first, counts);
  measure(first, counts, sums);
  const boxes: Box[] = [first];

  while (boxes.length < size) {
    // Split the box holding the most pixels across the widest channel. Volume
    // alone would chase rare outliers; population alone would ignore range.
    let target = -1;
    let score = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      const extent = Math.max(
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      );
      if (extent < 1) continue;
      const value = box.count * (extent + 1);
      if (value > score) {
        score = value;
        target = i;
      }
    }
    if (target < 0) break;

    const box = boxes[target];
    let axis = 0;
    let widest = -1;
    for (let i = 0; i < 3; i += 1) {
      const extent = box.max[i] - box.min[i];
      if (extent > widest) {
        widest = extent;
        axis = i;
      }
    }

    // Cut at the population median along that channel.
    const half = box.count / 2;
    let running = 0;
    let cut = box.min[axis];
    for (let value = box.min[axis]; value <= box.max[axis]; value += 1) {
      const slice: Box = {
        min: [...box.min] as [number, number, number],
        max: [...box.max] as [number, number, number],
        count: 0,
        sum: [0, 0, 0],
      };
      slice.min[axis] = value;
      slice.max[axis] = value;
      let population = 0;
      eachBucket(slice, counts, (_b, _r, _g, _bl, count) => {
        population += count;
      });
      running += population;
      cut = value;
      if (running >= half && value < box.max[axis]) break;
    }
    if (cut >= box.max[axis]) cut = box.max[axis] - 1;

    const low: Box = { ...box, min: [...box.min], max: [...box.max] } as Box;
    const high: Box = { ...box, min: [...box.min], max: [...box.max] } as Box;
    low.max[axis] = cut;
    high.min[axis] = cut + 1;

    tighten(low, counts);
    measure(low, counts, sums);
    tighten(high, counts);
    measure(high, counts, sums);

    boxes.splice(target, 1, low, high);
  }

  const palette = new Uint8Array(768);
  const entries: Array<[number, number, number]> = [];
  boxes.forEach((box, index) => {
    const color: [number, number, number] =
      box.count > 0
        ? [
            Math.round(box.sum[0] / box.count),
            Math.round(box.sum[1] / box.count),
            Math.round(box.sum[2] / box.count),
          ]
        : [0, 0, 0];
    entries.push(color);
    palette[index * 3] = color[0];
    palette[index * 3 + 1] = color[1];
    palette[index * 3 + 2] = color[2];
  });

  // Nearest-entry lookups repeat enormously, so cache them by reduced colour.
  const cache = new Int16Array(BUCKETS).fill(-1);
  const nearest = (r: number, g: number, b: number): number => {
    const bucket = bucketOf(r, g, b);
    const cached = cache[bucket];
    if (cached >= 0) return cached;

    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < entries.length; i += 1) {
      const dr = r - entries[i][0];
      const dg = g - entries[i][1];
      const db = b - entries[i][2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    cache[bucket] = best;
    return best;
  };

  const pixels = new Uint8Array(width * height);

  if (!dither) {
    for (let i = 0; i < pixels.length; i += 1) {
      pixels[i] = nearest(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    }
    return { pixels, palette };
  }

  // Floyd-Steinberg, carrying the error forward one row at a time.
  const current = new Float32Array(width * 3);
  const next = new Float32Array(width * 3);

  for (let x = 0; x < width * 3; x += 1) current[x] = rgb[x];

  for (let y = 0; y < height; y += 1) {
    next.fill(0);
    if (y + 1 < height) {
      for (let x = 0; x < width * 3; x += 1) next[x] = rgb[(y + 1) * width * 3 + x];
    }

    for (let x = 0; x < width; x += 1) {
      const o = x * 3;
      const r = Math.min(255, Math.max(0, current[o]));
      const g = Math.min(255, Math.max(0, current[o + 1]));
      const b = Math.min(255, Math.max(0, current[o + 2]));

      const index = nearest(Math.round(r), Math.round(g), Math.round(b));
      pixels[y * width + x] = index;

      const error = [r - entries[index][0], g - entries[index][1], b - entries[index][2]];
      const spread = (target: Float32Array, at: number, factor: number) => {
        if (at < 0 || at >= width * 3) return;
        for (let c = 0; c < 3; c += 1) target[at + c] += error[c] * factor;
      };
      spread(current, o + 3, 7 / 16);
      spread(next, o - 3, 3 / 16);
      spread(next, o, 5 / 16);
      spread(next, o + 3, 1 / 16);
    }

    current.set(next);
  }

  return { pixels, palette };
}
