import { ORIGINAL_FINISH, type Finish, type FinishMode } from "../mdl/finish";

const STOP_LABELS = ["Shadow", "Mid", "Light", "Peak"];

const MODES: Array<{ id: FinishMode; label: string; hint: string }> = [
  { id: "original", label: "As it came", hint: "Leave this part exactly as the model has it." },
  { id: "tint", label: "Colour", hint: "Keeps the material's shading and changes its colour." },
  { id: "ramp", label: "Gradient", hint: "Maps shadow to highlight across several colours." },
];

interface Props {
  finish: Finish;
  /** Whether a pattern is active, which is what the second colour is for. */
  patterned: boolean;
  onChange: (finish: Finish) => void;
}

/**
 * Controls for one part of the knife.
 *
 * "Colour" is the mode that behaves like a real skin: it replaces hue and
 * saturation while carrying the original brightness through untouched, so
 * bevels, rivets, engraving and baked shading all survive. Strength below full
 * lets the material underneath show, which is the difference between a
 * repaint and a wash.
 */
export function FinishEditor({ finish, patterned, onChange }: Props) {
  const set = (patch: Partial<Finish>) => onChange({ ...finish, ...patch });

  return (
    <div className="finish">
      <div className="modes">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className="cs-btn"
            aria-pressed={finish.mode === mode.id}
            title={mode.hint}
            onClick={() => set({ mode: mode.id })}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {finish.mode === "original" && (
        <p className="note">This part keeps the colours the model shipped with.</p>
      )}

      {finish.mode === "tint" && (
        <>
          <div className="swatches">
            <label className="stop">
              <span>Colour</span>
              <input
                type="color"
                value={finish.color}
                onChange={(event) => set({ color: event.target.value })}
              />
            </label>
            {patterned && (
              <label className="stop">
                <span>Second</span>
                <input
                  type="color"
                  value={finish.color2 ?? ORIGINAL_FINISH.color}
                  onChange={(event) => set({ color2: event.target.value })}
                />
              </label>
            )}
          </div>

          <div className="field">
            <span className="label">
              Strength <b>{finish.strength.toFixed(2)}</b>
            </span>
            <div className="cs-slider">
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={finish.strength}
                onChange={(event) => set({ strength: Number(event.target.value) })}
              />
            </div>
          </div>
        </>
      )}

      {finish.mode === "ramp" && (
        <>
          <div
            className="ramp inset"
            style={{ background: `linear-gradient(90deg, ${finish.ramp.join(",")})` }}
          />
          <div className="stops">
            {finish.ramp.map((color, index) => (
              <label key={STOP_LABELS[index] ?? index} className="stop">
                <span>{STOP_LABELS[index] ?? index}</span>
                <input
                  type="color"
                  value={color}
                  onChange={(event) =>
                    set({
                      ramp: finish.ramp.map((entry, i) =>
                        i === index ? event.target.value : entry,
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </>
      )}

      {finish.mode !== "original" && (
        <div className="field">
          <span className="label">
            Brightness <b>{finish.brightness.toFixed(2)}</b>
          </span>
          <div className="cs-slider">
            <input
              type="range"
              min={-0.4}
              max={0.4}
              step={0.02}
              value={finish.brightness}
              onChange={(event) => set({ brightness: Number(event.target.value) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
