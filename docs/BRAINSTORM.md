# Bannerfall brainstorm: gaps, bigger ideas, roadmap

*2026-10-26. Written while building v0.1. Items marked ✅ are already in the game.*

## 1. The brief and how I read it

> A 2.5D game to play with friends online. 20 heroes, each with attributes, story and abilities. A wave of monsters automatically spawned by your base. Each team has a fortress with a few different flags. Each flag taken, or kill, gives the team more money. Money upgrades your base and buys equipment.

That reads as a **MOBA with a tower-defense spine**: heroes fight, the bases run themselves (monster waves), and gold is the bridge between personal power (items) and base power (upgrades, towers). Bannerfall keeps that shape and adds what the brief leaves open.

### About AtlasRPG and Lumia

- **Lumia** I read as *Lumia Island* from *Eternal Return* (Nimble Neuron). Its art is proprietary, so it can't be used. Mechanics are not copyrightable, and three of them carried over well:
  - ✅ a **day/night cycle** that changes vision and risk;
  - ✅ **wildlife-style neutral camps** worth hunting for gold and buffs;
  - ✅ **item recipes** that combine components into legendaries.

  Two more are on the roadmap: Lumia's **restricted zones** (a shrinking-map mode) and **hyperloop fast travel** (banner teleports).
- **AtlasRPG**: I couldn't confirm which game this is, so I didn't borrow from it. Send a link and I'll mine it the same way.
- **Assets** are the **KayKit** packs by Kay Lousberg (**CC0**): rigged, animated characters that all share one rig and its 76–95 clips, plus castles, towers, flags and nature. Nothing needed to be generated. The verified source list now lives in the Brainstorm repo (`reference/free-3d-asset-sources.md`).

## 2. Gaps in the brief, and what fills them

