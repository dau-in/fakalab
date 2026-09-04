import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import logo from "./assets/karambit.svg";
import { KNIVES, modelUrl, thumbnailUrl } from "./data/knives";
import { DEFAULT_PRESET, PRESETS } from "./data/presets";
import { fetchSound, previewSound, soundUrl } from "./data/sounds";
import { buildBundle } from "./export";
import { idleSequence } from "./mdl/animation";
import { parseMdl, soundEvents, type MdlFile } from "./mdl/parse";
import { toStops as rampFrom } from "./data/presets";
import { PATTERNS } from "./mdl/patterns";
import { loadRegionMask, REGIONS, type RegionMask } from "./mdl/regions";
import type { Adjust, Look } from "./mdl/recolor";
import { useRecolor } from "./ui/useRecolor";
import { DEFAULT_LIGHTING, type Lighting } from "./three/goldsrcMaterial";
import { Viewport } from "./three/Viewport";
import {
  CrosshairIcon,
  DownloadIcon,
  EyeIcon,
  HelpIcon,
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

/** Editing scope: the whole knife, or one region of it. */
const SCOPE_ALL = 0;

/** Every region starts on the same preset, so a knife opens looking coherent. */
function rampsFor(colors: string[]): Record<number, string[]> {
  const out: Record<number, string[]> = { [SCOPE_ALL]: [...colors] };
  for (const region of REGIONS) out[region.id] = [...colors];
  return out;
}

export default function App() {
  const [theme, setTheme] = useTheme();

  const [slug, setSlug] = useState(KNIVES[9].slug); // Karambit
  const [model, setModel] = useState<MdlFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [ramps, setRamps] = useState(() => rampsFor(DEFAULT_PRESET.colors));
  const [scope, setScope] = useState<number>(SCOPE_ALL);
  const [adjust, setAdjust] = useState<Adjust>({ brightness: 0, contrast: 0 });
  const [patternId, setPatternId] = useState("none");
  const [patternStrength, setPatternStrength] = useState(0.8);
  const [mask, setMask] = useState<RegionMask | null>(null);

  const [free, setFree] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [tab, setTab] = useState<Tab>("knife");
  const [withSounds, setWithSounds] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [exporting, setExporting] = useState(false);
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

  // The region mask is per model, so it travels with it.
  useEffect(() => {
    let cancelled = false;
    setMask(null);
    loadRegionMask(slug)
      .then((loaded) => {
        if (!cancelled) setMask(loaded);
      })
      .catch(() => {
        // Without a mask the knife is simply treated as one region.
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  /** Which regions this knife actually has; a couple are one region throughout. */
  const regions = useMemo(
    () => REGIONS.filter((region) => mask?.present.includes(region.id)),
    [mask],
  );

  const look = useMemo<Look>(
    () => ({
      ramps: Object.fromEntries(
        Object.entries(ramps).map(([id, colors]) => [Number(id), rampFrom(colors)]),
      ),
      adjust,
      patternId,
      patternStrength,
    }),
    [ramps, adjust, patternId, patternStrength],
  );

  const { textures: recolored, working, perPixel } = useRecolor(model, mask, look);

  /** The ramp the editor is showing, which follows the scope. */
  const editing = scope === SCOPE_ALL ? (regions[0]?.id ?? SCOPE_ALL) : scope;
  const colors = ramps[editing] ?? ramps[SCOPE_ALL];

  const lighting = useMemo<Lighting>(
    () => ({ ...DEFAULT_LIGHTING, ambient, shade }),
    [ambient, shade],
  );

  const sequence = useMemo(() => (model ? idleSequence(model) : null), [model]);
  const sounds = useMemo(() => (model ? soundEvents(model) : []), [model]);

  const knifeName = KNIVES.find((knife) => knife.slug === slug)?.name ?? slug;

  /** Whole-knife edits write every region, so parts never drift apart. */
  const writeRamp = useCallback(
    (update: (colors: string[]) => string[]) => {
      setRamps((previous) => {
        const next = { ...previous };
        const keys =
          scope === SCOPE_ALL ? Object.keys(previous).map(Number) : [scope];
        for (const key of keys) next[key] = update(previous[key] ?? previous[SCOPE_ALL]);
        return next;
      });
    },
    [scope],
  );

  const applyPreset = useCallback(
    (id: string) => {
      const preset = PRESETS.find((candidate) => candidate.id === id);
      if (!preset) return;
      if (scope === SCOPE_ALL) setPresetId(preset.id);
      writeRamp(() => [...preset.colors]);
    },
    [scope, writeRamp],
  );

  const setStopColor = useCallback(
    (index: number, value: string) => {
      setPresetId("custom");
      writeRamp((colors) => colors.map((color, i) => (i === index ? value : color)));
    },
    [writeRamp],
  );

  const presetName =
    PRESETS.find((preset) => preset.id === presetId)?.name ?? "Custom";

  const download = useCallback(async () => {
    if (!model || recolored.length === 0) return;
    setExporting(true);
    try {
      const bundle = await buildBundle({
        model,
        recolored,
        knifeName,
        presetName,
        ...(withSounds && sounds.length > 0 ? { loadSound: fetchSound } : {}),
      });

      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = URL.createObjectURL(bundle.blob);

      const link = document.createElement("a");
      link.href = downloadUrl.current;
      link.download = bundle.filename;
      link.click();
    } finally {
      setExporting(false);
    }
  }, [model, recolored, knifeName, presetName, withSounds, sounds]);

  const playPreview = useCallback(() => {
    const path = previewSound(sounds);
    if (!path) return;
    void new Audio(soundUrl(path)).play().catch(() => {
      // Autoplay policies and missing files are both non-events here.
    });
  }, [sounds]);

  useEffect(
    () => () => {
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    },
    [],
  );

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">
          <img src={logo} width={22} height={22} alt="" />
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
              <img
                className="knife-thumb"
                src={thumbnailUrl(knife.slug)}
                width={40}
                height={40}
                alt=""
                loading="lazy"
              />
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
            {working && !loading && !error && <p className="overlay busy">Redrawing…</p>}
          </div>

          <div className="readout">
            <span>
              <b>v_knife.mdl</b>
            </span>
            <span>
              size <b>{model ? model.header.length.toLocaleString("en-US") : "—"} B</b>
            </span>
            <span className="hi">
              rewritten{" "}
              <b>
                {perPixel
                  ? `${recolored.reduce((sum, t) => sum + 768 + (t.pixels?.length ?? 0), 0).toLocaleString("en-US")} B`
                  : `${recolored.length * 768} B`}
              </b>
            </span>
            <span>{perPixel ? "palette and pixels" : "palette only"}</span>
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
              {regions.length > 1 && (
                <section className="section">
                  <h2>Colouring</h2>
                  <div className="scope">
                    <button
                      type="button"
                      className="cs-btn"
                      aria-pressed={scope === SCOPE_ALL}
                      onClick={() => setScope(SCOPE_ALL)}
                    >
                      Whole knife
                    </button>
                    {regions.map((region) => (
                      <button
                        key={region.id}
                        type="button"
                        className="cs-btn"
                        aria-pressed={scope === region.id}
                        onClick={() => setScope(region.id)}
                      >
                        {region.name}
                      </button>
                    ))}
                  </div>
                </section>
              )}

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
                <h2>
                  Ramp · shadow to light
                  {scope !== SCOPE_ALL && regions.length > 1
                    ? ` · ${regions.find((region) => region.id === scope)?.name.toLowerCase()}`
                    : ""}
                </h2>
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
                <h2>Pattern</h2>
                <div className="patterns">
                  {PATTERNS.map((pattern) => (
                    <button
                      key={pattern.id}
                      type="button"
                      className="cs-btn"
                      aria-pressed={pattern.id === patternId}
                      onClick={() => {
                        setPatternId(pattern.id);
                        if (pattern.id !== "none") setPatternStrength(pattern.strength);
                      }}
                    >
                      {pattern.name}
                    </button>
                  ))}
                </div>
                {patternId !== "none" && (
                  <div className="field" style={{ marginTop: 10 }}>
                    <span className="label">
                      Amount <b>{patternStrength.toFixed(2)}</b>
                    </span>
                    <div className="cs-slider">
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={patternStrength}
                        onChange={(event) => setPatternStrength(Number(event.target.value))}
                      />
                    </div>
                  </div>
                )}
                <p className="note" style={{ marginTop: 8 }}>
                  A pattern moves each pixel along the ramp, so it picks up the
                  ramp's colours rather than needing its own.
                </p>
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
        <button
          type="button"
          className="cs-btn icon-btn"
          onClick={playPreview}
          disabled={sounds.length === 0}
        >
          <SoundIcon />
          Preview
        </button>

        <button
          type="button"
          className="cs-btn icon-btn"
          onClick={() => setShowHelp(true)}
        >
          <HelpIcon />
          How to install
        </button>

        <span className="spacer" />

        <span className="export-note">
          {knifeName.toLowerCase()} · {presetName.toLowerCase()}
          <br />
          {withSounds && sounds.length > 0
            ? `zip with the model and ${sounds.length} sounds`
            : "one file, v_knife.mdl"}
        </span>
        <button
          type="button"
          className="cs-btn icon-btn primary"
          onClick={() => void download()}
          disabled={!model || exporting}
        >
          <DownloadIcon />
          {exporting ? "Packing…" : "Download"}
        </button>
      </footer>

      {showHelp && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowHelp(false);
          }}
        >
          <div className="modal raised" role="dialog" aria-modal="true" aria-label="How to install">
            <div className="modal-title">
              <span>How to install</span>
              <button type="button" className="cs-btn" onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>

            <ol className="steps">
              <li>
                Find your Counter-Strike folder. It usually looks like
                <code>…\Steam\steamapps\common\Half-Life\cstrike</code>
              </li>
              <li>
                Back up the knife you have now: rename
                <code>cstrike\models_knife.mdl</code> to
                <code>v_knife.mdl.backup</code>
              </li>
              <li>
                {withSounds && sounds.length > 0
                  ? "Copy the folders from the zip into cstrike and let them merge."
                  : "Drop the downloaded v_knife.mdl into cstrike\models."}
              </li>
              <li>Start the game. That is it.</li>
            </ol>

            <p className="note">
              Only the viewmodel changes, which is the knife in your own hands.
              Everyone else still sees their own knife.
            </p>
            {sounds.length > 0 && (
              <p className="note">
                Sounds install into their own folder and never replace an original
                Counter-Strike sound. Skip them and the knife still works, just quietly.
              </p>
            )}
            <p className="note">
              To undo: delete <code>v_knife.mdl</code> and rename your backup back.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
