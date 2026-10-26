# Bannerfall: asset sources

*Vetted 2026-10-26 from the sandbox. Raw evidence (every URL, status and quoted license line): `/home/user/Brainstorm/research/2026-10-26/asset-list-vetting.md`. Not legal advice.*

## Style and rules

- **Our look:** stylized low-poly 3D, KayKit-like (chunky proportions, simple atlas or flat textures). Anything 2D pixel is out of style. Photoreal scans need restyling.
- **License rules:**
  - CC0 preferred.
  - CC BY is fine when attribution goes in the README "Credits and licenses" section.
  - No non-commercial (NC) art.
  - No GPL or share-alike art (CC BY-SA, GPL), since it would force our art under those terms.
  - Quaternius QAL packs can ship inside the game. Never publish the raw files as a standalone pack, for example in a public asset repo.
- **Fit:** Good / Partial / Poor for our 3D look. **(unverified)** means not checked.

## Source table

| Source | What it offers | License (as verified) | Attribution? | 2D / 3D | Fit | Verified? |
|---|---|---|---|---|---|---|
| KayKit Adventurers (`kaylousberg.itch.io/kaykit-adventurers`) | 5 rigged characters, weapons, animations | CC0 (pack `LICENSE.txt`) | No | 3D | Good | Yes |
| KayKit Dungeon Remastered (`kaylousberg.itch.io/kaykit-dungeon`) | About 200 modular dungeon pieces | CC0 (itch page) | No | 3D | Good | Yes |
| KayKit Godot asset library listing | Same author's packs | (unverified) | n/a | 3D | Good | No |
| Quaternius (`quaternius.com`) | Characters, monsters, props | Site: **QAL v1.0** (no credit; no redistribution as packs). Most pack pages: **CC0** | No | 3D | Good | Yes, licenses. No programmatic download |
| Kenney 3D kits (Nature, Fantasy Town 2.0, Mini Dungeon, Blocky Characters, Mini Characters) | Props, town and dungeon pieces, characters | CC0 | No | 3D | Good (props); Partial (characters) | Yes, pages and zip sizes. Models not opened |
| Kenney 2D packs (Tiny Town, RPG Base, Roguelike/RPG, 1-Bit) | Pixel sprites, 16x16 | CC0 | No | 2D | Poor | Yes |
| Kenney UI Pack (`kenney.nl/assets/ui-pack`) | 430 flat 2D UI files | CC0 | No | 2D | Partial | Yes |
| Kenney Interface Sounds / Music Jingles | UI sounds, stingers | CC0 | No | Audio | Good | Yes |
| Poly Haven (`polyhaven.com`) | PBR textures, HDRIs, models | CC0 ("CC0 means absolute freedom") | No | Textures | Good (ground) | Yes |
| ambientCG (`ambientcg.com`) | PBR material scans | CC0 (FAQ) | No | Textures | Partial (photoreal) | Yes |
| game-icons.net | 4,229 SVG icons, 37 contributors | **CC BY 3.0**, with some contributors **CC0** | Yes, "Icons made by {author}" for CC BY | 2D | Good | Yes (per-contributor check needed) |
| Sonniss GDC bundle | SFX library | Royalty-free: commercial use, no attribution, **no redistribution as sound effects** | No | Audio | Good | Partial. License via WebFetch summary, not verbatim. Size unverified |
| Poly Pizza (`poly.pizza`) | Low-poly models | Per model; CC BY 3.0 common (secondary) | Per model | 3D | Partial | **No** (403) |
| bfxr / jfxr | SFX generators | (unverified) | n/a | Tool | Good as tools | No license found |
| jsfxr | SFX generator | Unlicense (TMHSDigital catalog) | No | Tool | Good | Secondary only |
| OpenGameArt LPC | 2D pixel characters and tiles | CC BY-SA 3.0 **and** GPLv3 | Yes; share-alike | 2D | Poor | Yes |
| Pixel Frog Tiny Swords | 2D pixel, 64 px | Custom: "You may not redistribute, resell, or..."; older version CC0 | Not required | 2D | Poor | Yes |
| pixel-boy Ninja Adventure | 2D top-down pixel | CC0 | No | 2D | Poor | Yes |
| 0x72 DungeonTileset II | 2D 16x16 pixel | CC0 | No | 2D | Poor | Yes |
| ansimuz Sunny Land | 2D pixel | Art CC0 (OGA listings, secondary); bundled music CC BY | Music only | 2D | Poor | No (itch URL 404) |
| OpenGameArt tiny-16-basic | 2D tiles | CC BY 4.0, CC BY 3.0, OGA-BY 3.0 (mixed) | Yes | 2D | Poor | Yes |
| LDtk | 2D level editor | MIT | n/a | Tool | Good (optional) | Yes |
| Tiled | Map editor | GPLv2 (the tool; maps made with it are not covered, general reading) | n/a | Tool | Good as a tool | Yes |
| Pixelorama | Pixel editor | MIT | n/a | 2D tool | Poor for 3D art | Yes |
| rot.js | Roguelike, FOV, dungeon code | BSD-3-Clause (npm metadata) | Keep notice | Code | Good if needed | Partial |
| RPGAtlas | HD-2D RPG engine | **GPLv3 or later** | n/a | Code | Ideas only | Yes |
| TMHSDigital catalog | Index of CC0 sources | CC0 metadata; per-item licenses apply | n/a | Index | Pointer only | Secondary |

## Recommended now

### More characters and monsters

