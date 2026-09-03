import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KNIVES, modelUrl } from "./data/knives";
import { DEFAULT_PRESET, PRESETS, toStops } from "./data/presets";
import { knifeTextures, parseMdl, soundEvents, type MdlFile } from "./mdl/parse";
import {
  buildRecoloredFile,
  measureBrightness,
  recolorTextures,
  type Adjust,
} from "./mdl/recolor";
import { decodeToRgba, readPalette, readPixels } from "./mdl/texture";
import { TexturePreview } from "./ui/TexturePreview";

const STOP_LABELS = ["Shadow", "Mid", "Light", "Highlight"];

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} B`;
}

export default function App() {
  const [slug, setSlug] = useState(KNIVES[9].slug); // Karambit
  const [model, setModel] = useState<MdlFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [colors, setColors] = useState<string[]>([...DEFAULT_PRESET.colors]);
  const [adjust, setAdjust] = useState<Adjust>({ brightness: 0, contrast: 0 });

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
        if (cancelled) return;
        setModel(parseMdl(buffer));
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

  /** Original and recolored pixels for the first knife texture. */
  const preview = useMemo(() => {
    if (!model || targets.length === 0 || recolored.length === 0) return null;
    const texture = targets[0];
    const pixels = readPixels(model, texture);
    const original = readPalette(model, texture);
    return {
      texture,
      range: measureBrightness(original, pixels),
      before: decodeToRgba(pixels, original),
      after: decodeToRgba(pixels, recolored[0].palette),
    };
  }, [model, targets, recolored]);

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

  const sounds = useMemo(() => (model ? soundEvents(model) : []), [model]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">
          Faka<b>Lab</b>
        </span>
        <span className="stage-note">stage 2 — recoloring engine, flat preview</span>
      </header>

      <div className="body">
        <nav className="rail" aria-label="Knives">
          {KNIVES.map((knife) => (
            <button
              type="button"
              key={knife.slug}
              className="knife"
              aria-pressed={knife.slug === slug}
              onClick={() => setSlug(knife.slug)}
            >
              {knife.name}
            </button>
          ))}
        </nav>

        <main className="stage">
          {loading && <p className="status">Loading {slug}…</p>}
          {error && <p className="status error">{error}</p>}

          {preview && !loading && !error && (
            <>
              <div className="pair">
                <figure>
                  <figcaption>Original</figcaption>
                  <TexturePreview
                    width={preview.texture.width}
                    height={preview.texture.height}
                    rgba={preview.before}
                  />
                </figure>
                <figure>
                  <figcaption>Recolored</figcaption>
                  <TexturePreview
                    width={preview.texture.width}
                    height={preview.texture.height}
                    rgba={preview.after}
                  />
                </figure>
              </div>

              <dl className="facts">
                <div>
                  <dt>Texture</dt>
                  <dd>
                    {preview.texture.name} · {preview.texture.width}×{preview.texture.height}
                  </dd>
                </div>
                <div>
                  <dt>Brightness band</dt>
                  <dd>
                    {preview.range.low.toFixed(2)} – {preview.range.high.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt>File</dt>
                  <dd>{model ? formatBytes(model.header.length) : "—"}</dd>
                </div>
                <div>
                  <dt>Rewritten</dt>
                  <dd>{formatBytes(recolored.length * 768)}</dd>
                </div>
                <div>
                  <dt>Bones</dt>
                  <dd>{model?.header.numBones}</dd>
                </div>
                <div>
                  <dt>Sounds</dt>
                  <dd>{sounds.length}</dd>
                </div>
              </dl>
            </>
          )}
        </main>

        <aside className="panel">
          <section>
            <h2>Presets</h2>
            <div className="presets">
              {PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  className="preset"
                  aria-pressed={preset.id === presetId}
                  onClick={() => applyPreset(preset.id)}
                >
                  <span
                    className="swatch"
                    style={{ background: `linear-gradient(135deg, ${preset.colors.join(",")})` }}
                  />
                  {preset.name}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>Ramp</h2>
            <div
              className="ramp"
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

          <section>
            <h2>Adjust</h2>
            <label className="slider">
              <span>
                Brightness <b>{adjust.brightness.toFixed(2)}</b>
              </span>
              <input
                type="range"
                min={-0.5}
                max={0.5}
                step={0.01}
                value={adjust.brightness}
                onChange={(event) =>
                  setAdjust((previous) => ({ ...previous, brightness: +event.target.value }))
                }
              />
            </label>
            <label className="slider">
              <span>
                Contrast <b>{adjust.contrast.toFixed(2)}</b>
              </span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.02}
                value={adjust.contrast}
                onChange={(event) =>
                  setAdjust((previous) => ({ ...previous, contrast: +event.target.value }))
                }
              />
            </label>
          </section>

          <button type="button" className="download" onClick={download} disabled={!preview}>
            Download v_knife.mdl
          </button>
        </aside>
      </div>
    </div>
  );
}
