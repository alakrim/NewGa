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

## Open problems

- **Attacks trickle.** In Attack, every newly trained unit walks the 160-unit lane alone and is picked off at the
  enemy base. A muster rule (reinforcements gather at the Heart until a group forms) should end more matches
  before Sudden Death.
- **Plan 2 is favoured** (61-69% across every run). Its mass ranged and Watchtower defence beat the other two
  plans.
- **No bot builds a Market**, so its price change is untested by bots.