| Gap | Why it matters | What Bannerfall does |
|---|---|---|
| **No win condition** | Without one, flags and money have no stakes | ✅ Destroy the enemy **Fortress Core**. It is immune while its three banners fly, takes 35% damage with 2, 60% with 1 and 100% with none |
| **How is a flag "taken"?** | Capture rules decide the whole pace | ✅ Stand in the circle uncontested for 6s (faster with allies). Defenders can recapture. Banners unlock in order: outer tower → lane banner → Keep |
| **"A few different flags"**: different how? | Identical flags are just HP bars | ✅ **War Banner** (+20% to your waves), **Coin Banner** (+2 gold/s per hero), **Keep Banner** (reveals the enemy base). Each banner you hold also pays a trickle of gold |
| **Kill money snowballs** | The losing team gets poorer and the game is decided in minute 8 | ✅ Kill streaks raise the victim's bounty (shutdown gold). ✅ **Last Stand**: the first time a fortress drops below 30% it gains a big shield, revives the dead and rallies its heroes. Underdog banner bonus is still to do |
| **Monster waves are passive** | The base "plays itself", so there are no decisions | ✅ **Bone Forge** upgrades change the size and makeup of waves. ✅ Hire **mercenary Bone Brutes** for one lane. To do: *Forge Directives* (choose each lane's wave type) |
| **Base money sink** | Without one, gold only buys items | ✅ Six team-wide upgrades: Forge, Tower Armory, Fortress Bulwark, War Treasury, Rally Horn, Watchfires. ✅ **Tower-defense pads**: Arrow, Frost (slow), Cannon (splash) and Arcane (chain, anti-hero) towers, each up to level 3. Personal items and shared upgrades compete for the same gold |
| **Friends rarely make full teams** | 2 friends online can't play 5v5 | ✅ **Bots** fill empty seats, play lanes, shop, defend banners and buy upgrades. ✅ Offline practice. ✅ A dropped player is taken over by a bot and can rejoin within 60s |
| **Hosting** | "Online" needs a server someone can run | ✅ A single Node process serves the game and the WebSocket. Shareable `?room=CODE` links. Deploy notes in the README |
| **20 heroes is a lot to learn** | New players bounce off | ✅ Hero Codex, role filters, difficulty tags, ability tooltips, How to Play. To do: recommended builds per hero and a guided tutorial match |
| **Information** | Every MOBA lives on scouting | ✅ Server-side **fog of war** (enemies outside your vision are never sent, so map hacks are impossible). ✅ Night shrinks vision. ✅ Pings. To do: wards and stealth-reveal items |
| **Cheating** | It's online | ✅ Authoritative server. Clients only send intents. Fog is filtered on the server |
| **Match length** | Friends' sessions are short | ✅ Measured: bot matches end in 17–30 min. Tune with fortress HP and banner multipliers |
| **Sound** | Half of game feel | ❌ None yet. See the roadmap (CC0 audio exists) |
| **Accessibility** | Colorblind players can't tell red from blue | ❌ To do: shapes on banners and rings, key rebinding, UI scale |

## 3. Ideas to make it more ambitious, fun and strategic

Ranked by **fun ÷ effort** (S/M/L effort).

### Tier 1: cheap, big payoff
1. **Replays for free** (S). The simulation is deterministic (seeded RNG, fixed 20 Hz tick), so a match is just `seed + roster + command log`. Save that (a few KB), then add watch mode, killcam and "share this fight".
2. **Hero talents at levels 5 and 10** (M). Pick 1 of 2 perks per hero, defined as data (`PassiveDef` already covers it). Same hero, different builds, more depth.
3. **Forward respawn** (S). Respawn at any enemy banner you hold, which makes banners worth defending even after the gold.
4. **Forge Directives** (S). Per lane, choose *Swarm* (more, weaker), *Phalanx* (shields, slow) or *Siege* (brutes, tower bonus). It's the RTS layer the brief hints at.
5. **Recommended builds + ability-order tips** in the Codex (S). Bots already have role builds; show them to players.
6. **Emote/ping wheel** and **quick chat** (S). Most of the fun with friends is banter.

### Tier 2: signature features
7. **Siege Engine payload** (M). After the Keep falls, a catapult spawns at the attacker's forge and must be escorted. It deals huge fortress damage. This creates a moving objective to fight over.
8. **Co-op Horde mode** (M). Everyone versus escalating Forge waves, defending one fortress with heroes and towers: pure tower defense with heroes. It's the best mode when friends are new and don't want PvP.
9. **Mazing barricades** (M). Cheap walls on a grid near your base that monster waves must path around. Real tower-defense mazing; the A* nav grid already supports it.
10. **World events** (M):
    - **Blood Moon**: some nights all camps are elite.
    - **Gilded Wraith**: a wandering treasure monster that flees.
    - **Bone Storm**: a moving hazard that sweeps the jungle.

    Lumia-flavoured unpredictability.
11. **Duo synergies** (S/M). Lore pairs grant small buffs when on the same team: Aldric + Seraphine (siblings), Hallen + Aldric (mentor). The lore pays off mechanically.
12. **Draft with bans** (M). Captains pick and ban in turn. Adds strategy before the match even starts.

### Tier 3: long-term
13. **Accounts, hero mastery, cosmetic tints** (L). Persistence needs a DB. Cosmetics are cheap because tinting is already data.
14. **Spectator / caster mode** (M). Free once replays exist.
15. **Mobile twin-stick controls** (M). The UI is HTML, so touch is doable.
16. **Map variants** (M):
    - 3-lane 5v5;
    - "Bridge of Bones", a 1-lane ARAM;
    - a shrinking-map battle royale using Lumia-style restricted zones.
17. **Generated art pass** (S, needs the image API key). Splash art, ability icons and loading screens through the Brainstorm repo's source-image workflow, with a locked style block and per-hero subject blocks matched to the KayKit look.

## 4. Assets: what's needed next

- **Images.** Ability icons are emoji today and portraits are rendered from the 3D models (always consistent). With an image API key (Meta Muse), the next steps are:
  - 20 splash illustrations;
  - 80 ability icons (one prompt template; style block below);
  - 35 item icons;
  - a menu background and a loading screen.

  Suggested locked style block: *"stylized low-poly fantasy, chunky proportions, soft rim light, flat pastel shading, KayKit-like, clean silhouette, plain dark background, centered"*.
- **3D.** Covered by CC0 KayKit. Extra packs verified for later: Dungeon Remastered (fortress interiors), Halloween Bits (graveyard camps), Prototype Bits.
- **Audio.** Candidates are Kenney's CC0 audio packs (UI, impacts, RPG) and OpenGameArt CC0 music. Neither has been verified in this sandbox yet.

## 5. Roadmap

| Version | Scope |
|---|---|
| **v0.1** (this) | Playable online and offline, 20 heroes, 35 items, bots, banners with perks, towers, waves, camps, boss, day/night, fog, Last Stand |
| v0.2 | Audio, talents, forward respawn, Forge Directives, recommended builds, balance pass from `docs/BALANCE-REPORT.md`, replays |
| v0.3 | Horde co-op mode, siege payload, world events, draft/bans, generated splash art and icons |
| v0.4 | Accounts and mastery, spectator, mobile controls, map variants |
