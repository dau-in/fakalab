/**
 * Pixel-grid icons.
 *
 * Everything is drawn on a 16x16 lattice with crisp edges, so the shapes stay
 * square at any size and sit next to ArialPixel without looking imported from
 * a different decade.
 */

interface IconProps {
  size?: number;
  title?: string;
}

function Svg({ size = 16, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {children}
    </svg>
  );
}

export function KnifeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {/* blade sweeping up to the right, then a short grip */}
      <path d="M2 9h1v1H2zM3 8h1v1H3zM4 7h2v1H4zM6 6h2v1H6zM8 5h2v1H8zM10 4h2v1h-2zM12 3h2v1h-2z" />
      <path d="M3 10h2v1H3zM5 9h2v1H5zM7 8h2v1H7zM9 7h2v1H9zM11 6h2v1h-2z" />
      <path d="M2 11h3v1H2zM5 11h2v1H5z" />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 3h2v10H4zM6 4h2v8H6zM8 5h2v6H8zM10 6h2v4h-2z" />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 3h3v10H4zM9 3h3v10H9z" />
    </Svg>
  );
}

/** Game view: the viewmodel framing, an eye at the origin. */
export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 4h6v1H5zM3 5h2v1H3zM11 5h2v1h-2zM2 6h1v4H2zM13 6h1v4h-1z" />
      <path d="M3 10h2v1H3zM11 10h2v1h-2zM5 11h6v1H5z" />
      <path d="M6 6h4v4H6z" />
    </Svg>
  );
}

/** Free view: an orbiting box. */
export function OrbitIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4h4v1H6zM5 5h1v1H5zM10 5h1v1h-1zM4 6h1v4H4zM11 6h1v4h-1z" />
      <path d="M5 10h1v1H5zM10 10h1v1h-1zM6 11h4v1H6z" />
      <path d="M7 7h2v2H7z" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 2h2v6H7zM4 7h2v1H4zM10 7h2v1h-2zM5 8h2v1H5zM9 8h2v1H9zM6 9h4v1H6z" />
      <path d="M2 12h12v2H2z" />
    </Svg>
  );
}

export function SoundIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6h2v4H6zM4 6h2v4H4zM8 3h1v10H8z" />
      <path d="M11 5h1v6h-1zM13 3h1v10h-1z" />
    </Svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 1h2v3H7zM7 12h2v3H7zM1 7h3v2H1zM12 7h3v2h-3z" />
      <path d="M3 3h2v2H3zM11 3h2v2h-2zM3 11h2v2H3zM11 11h2v2h-2z" />
      <path d="M6 6h4v4H6z" />
    </Svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 2h5v1H6zM4 3h2v1H4zM3 4h1v2H3zM2 6h1v4H2zM3 10h1v2H3zM4 12h2v1H4zM6 13h5v1H6z" />
      <path d="M11 3h1v1h-1zM12 4h1v1h-1zM11 12h1v1h-1zM12 11h1v1h-1z" />
      <path d="M9 4h3v8H9z" />
    </Svg>
  );
}

/** The CS 1.6 theme, marked with the game's own crosshair. */
export function CrosshairIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 1h2v5H7zM7 10h2v5H7zM1 7h5v2H1zM10 7h5v2h-5z" />
    </Svg>
  );
}

export function PaletteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 3h12v2H2zM2 6h12v2H2zM2 9h12v2H2zM2 12h12v2H2z" />
    </Svg>
  );
}

export function SceneIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 2h12v1H2zM2 13h12v1H2zM2 2h1v12H2zM13 2h1v12h-1z" />
      <path d="M4 9h3v3H4zM7 7h3v5H7zM10 10h2v2h-2z" />
      <path d="M11 4h2v2h-2z" />
    </Svg>
  );
}

export function HelpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3h6v1H5zM4 4h2v2H4zM10 4h2v3h-2zM9 7h2v2H9zM7 9h2v3H7zM7 13h2v2H7z" />
    </Svg>
  );
}
