# Preset sources and credits

Every knife model in this repository was made by someone in the CS 1.6 modding community. None of
it is our work. FakaLab is a tool that recolors these models; it does not claim authorship of any
of them.

This file records where each model came from and who is credited for it, as accurately as we can.
Where a credit is incomplete, it is marked as such — corrections are welcome and will be applied.

## Removal requests

If you are the author of any model here and want it removed, open an issue or contact the
maintainer and it will be removed. No justification needed, no argument.

## What we changed

Nothing about the models themselves. Folder names were normalized to lowercase-kebab-case so they
work as URL slugs (`Karambit Knife/` → `karambit-knife/`), and packs were reorganized into the
layout below. The `.mdl` files are byte-for-byte as downloaded.

---

## `csgo-knives-pack/` — the preset library

**CS:GO Idle-Inspect Knives Pack [Low-Poly]** — <https://gamebanana.com/mods/375288>

21 CS:GO-style knives rigged to the community-standard default hand skeleton, with matching
inspect, draw and hit sounds. This is the library FakaLab ships.

Several of the knife textures in this pack are signed `Zshiryu777.bmp`, which we take to be the
texture author's handle. Full author credits are on the mod page linked above; please refer to it
rather than to this summary.

The knife designs themselves originate from Counter-Strike: Global Offensive (Valve) and were
ported to GoldSrc by the community.

Knives included: bayonet, bowie, butterfly, classic, counter-terrorist, falchion, flip, gut,
huntsman, karambit, m9-bayonet, navaja, nomad, paracord, shadow-daggers, skeleton, stiletto,
survival, talon, terrorist, ursus.

## `reference-hands/`

A Talon Knife port on the same default-hands rig, used as the reference skeleton when checking
whether a candidate model is compatible with the library.

**Author not recorded.** This file was already on the maintainer's machine when the project
started and its origin was not tracked. If you recognize it, please let us know so it can be
credited properly.

## `_later/valorant-knifes/` — set aside, not shipped

**Valorant Knifes [CSGO M9 Bayonet Anims]** — <https://gamebanana.com/mods/221503>

Four Valorant-inspired knives. The mod page credits Valve for the original hand model plus a
community rigger. Kept in the repository but not part of the preset library: these models are
already heavily skinned (a black blade with neon accents, a gold dragon, a red gem inlay), which
makes them poor starting points for recoloring.

The knife designs originate from Valorant (Riot Games) and were ported to GoldSrc by the
community.

---

## Not in this repository

Valve's own stock CS 1.6 knife models are kept locally by the maintainer for reference only and
are deliberately excluded from version control. They are Valve's game files, not community content,
and are not redistributed here.
