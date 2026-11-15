# Frontline balance report

Date: 2026-11-10. Measured with `npx tsx tools/frontline-balance.ts 30 25`: 30 seeded 2v2 bot matches (seeds 1-30),
stopped at 25 minutes. Heroes rotate with the seed; each bot picks one of the three build plans in
`src/shared/frontline/bot.ts`. Deterministic per seed.

## Before and after

| | Before | After |
|---|---|---|
| Unfinished at 25 min | **12 / 30** | **0 / 30** |
| Finished within 20 min | 18 | 24 |
| Median length (finished) | 9.5 min | 16.7 min |
| 10th-90th percentile | 8.0-17.4 min | 7.6-20.3 min |
| Ended at 19 min or later (mostly decided by Sudden Death) | n/a | 9 |
| Team 0 wins (of finished) | 8 / 18 | 17 / 30 |
| Win rate, plan 0 (Archer + Shieldbearer + Sanctum) | 46% | 47% |
| Win rate, plan 1 (Giant Pit rush) | 42% | 46% |
| Win rate, plan 2 (Archer + Mage + Watchtower) | 65% | 61% |

Gold by source (after): mining 49%, rewards 22%, banners 16%, passive 13%, markets 0% (no bot plan builds one).

The median rises because matches that used to stall now end, most of them late.

## What changed

1. **Unreachable targets (the main stalemate cause).** Frontline keeps walkers inside the lane band (z ≥ −11),
   but build plots sit at z = −15 and −21. Melee units and bot heroes that picked a plot building as their
   target pushed against the edge forever, so a winning army stood still in the enemy base. `Game.inReach`
   now skips structures a unit can't hit from the lane. On its own this was not enough: a fully attacking army
   still lost to a keep plus heroes, because reinforcements cross the map one at a time.
2. **Sudden Death** from 12:00: both keeps take 15 true damage per second, stop regenerating and lose
   5 armour every 30 s, and passive income gains +1 gold/s each minute. The keep that took more siege damage
   falls first. Without the crumble, armour decay alone left most sieges unresolved.
3. **Garrison cap:** keep firepower stops growing past 12 garrisoned units (was uncapped: 30 units = 4.6×).
4. **Economy:** rich veins unload at the nearest held banner, and miners pick veins by gold per second.
   Pop 16 + 10 per House (max 3). Market 400 (was 500). Archer 225 (was 300), +50% damage against Giants.
   Bots train at most 8 miners each, which fills a team's 16 safe vein slots.
5. **Comeback:** ×1.5 kill gold while your army is worth under 70% of the enemy's. Hero kill gold is scaled by
   victim level ÷ killer level (0.5× to 1.5×).

## 2026-11-14: fountain rule, muster, bot plans

Measured with `npx tsx tools/frontline-balance.ts 30 25` (seeds 1-30) before and after; the 60-seed rows use
`--from=` over four processes (`tools/frontline-balance.ts N 25 --from=K`).

| | 2026-11-10 | 2026-11-14 | 
|---|---|---|
| Unfinished at 25 min | 0 / 30 | 0 / 30 |
| Finished within 20 min | 24 | 30 |
| Ended at 19 min or later (Sudden Death) | 9 | **0** |
| Ended before Sudden Death (< 12 min) | 13 | **29** |
| Median length | 15.3-16.7 min | 8.6 min |
| 10th-90th percentile | 7.6-20.3 min | 7.6-11.3 min |
| Plan 0 win rate | 47% | 42% (43% over 60 seeds) |
| Plan 1 win rate | 46% | 59% (59% over 60 seeds) |
| Plan 2 win rate | 61% | 48% (47% over 60 seeds) |

What changed and what it was worth (40 seeds unless noted):

1. **Fountain heals only out of combat (the real stall).** A defending hero standing in its keep's fountain healed
   8% of its health per second, about as fast as a ten-unit army could hurt it, so winning sieges ground to a halt
   in front of the keep (the 20.3 min finishes). In Frontline the fountain now stops healing for
   `FL.fountainCombatDelay` = 4 s after damage. Alone: >= 19 min 10 -> 2, before 12 min 24 -> 33.
2. **Attack muster.** Army units trained while the stance is Attack gather at `FL.musterX` = 14 on their own side
   of the Heart Banner and march together once `FL.musterGroup` = 5 are there, the team's front group is within
   30 of the muster point, or the first waiting unit has waited 40 s. Miners never muster; leaving Attack releases
   everyone. Before the fountain fix: before 12 min 21 -> 24 of 40, >= 19 min unchanged at 10. After it, with 60
   seeds, muster off versus on is the same (55 of 60 end before Sudden Death either way) because bot matches are
   now decided in the first ~9 minutes; it matters for human players who keep training during a push.
   (Group 8 was no better than 5: 23 vs 24 before 12 min.)
3. **Bot plans.** Plan 2 won 61-69% because the whole army was cheap and quick to field, and archer-heavy armies
   win rushes (a swordsman + archer only variant won 80%). Plans 0 and 1 spent more of their early gold on
   buildings (Forge, Giant Pit). Changes: plan 0 builds Houses earlier and a second Mage (`house, archery, house,
   barracks, sanctum, forge, house`); plan 1 gets an Archery Range second and archers beside the Giant (`house,
   archery, barracks, mineshaft, house, giantpit, house`); plan 2 drops the Mine Shaft for a Forge (`house,
   archery, sanctum, house, forge, watchtower, house`). The Watchtower itself changes nothing measurable: matches
   end before it matters. Sweep log (plan 0 / 1 / 2 win rate, 40 seeds): original 49/38/67; fewer Mages 51/36/67;
   no Watchtower 51/36/67; no Mine Shaft 53/38/62; plan 1 with a cheaper army 49/40/64; plan 1 with archers
   + plan 2 with a Forge 39/59/53; plus plan 0 with early Houses **44/57/49**; with the original plan 2 37/60/53.
   Final, 60 seeds: **43 / 59 / 47**.

Gold by source (30 seeds, after): passive 16%, banners 12%, markets 0%, mining 53%, rewards 19%.

Side effects to watch: matches now end in 7.5-11 min. Rushes with the first big archer/mage group decide most of
them, so the early game (opening build, first army) carries more weight than Sudden Death does. If that feels too
fast, try a shorter `FL.fountainCombatDelay` (2 s) or more keep health before touching the plans again.

## Open problems

- **Matches are short now** (median 8.6 min, p10 7.6): see side effects above. No `Ended >= 19 min` finishes are
  left, so the Sudden Death pressure is rarely felt by bots.
- **Archers are the strongest unit per gold** in early rushes (an archer-only bot plan won 80%). A price or damage
  nudge belongs to the owner's call; not changed.
- **No bot builds a Market**, so its price change is untested by bots.
