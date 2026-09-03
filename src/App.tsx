import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KNIVES, modelUrl } from "./data/knives";
import { DEFAULT_PRESET, PRESETS, toStops } from "./data/presets";
import { idleSequence } from "./mdl/animation";
import { knifeTextures, parseMdl, soundEvents, type MdlFile } from "./mdl/parse";
import { buildRecoloredFile, recolorTextures, type Adjust } from "./mdl/recolor";
import { DEFAULT_LIGHTING, type Lighting } from "./three/goldsrcMaterial";
import { Viewport } from "./three/Viewport";
import {
  CrosshairIcon,
  DownloadIcon,
  EyeIcon,
  KnifeIcon,
  MoonIcon,
  OrbitIcon,
  PaletteIcon,
  PauseIcon,
  PlayIcon,
  SceneIcon,
  SoundIcon,
  SunIcon,
} from "./ui/icons";
import { useTheme, type Theme } from "./ui/useTheme";

const STOP_LABELS = ["Shadow", "Mid", "Light", "Peak"];

const THEME_BUTTONS: Array<{ id: Theme; label: string; Icon: typeof SunIcon }> = [
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "dark", label: "Dark", Icon: MoonIcon },
  { id: "cs16", label: "CS 1.6", Icon: CrosshairIcon },
];

type Tab = "knife" | "scene";

