/**
 * Backdrops behind the viewport, built from Counter-Strike's own skyboxes by
 * scripts/build-backdrops.ts. They are blurred and dimmed already, so the CSS
 * only has to place them.
 */

export interface Backdrop {
  id: string;
  name: string;
}

export const BACKDROPS: Backdrop[] = [
  { id: "none", name: "None" },
  { id: "desert", name: "Desert" },
  { id: "dawn", name: "Dawn" },
  { id: "city", name: "City" },
  { id: "storm", name: "Storm" },
  { id: "snow", name: "Snow" },
  { id: "night", name: "Night" },
];

export const DEFAULT_BACKDROP = "desert";

export function backdropUrl(id: string): string | null {
  return id === "none" ? null : `${import.meta.env.BASE_URL}backdrops/${id}.png`;
}
