# Balance guide (content authors read this)

World units: a hero is ~2.4 units tall. The map is 220 x 130 units. Lanes are ~10 units wide.

## Hero base stats (level 1) and growth per level (max level 15)

| Stat | Typical level 1 | Growth / level | Notes |
|---|---|---|---|
| maxHp | 560-720 (tanks high) | 85-115 | |
| hpRegen | 1.5-2.6 | 0.12-0.2 | per second |
| maxMana | 280-460 | 35-55 | |
| manaRegen | 1.5-2.4 | 0.08-0.14 | per second |
| attackDamage | 48-66 | 2.8-4.2 | marksmen/fighters higher |
| abilityPower | 0 | 0 | comes from items |
| armor | 22-38 | 3.5-4.8 | tanks high |
| magicResist | 28-34 | 1.2-2.0 | |
| attackSpeed | 0.60-0.72 | 0.012-0.02 | attacks per second; growth is additive |
| attackRange | melee 2.4, ranged 7-9 | 0 | |
| moveSpeed | 5.6-6.4 | 0 | |
| critChance, lifesteal, abilityHaste, armorPen, magicPen | 0 | 0 | |

## Abilities

- Q/W/E have 5 ranks (rank = 1 + floor((level-1)/3)); R has 3 ranks, unlocked at level 4 (rank 2 at 9, rank 3 at 14).
- All arrays in `cooldown`, `manaCost` and `Scaling.base` are per rank: 5 entries for Q/W/E, 3 for R.
- Basic damage ability: base 60-90 at rank 1 to 220-300 at rank 5, plus 0.5-0.9 `ap` (mages) or 0.7-1.2 `bonusAd` (physical).
- Ultimates: base 150-250 / 260-380 / 370-520 plus 0.7-1.1 ratio. Cooldowns 70-110s scaling down by rank.
- Basic cooldowns 5-16s (mobility and hard CC on the longer end). Mana costs 40-100.
- Hard CC (stun/root/knockup/taunt) 0.75-1.5s; ultimates up to 2s. Slows 0.2-0.5 power for 1-2.5s.
- Shields/heals: 60-120 at rank 1 to 200-300 at rank 5, + 0.4-0.7 ap (or maxHp ratio 0.06-0.12 for tanks).
- Ranges: skillshots 9-14, dashes 5-9, point AoEs 8-12 with radius 2.5-4.5, melee cones 3-4.5.
- Projectile speed 20-35 units/s (fast), 12-18 (slow, big).
- Every hero needs at least one way to interact with waves (AoE or pierce) and one self-preservation or engage tool.

## Economy reference

- Passive income 3 gold/s per hero. Minion last hit 18-45. Hero kill 300 (+ streak bounty), assist 150.
- Banner capture: 250 to every member of the capturing team. Tower: 150 each. Boss: 300 each.
- Tier 1 items 300-500, tier 2 900-1400, tier 3 2600-3400. A full build is 6 slots.
