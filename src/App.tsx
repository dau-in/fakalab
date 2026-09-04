import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import logo from "./assets/karambit.svg";
import { BACKDROPS, backdropUrl, DEFAULT_BACKDROP } from "./data/backdrops";
import { KNIVES, modelUrl, thumbnailUrl } from "./data/knives";
import { DEFAULT_PRESET, finishesOf, PRESETS, type Preset } from "./data/presets";
import { fetchSound, previewSound, soundUrl } from "./data/sounds";
import { buildBundle } from "./export";
import { idleSequence } from "./mdl/animation";
import { parseMdl, soundEvents, type MdlFile } from "./mdl/parse";
import { PATTERNS } from "./mdl/patterns";
import { loadRegionMask, REGION_HANDLE, REGIONS, type RegionMask } from "./mdl/regions";
import { FinishEditor } from "./ui/FinishEditor";
import { TextureView } from "./ui/TextureView";
import { ORIGINAL_FINISH, type Finish } from "./mdl/finish";
import type { FinishLook } from "./mdl/recolor";
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

const THEME_BUTTONS: Array<{ id: Theme; label: string; Icon: typeof SunIcon }> = [
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "dark", label: "Dark", Icon: MoonIcon },
  { id: "cs16", label: "CS 1.6", Icon: CrosshairIcon },
];

type Tab = "knife" | "scene";

/** A preset's chip: the colours it actually applies, blade above handle. */
function presetSwatch(preset: Preset): string {
  const colors = REGIONS.map((region) => {
    const finish = preset.finishes[region.id];
    if (!finish || finish.mode === "original") return "#6f736c";
    return finish.mode === "ramp" ? finish.ramp[2] : finish.color;
  });
  return `linear-gradient(160deg, ${colors[1]} 0%, ${colors[1]} 48%, ${colors[0]} 52%, ${colors[0]} 100%)`;
}


export default function App() {
  const [theme, setTheme] = useTheme();

  const [slug, setSlug] = useState(KNIVES[9].slug); // Karambit
  const [model, setModel] = useState<MdlFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [finishes, setFinishes] = useState<Record<number, Finish>>(() =>
    finishesOf(DEFAULT_PRESET, REGIONS.map((region) => region.id)),
  );
  const [part, setPart] = useState<number>(REGION_HANDLE);
  const [patternId, setPatternId] = useState(DEFAULT_PRESET.patternId);
  const [patternStrength, setPatternStrength] = useState(DEFAULT_PRESET.patternStrength);
  const [mask, setMask] = useState<RegionMask | null>(null);
  const [backdrop, setBackdrop] = useState(DEFAULT_BACKDROP);

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

  const look = useMemo<FinishLook>(
    () => ({ finishes, patternId, patternStrength }),
    [finishes, patternId, patternStrength],
  );

  const { textures: recolored, working, perPixel } = useRecolor(model, mask, look);

  /** The part being edited; single-region knives only ever have the one. */
  const editing = regions.some((region) => region.id === part)
    ? part
    : (regions[0]?.id ?? REGION_HANDLE);
  const finish = finishes[editing] ?? ORIGINAL_FINISH;

  const lighting = useMemo<Lighting>(
    () => ({ ...DEFAULT_LIGHTING, ambient, shade }),
    [ambient, shade],
  );

  const sequence = useMemo(() => (model ? idleSequence(model) : null), [model]);
  const sounds = useMemo(() => (model ? soundEvents(model) : []), [model]);

  const knifeName = KNIVES.find((knife) => knife.slug === slug)?.name ?? slug;

  const applyPreset = useCallback(
    (id: string) => {
      const preset = PRESETS.find((candidate) => candidate.id === id);
      if (!preset) return;
      setPresetId(preset.id);
      setFinishes(finishesOf(preset, REGIONS.map((region) => region.id)));
      setPatternId(preset.patternId);
      setPatternStrength(preset.patternStrength);
    },
    [],
  );

  const setFinish = useCallback(
    (next: Finish) => {
      setPresetId("custom");
      setFinishes((previous) => ({ ...previous, [editing]: next }));
    },
    [editing],
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
          <em className="beta" title="Early build. Things still move around.">
            beta
          </em>
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
          <div
            className="viewport"
            style={
              backdropUrl(backdrop)
                ? { backgroundImage: `url(${backdropUrl(backdrop)})` }
                : undefined
            }
          >
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
            <TextureView model={model} recolored={recolored} mask={mask} />
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
                        style={{ background: presetSwatch(preset) }}
                      />
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </div>
                <p className="note" style={{ marginTop: 8 }}>
                  Most of these treat one part and leave the other as the model
                  made it, which is how real skins work.
                </p>
              </section>

              {regions.length > 1 && (
                <section className="section">
                  <h2>Part</h2>
                  <div className="scope">
                    {regions.map((region) => (
                      <button
                        key={region.id}
                        type="button"
                        className="cs-btn"
                        aria-pressed={editing === region.id}
                        onClick={() => setPart(region.id)}
                      >
                        {region.name}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="section">
                <h2>
                  {regions.length > 1
                    ? `${regions.find((region) => region.id === editing)?.name ?? "Knife"} finish`
                    : "Finish"}
                </h2>
                <FinishEditor
                  finish={finish}
                  patterned={patternId !== "none" && patternStrength > 0}
                  onChange={setFinish}
                />
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
                        setPresetId("custom");
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
                <h2>Backdrop</h2>
                <div className="patterns">
                  {BACKDROPS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="cs-btn"
                      aria-pressed={backdrop === entry.id}
                      onClick={() => setBackdrop(entry.id)}
                    >
                      {entry.name}
                    </button>
                  ))}
                </div>
                <p className="note" style={{ marginTop: 8 }}>
                  Counter-Strike's own skies, softened so they sit behind the
                  knife instead of competing with it.
                </p>
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