- **Quaternius Ultimate Monsters** (CC0 per page, 50 models): https://quaternius.com/packs/ultimatemonsters.html. Page lists FBX only, so convert to GLB before use.
- **Quaternius RPG Characters** (CC0 per page, 6 animated models; page lists FBX, OBJ, Blend, glTF): https://quaternius.com/packs/rpgcharacters.html
- **Quaternius Knight Character** (CC0, 10 models): https://quaternius.com/packs/knightcharacter.html
- **Quaternius Cute Monsters** (CC0, 21 models): https://quaternius.com/packs/cutemonsters.html. Check style against KayKit first.
- **Kenney Mini Characters** (CC0, 25 files, 2.4 MB zip): https://kenney.nl/assets/mini-characters. Partial fit, blocky style.
- Already in use: KayKit Skeletons (CC0), the repo `KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0@main`.

Quaternius packs are not reachable by script. Download them by hand from the pack pages.

### Ground textures (Poly Haven, CC0, 1k diffuse JPG)

- Grass path: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/grass_path_2/grass_path_2_diff_1k.jpg
- Dirt: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dirt_floor/dirt_floor_diff_1k.jpg
- Cobblestone: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cobblestone_floor_08/cobblestone_floor_08_diff_1k.jpg

### Ground textures (ambientCG, CC0, 1K-JPG zips; use the color map only)

- https://ambientcg.com/get?file=Grass005_1K-JPG.zip (grass, about 10.4 MB)
- https://ambientcg.com/get?file=PavingStones141_1K-JPG.zip (cobblestone, about 9.2 MB)
- https://ambientcg.com/get?file=Ground110_1K-JPG.zip (dirt, about 10.4 MB)

These are photoscans. Desaturate or posterize them for a stylized look.

### Props and set dressing (optional, same style)

- Kenney Fantasy Town Kit 2.0 (CC0, 3.9 MB zip): https://kenney.nl/assets/fantasy-town-kit
- Kenney Nature Kit (CC0, 10.5 MB zip): https://kenney.nl/assets/nature-kit
- Kenney Mini Dungeon (CC0, 1.8 MB zip): https://kenney.nl/assets/mini-dungeon

### Icons (game-icons.net, CC BY 3.0 unless a contributor is CC0)

- Index: `https://data.jsdelivr.com/v1/packages/gh/game-icons/icons@master?structure=flat`
- File: `https://cdn.jsdelivr.net/gh/game-icons/icons@master/<contributor>/<icon>.svg`
- Check the contributor in `license.txt` before use. For CC BY folders, add "Icons made by {author}" to README credits.

### UI

- Kenney UI Pack (CC0, 430 files, 2D flat): https://kenney.nl/assets/ui-pack. Partial fit, use for HUD panels and buttons.

### Audio and music

- Kenney Interface Sounds (CC0): https://kenney.nl/assets/interface-sounds
- Kenney Music Jingles (CC0): https://kenney.nl/assets/music-jingles
- Sonniss GDC bundle: use in shipped games, but do not redistribute the files as sound effects. The site (`sonniss.com/gameaudiogdc`) is not reachable from the sandbox, so download it manually.
- SFX generation: jsfxr is listed as Unlicense in the catalog (secondary). bfxr and jfxr licenses are not verified.
- Music: no verified CC0 music loop pack yet. Procedural music is a route (see RPGAtlas ideas below).

### Tools

- LDtk (MIT) and Tiled (GPLv2, tool only) for level layout. Pixelorama is 2D only.

## Not suitable

- **2D pixel packs (Kenney Tiny Town, RPG Base, Roguelike/RPG, 1-Bit; Pixel Frog Tiny Swords; pixel-boy Ninja Adventure; 0x72; ansimuz Sunny Land; tiny-16-basic):** pixel-art style clashes with the 3D look. Tiny Swords has a custom no-redistribution license.
- **OpenGameArt LPC:** CC BY-SA 3.0 and GPLv3 (share-alike). It would bind our art to those terms. Also 2D.
- **OpenGameArt tiny-16-basic:** mixed CC BY and OGA-BY, attribution per item, and 2D.
- **Poly Pizza:** not verifiable from the sandbox. Use only individual models, each checked on its own page, and credit each CC BY model.
- **Sonniss as a sound library:** fine inside a game, not for redistribution as sound effects.
- **RPGAtlas code:** GPLv3. Do not copy into our MIT code. Use the ideas only.
- **Quaternius QAL packs as a standalone download or repo:** not allowed. Shipping inside the game is fine.
- **Aggregators (OpenGameArt, catalogs):** licenses vary per item. Check each item.

## Ideas from RPGAtlas

[RPGAtlas](https://github.com/DriftwoodGaming/RPGAtlas) is an open-source HD-2D RPG maker. Its code is **GPLv3 or later**. Bannerfall is MIT, so use these as concepts and reimplement them from scratch.

- **HD-2D post stack per map:** opt-in bloom, depth of field, distance fog, and point lights placed from map events (`light #rrggbb radius`). Its renderer lives in `src/renderer/` and uses three.js, which we already use.
- **Procedural SFX and music in the browser:** RPGAtlas generates chiptune SFX and music with `js/sfx.js`. A small WebAudio synth could cover UI and combat sounds without any licensing.
- **Multiplayer safety defaults (if we ever go online):** no accounts, room codes, free-text chat off by default, mute, report, and owner kick or ban. Players connect to a server, never directly to each other.

## Open items

- Confirm the Quaternius per-pack license line on each pack page before download (QAL vs CC0).
- Check Kenney 3D kit model formats (FBX or GLB) and polygon counts.
- Check the Sonniss bundle size and contents.
- Confirm the KayKit Godot library listing.
- Find a working ansimuz Sunny Land URL if we ever need its art.
- Add game-icons attributions and any CC BY items to the README "Credits and licenses" section.
