# Frontline: design

*2026-10-26. Frontline is Bannerfall's main mode: one lane, Stick-War-style, played 2v2 with friends (bots fill empty seats).*

## The pitch

Stick War's loop (mine gold → train an army → push the lane → smash the statue) with four changes:

1. **Co-op economies.** Every player has their own gold, miners, buildings, army and population. Teammates share only the keep they defend, so splitting roles matters. One player can greed a big economy while the other holds the line; one can rush Giants while the other runs an archer and mage backline.
2. **You are on the battlefield.** Each player directly controls one of the 20 heroes (WASD and abilities), fighting with their own army. Heroes level up from nearby kills. Their abilities deal 60% damage to army units, so the army stays the main force.
3. **Bases you build.** The keep has 7 building plots per player. What you build decides what you can train: Barracks, Archery Range, Arcane Sanctum, Giant Pit. It also decides your economy (Houses, Mine Shaft, Market), upgrades (Forge) and defense (Watchtowers).
4. **Flags pay.** Three banners stand on the lane: the Dawn Outpost, the Heart Banner in the middle, and the Dusk Outpost. Holding one pays every teammate gold each second; the Heart pays double. Capturing one pays a lump sum. This is the original brief's "each flag taken gives money".

## Economy

| Source | Amount |
|---|---|
| Passive | 3 gold/s per player |
| Miner trip | 15 gold (+40% with a Mine Shaft); rich middle veins +60% |
| Market | 400 gold, +2 gold/s each (max 2) |
| Banners held | +1.5 gold/s per outpost, +3 gold/s for the Heart, per player |
| Banner capture | 150 to every player on the capturing team |
| Kills | 20% of a unit's cost to its killer's owner; 200 for a hero, scaled by victim level ÷ killer level (0.5× to 1.5×) |
| Underdog bounty | ×1.5 on all kill gold while your team's army is worth less than 70% of the enemy's |
| Sudden Death | from 12:00, +1 gold/s per player, and +1 more every minute |

Each side has 4 safe veins near its keep (4 miners each, shared by teammates) and 2 rich contested veins near the middle. **Rich veins unload at the nearest banner your team holds** (a forward depot), so holding the Dawn/Dusk Outpost or the Heart makes the middle worth mining. Miners pick the free vein with the best gold per second for the round trip, with a risk detour counted for rich veins. When soldiers or heroes come close, miners flee to the keep and return once it's safe.

## Units

| Unit | Cost | Pop | Trained at | Role |
|---|---|---|---|---|
| Miner | 150 | 1 | Keep | Economy |
| Swordsman | 125 | 1 | Keep | Cheap melee |
| Archer | 225 | 1 | Archery Range | Ranged DPS, +50% damage against Giants |
| Shieldbearer | 450 | 2 | Barracks | Tank |
| Assassin | 275 | 1 | Barracks | Dives archers and mages |
| Battlemage | 500 | 2 | Arcane Sanctum | Splash fireballs |
| Healer | 350 | 1 | Arcane Sanctum | Heals units and heroes |
| Giant | 1500 | 4 | Giant Pit | Huge splash bruiser |

Population starts at 16; each House adds 10 (max 3 Houses, cap 40), so a full army costs 3 of your 7 plots. The Forge researches weapons (+15% damage and +10% healing per level) and armor (+8 per level), 3 levels each.

Units ignore enemy buildings they can't hit from the lane (melee can't climb to the build plots), and a destroyed trainer refunds its training queue.

## Stances (per player, for their own army)

- **Garrison:** everyone, miners included, hides inside the keep. Each garrisoned unit makes the keep shoot 12% faster, and garrisoned units heal.
- **Defend:** a formation line in front of your base.
- **Hold line:** a formation at your rally point (set with C over the battlefield).
- **Follow:** the army forms up 3 units behind your hero and fights wherever you lead it. Falls back to Defend while your hero is dead.
- **Attack:** march on the enemy keep and fight everything on the way.

Formations put heavies and melee in front, then archers, then mages, then healers, spread across the lane.

## Sudden Death

At 12:00 both keeps start to crumble (15 true damage per second, no regeneration) and lose 5 armour every 30 s, and income ramps (see Economy). The keep that took more siege damage falls first, and no match outlasts about 20 minutes. Garrisoned units add keep firepower only up to 12 units (+144%).

## How it maps to the code

- Data: `src/shared/frontline/data.ts` (units, buildings, research, map features, stances).
- Systems: `src/shared/frontline/sim.ts` (economy, training queues, construction, stances and formations, miners, healers, banners, garrison). It plugs into the shared `Game`, so heroes, abilities, effects, projectiles, replays and the server all work unchanged.
- Bots: `src/shared/frontline/bot.ts` (three build personalities; stances follow relative army value).
- Rendering: `src/client/render/frontline.ts` (side-view lane, veins, plots, banners) plus `World`'s side camera, construction scaffolding, carried gold sacks and bloom.

## Measuring balance

`npx tsx tools/frontline-balance.ts [seeds] [capMinutes] [--md]` plays seeded 2v2 bot matches and prints match length, unfinished matches, win rate per bot build plan and gold by source. Results are in `docs/FRONTLINE-BALANCE.md`.

## Next ideas

- **Unit control like Stick War**: switch your direct control from the hero to any of your soldiers.
- **Spells for gold**: a castle-cast arrow volley, a healing rain.
- **Unit abilities**: Shieldbearer shield wall, Archer fire arrows, Giant boulder throw. These can be researched at their building and use the existing Effect engine.
- **Siege**: a catapult unit and wall segments you can buy.
- **3v3 and 4v4**: more plots per keep.
- **Campaign / co-op vs AI waves**: a Horde mode on the same lane.