export default function App() {
  const [theme, setTheme] = useTheme();

  const [slug, setSlug] = useState(KNIVES[9].slug); // Karambit
  const [model, setModel] = useState<MdlFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [colors, setColors] = useState<string[]>([...DEFAULT_PRESET.colors]);
  const [adjust, setAdjust] = useState<Adjust>({ brightness: 0, contrast: 0 });

  const [free, setFree] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [tab, setTab] = useState<Tab>("knife");
  const [withSounds, setWithSounds] = useState(true);
  const [ambient, setAmbient] = useState(DEFAULT_LIGHTING.ambient);
  const [shade, setShade] = useState(DEFAULT_LIGHTING.shade);

  const downloadUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(modelUrl(slug))
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load the model (HTTP ${response.status}).`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (!cancelled) setModel(parseMdl(buffer));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setModel(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const targets = useMemo(() => (model ? knifeTextures(model) : []), [model]);
  const stops = useMemo(() => toStops(colors), [colors]);

  const recolored = useMemo(
    () => (model && targets.length > 0 ? recolorTextures(model, targets, stops, adjust) : []),
    [model, targets, stops, adjust],
  );

  const lighting = useMemo<Lighting>(
    () => ({ ...DEFAULT_LIGHTING, ambient, shade }),
    [ambient, shade],
  );

  const sequence = useMemo(() => (model ? idleSequence(model) : null), [model]);
  const sounds = useMemo(() => (model ? soundEvents(model) : []), [model]);

  const applyPreset = useCallback((id: string) => {
    const preset = PRESETS.find((candidate) => candidate.id === id);
    if (!preset) return;
    setPresetId(preset.id);
    setColors([...preset.colors]);
  }, []);

  const setStopColor = useCallback((index: number, value: string) => {
    setPresetId("custom");
    setColors((previous) => previous.map((color, i) => (i === index ? value : color)));
  }, []);

  const download = useCallback(() => {
    if (!model || recolored.length === 0) return;
    const bytes = buildRecoloredFile(model, recolored);
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = URL.createObjectURL(
      new Blob([bytes], { type: "application/octet-stream" }),
    );

    const link = document.createElement("a");
    link.href = downloadUrl.current;
    link.download = "v_knife.mdl";
    link.click();
  }, [model, recolored]);

  useEffect(
    () => () => {
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    },
    [],
  );

  const knifeName = KNIVES.find((knife) => knife.slug === slug)?.name ?? slug;

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">
          <KnifeIcon size={18} />
          Faka<b>Lab</b>
        </span>

        <span className="spacer" />

        <div className="group">
          <span className="group-label">Theme</span>
          {THEME_BUTTONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className="cs-btn icon-btn"
              aria-pressed={theme === id}
              onClick={() => setTheme(id)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>

        <div className="group">
          <span className="group-label">View</span>
          <button
            type="button"
            className="cs-btn icon-btn"
            aria-pressed={!free}
            onClick={() => setFree(false)}
          >
            <EyeIcon />
            In game
          </button>
          <button
            type="button"
            className="cs-btn icon-btn"
            aria-pressed={free}
            onClick={() => setFree(true)}
          >
            <OrbitIcon />
            Free
          </button>
          <button
            type="button"
            className="cs-btn icon-btn"
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
            {playing ? "Pause" : "Play"}
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="rail" aria-label="Knives">
          <div className="rail-title">
            <span>Knife</span>
            <span>{KNIVES.length}</span>
          </div>
          {KNIVES.map((knife) => (
            <button
              key={knife.slug}
              type="button"
              className="knife"
              aria-pressed={knife.slug === slug}
              onClick={() => setSlug(knife.slug)}
            >
              <KnifeIcon />
              <span>{knife.name}</span>
            </button>
          ))}
        </nav>

        <main className="stage">
          <div className="viewport">
            <Viewport
              model={model}
              recolored={recolored}
              lighting={lighting}
              free={free}
              playing={playing}
            />
            {loading && <p className="overlay">Loading {knifeName}…</p>}
            {error && <p className="overlay error">{error}</p>}
          </div>

          <div className="readout">
            <span>
              <b>v_knife.mdl</b>
            </span>
            <span>
              size <b>{model ? model.header.length.toLocaleString("en-US") : "—"} B</b>
            </span>
            <span className="hi">
              rewritten <b>{recolored.length * 768} B</b>
            </span>
            <span>structure unchanged</span>
            <span className="spacer" />
            <span>
              {sequence
                ? `${sequence.label} · ${sequence.numFrames} f · ${sequence.fps.toFixed(0)} fps`
                : "—"}
            </span>
          </div>
        </main>

        <aside className="panel" aria-label="Customization">
          <div className="panel-tabs">
            <button
              type="button"
              className="cs-btn icon-btn"
              aria-pressed={tab === "knife"}
              onClick={() => setTab("knife")}
            >
              <PaletteIcon />
              Knife
            </button>
            <button
              type="button"
              className="cs-btn icon-btn"
              aria-pressed={tab === "scene"}
              onClick={() => setTab("scene")}
            >
              <SceneIcon />
              Scene
            </button>
          </div>

          {tab === "knife" ? (
            <div className="panel-body">
              <section className="section">
                <h2>Finishes</h2>
                <div className="presets">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="preset raised"
                      aria-pressed={preset.id === presetId}
                      onClick={() => applyPreset(preset.id)}
                    >
                      <span
                        className="chip"
                        style={{
                          background: `linear-gradient(150deg, ${preset.colors.join(",")})`,
                        }}
                      />
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="section">
                <h2>Ramp · shadow to light</h2>
                <div
                  className="ramp inset"
                  style={{ background: `linear-gradient(90deg, ${colors.join(",")})` }}
                />
                <div className="stops">
                  {colors.map((color, index) => (
                    <label key={STOP_LABELS[index]} className="stop">
                      <span>{STOP_LABELS[index]}</span>
                      <input
                        type="color"
                        value={color}
                        onChange={(event) => setStopColor(index, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="section">
                <h2>Adjust</h2>
                <div className="field">
                  <span className="label">
                    Brightness <b>{adjust.brightness.toFixed(2)}</b>
                  </span>
                  <div className="cs-slider">
                    <input
                      type="range"
                      min={-0.5}
                      max={0.5}
                      step={0.01}
                      value={adjust.brightness}
                      onChange={(event) =>
                        setAdjust((previous) => ({
                          ...previous,
                          brightness: Number(event.target.value),
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="field">
                  <span className="label">
                    Contrast <b>{adjust.contrast.toFixed(2)}</b>
                  </span>
                  <div className="cs-slider">
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.02}
                      value={adjust.contrast}
                      onChange={(event) =>
                        setAdjust((previous) => ({
                          ...previous,
                          contrast: Number(event.target.value),
                        }))
                      }
                    />
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="panel-body">
              <section className="section">
                <h2>Map light</h2>
                <p className="group-label" style={{ margin: "0 0 10px" }}>
                  The engine reads these from the map where you stand, so they change
                  from spot to spot.
                </p>
                <div className="field">
                  <span className="label">
                    Ambient <b>{ambient}</b>
                  </span>
                  <div className="cs-slider">
                    <input
                      type="range"
                      min={0}
                      max={160}
                      step={1}
                      value={ambient}
                      onChange={(event) => setAmbient(Number(event.target.value))}
                    />
                  </div>
                </div>
                <div className="field">
                  <span className="label">
                    Shade <b>{shade}</b>
                  </span>
                  <div className="cs-slider">
                    <input
                      type="range"
                      min={0}
                      max={255 - ambient}
                      step={1}
                      value={Math.min(shade, 255 - ambient)}
                      onChange={(event) => setShade(Number(event.target.value))}
                    />
                  </div>
                </div>
              </section>

              <section className="section">
                <h2>Sounds</h2>
                <p className="group-label" style={{ margin: 0 }}>
                  This knife asks the engine for {sounds.length}{" "}
                  {sounds.length === 1 ? "sound" : "sounds"}, listed inside the model
                  itself. They install to their own folder and never replace the
                  original CS 1.6 knife sounds.
                </p>
              </section>
            </div>
          )}
        </aside>
      </div>

      <footer className="bottombar">
        <div className="cs-checkbox">
          <input
            id="with-sounds"
            type="checkbox"
            checked={withSounds}
            onChange={(event) => setWithSounds(event.target.checked)}
          />
          <label className="cs-checkbox__label" htmlFor="with-sounds">
            Include sounds
          </label>
        </div>
        <button type="button" className="cs-btn icon-btn">
          <SoundIcon />
          Preview
        </button>

        <span className="spacer" />

        <span className="export-note">
          {knifeName.toLowerCase()} · {presetId === "custom" ? "custom" : presetId}
        </span>
        <button type="button" className="cs-btn icon-btn primary" onClick={download} disabled={!model}>
          <DownloadIcon />
          Download v_knife.mdl
        </button>
      </footer>
    </div>
  );
}
