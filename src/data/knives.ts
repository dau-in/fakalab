/**
 * The shipped knife library. Slugs match the folders under
 * models-source/csgo-knives-pack/models, which scripts/sync-assets.mjs
 * flattens into public/models/<slug>.mdl.
 */

export interface Knife {
  slug: string;
  name: string;
}

export const KNIVES: Knife[] = [
  { slug: "bayonet-knife", name: "Bayonet" },
  { slug: "bowie-knife", name: "Bowie" },
  { slug: "butterfly-knife", name: "Butterfly" },
  { slug: "classic-knife", name: "Classic" },
  { slug: "counter-terrorist-knife", name: "CT Knife" },
  { slug: "falchion-knife", name: "Falchion" },
  { slug: "flip-knife", name: "Flip" },
  { slug: "gut-knife", name: "Gut" },
  { slug: "huntsman-knife", name: "Huntsman" },
  { slug: "karambit-knife", name: "Karambit" },
  { slug: "m9-bayonet", name: "M9 Bayonet" },
  { slug: "navaja-knife", name: "Navaja" },
  { slug: "nomad-knife", name: "Nomad" },
  { slug: "paracord-knife", name: "Paracord" },
  { slug: "shadow-daggers", name: "Shadow Daggers" },
  { slug: "skeleton-knife", name: "Skeleton" },
  { slug: "stiletto-knife", name: "Stiletto" },
  { slug: "survival-knife", name: "Survival" },
  { slug: "talon-knife", name: "Talon" },
  { slug: "terrorist-knife", name: "T Knife" },
  { slug: "ursus-knife", name: "Ursus" },
];

export function modelUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}models/${slug}.mdl`;
}

/** Rendered from the model itself by scripts/build-thumbnails.ts. */
export function thumbnailUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}thumbs/${slug}.png`;
}
