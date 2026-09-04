import { MATERIALS, materialOf } from "../data/materials";
import { patternById } from "../mdl/patterns";
import type { Finish } from "../mdl/finish";

const STOP_LABELS = ["Shadow", "Mid", "Light", "Peak"];

interface Props {
  finish: Finish;
  /** What this part is called, for the labels. */
  partName: string;
  onChange: (finish: Finish) => void;
}

/**
 * Everything about one part of the knife: what it is made of, and in what
 * colours.
 *
 * The order is the order of the decision. Pick the material first, because it
 * decides whether the rest is one colour, two, or a gradient; then the colours;
 * then how far it goes. Nothing here reaches the other part of the knife.
 */
export function FinishEditor({ finish, partName, onChange }: Props) {
  const set = (patch: Partial<Finish>) => onChange({ ...finish, ...patch });
  const current = materialOf(finish);
  const pattern = patternById(finish.patternId);
  const twoTone = finish.mode === "tint" && finish.patternId !== "none";

  return (
    <div className="finish">
      <h3>{partName} is made of</h3>
      <div className="materials">
        {MATERIALS.map((material) => (
          <button
            key={material.id}
            type="button"
            className="cs-btn"
            aria-pressed={current === material.id}
            onClick={() => onChange({ ...material.finish })}
          >
            {material.name}
          </button>
        ))}
      </div>

      {finish.mode === "original" && (
        <p className="note">Keeps the colours the model shipped with.</p>
      )}

      {finish.mode === "tint" && (
        <>
          <h3>Colour</h3>
          <div className="swatches">
            <label className="stop">
              <span>{twoTone ? "Main" : "Colour"}</span>
              <input
                type="color"
                value={finish.color}
                onChange={(event) => set({ color: event.target.value })}
              />
            </label>
            {twoTone && (
              <label className="stop">
                <span>Second</span>
                <input
                  type="color"
                  value={finish.color2}
                  onChange={(event) => set({ color2: event.target.value })}
                />
              </label>
            )}
          </div>
        </>
      )}

      {finish.mode === "ramp" && (
        <>
          <h3>Colour</h3>
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
        <>
          <h3>Amount</h3>
          {finish.patternId !== "none" && (
            <div className="field">
              <span className="label">
                {pattern.name} <b>{finish.patternStrength.toFixed(2)}</b>
              </span>
              <div className="cs-slider">
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={finish.patternStrength}
                  onChange={(event) => set({ patternStrength: Number(event.target.value) })}
                />
              </div>
            </div>
          )}

          {finish.mode === "tint" && (
            <div className="field">
              <span className="label">
                Coverage <b>{finish.strength.toFixed(2)}</b>
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
          )}

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

          <p className="note">
            Coverage below full lets the material underneath show through, which
            is the difference between a repaint and a wash.
          </p>
        </>
      )}
    </div>
  );
}
