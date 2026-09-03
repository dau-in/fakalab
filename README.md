# FakaLab

Customize Counter-Strike 1.6 knife viewmodels in your browser. Pick a knife, recolor it in a live
3D preview, and download a ready-to-use `v_knife.mdl`.

Built for the CS 1.6 community, which is somehow still going strong.

## Everything runs in your browser

There is no upload, no backend, and no server-side file processing. All `.mdl` parsing and editing
happens locally in your browser — your files never leave your machine.

## How the recoloring works

A GoldSrc `.mdl` stores a model's appearance as an 8-bit indexed bitmap plus a 256-color palette.
FakaLab recolors a knife by rewriting that 768-byte palette **in place**: the file size never
changes and no internal offset moves, so the result is exactly as loadable as the original file.

Color is applied as a *ramp* — a gradient from shadow to highlight — mapped onto each pixel's
original brightness. Shading, wear and engraving detail from the source texture are preserved, and
the result stays physically coherent because the color always follows the model's own lighting.

## Status

Early development. The `.mdl` parser and the recoloring technique are validated against the full
preset library and confirmed in-game; the web application itself is not built yet.

## Knife presets

FakaLab ships a curated library of knife models made by the CS 1.6 modding community. They are not
our work, and we make no ownership claim over them. See [PRESETS.md](PRESETS.md) for sources,
credits, and removal requests.

## License

The **source code** of this tool is licensed under [AGPL-3.0](LICENSE).

The **knife models** under `presets-source/` are community-created content and are **not** covered
by that license. They remain subject to whatever terms their original authors set. See
[PRESETS.md](PRESETS.md).
