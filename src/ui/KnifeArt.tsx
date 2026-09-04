import { KNIFE_ART, type Material } from "./knife-art";

/** Each material is a CSS variable, so a theme change carries the artwork. */
const CLASS: Record<Material, string> = {
  face: "ka-face",
  bevel: "ka-bevel",
  grip: "ka-grip",
  grit: "ka-grit",
  edge: "ka-edge",
};

interface Props {
  slug: string;
  size?: number;
}

export function KnifeArt({ slug, size = 40 }: Props) {
  const shapes = KNIFE_ART[slug];
  if (!shapes) return null;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {shapes.map((shape, index) => (
        <path
          key={index}
          d={shape.d}
          className={CLASS[shape.material]}
          fillRule={shape.evenOdd ? "evenodd" : "nonzero"}
        />
      ))}
    </svg>
  );
}
