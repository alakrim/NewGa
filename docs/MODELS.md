# Character models

All characters are KayKit (Kay Lousberg, CC0). Each `.glb` shares one rig (bones include `handslot.r` / `handslot.l`)
and the same animation set, so every hero can use every `AnimName` in `src/shared/types.ts`.

`HeroVisual.weapons` lists the **optional** meshes to show. Every optional mesh not listed is hidden.
Body parts (head, arms, legs, body) are always shown. Skeletons have no built-in weapons: their weapons are separate
models attached to the hand slots by the renderer (names below).

| Model | Optional meshes (weapons, shields, headgear, capes) |
|---|---|
| `Knight` | `1H_Sword`, `1H_Sword_Offhand`, `2H_Sword`, `Badge_Shield`, `Rectangle_Shield`, `Round_Shield`, `Spike_Shield`, `Knight_Helmet`, `Knight_Cape` |
| `Barbarian` | `1H_Axe`, `1H_Axe_Offhand`, `2H_Axe`, `Barbarian_Round_Shield`, `Mug`, `Barbarian_Hat`, `Barbarian_Cape` |
| `Mage` | `1H_Wand`, `2H_Staff`, `Spellbook`, `Spellbook_open`, `Mage_Hat`, `Mage_Cape` |
| `Rogue` | `Knife`, `Knife_Offhand`, `1H_Crossbow`, `2H_Crossbow`, `Throwable`, `Rogue_Cape` |
| `Rogue_Hooded` | same as `Rogue` (hooded head) |
| `Skeleton_Warrior` | attachable: `Skeleton_Blade`, `Skeleton_Axe`, `Skeleton_Shield_Small_A`, `Skeleton_Shield_Large_A` (helmet + cloak built in) |
| `Skeleton_Mage` | attachable: `Skeleton_Staff`, `Skeleton_Blade` (hat built in) |
| `Skeleton_Rogue` | attachable: `Skeleton_Blade`, `Skeleton_Axe`, `Skeleton_Crossbow` (hood + cape built in) |
| `Skeleton_Minion` | attachable: `Skeleton_Blade`, `Skeleton_Axe`, `Skeleton_Shield_Small_A` (cloak built in) |

Right hand gets the first weapon listed, left hand the shield/offhand/book. `2H_*` weapons and crossbows use the right hand.

Monsters (lane minions, jungle camps, bosses) also use the skeleton models, tinted per team.
