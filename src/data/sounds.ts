/**
 * Sounds live under public/sound at the same paths the models ask for, so a
 * path taken from a model's animation events is also the path to fetch.
 */

export function soundUrl(path: string): string {
  return `${import.meta.env.BASE_URL}sound/${path}`;
}

export async function fetchSound(path: string): Promise<Uint8Array> {
  const response = await fetch(soundUrl(path));
  if (!response.ok) throw new Error(`Missing sound ${path} (HTTP ${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The sound worth previewing: the inspect flourish if the knife has one, since
 * that is what plays while standing still, otherwise whatever it draws with.
 */
export function previewSound(paths: string[]): string | null {
  const inspect = paths.find((path) => /look|inspect|flip|catch/i.test(path));
  return inspect ?? paths[0] ?? null;
}
