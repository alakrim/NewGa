import type { HeroDef } from '../../types';

export const sable: HeroDef = {
  id: 'sable',
  name: 'Sable',
  title: 'Thorn of the Thornwood',
  role: 'Assassin',
  difficulty: 3,
  faction: 'Thornwood',
  lore:
    `Sable Thorne was the best cutpurse the Thornwood Guild ever trained, and the first to rob the Dawnguard's own vault. The Sun-Seal ring she lifted from the Bastion of Aurel is worth more than a small town and does nothing but sit on her finger, glowing slightly whenever Valen Ashcroft is within a mile. She finds this hilarious. He does not.\n\n` +
    `She works alone, mostly. Her old partner Tamsin Quickfingers sells her sword to whoever pays and remembers every job they pulled together; her former apprentice Wren has stopped writing, which Sable tells herself is a good sign. The one person she truly wants to find is Dirge, the Guildmaster who sold her to the Duskborn when she was twenty and who has since died, returned and stopped answering his name. She keeps her knives coated in nightshade for that reunion.`,
  quote: 'You were never going to see it coming. That was the whole point.',
  visual: {
    model: 'Rogue',
    tint: '#16a34a',
    accent: '#bef264',
    scale: 0.95,
    weapons: ['Knife', 'Knife_Offhand', 'Rogue_Cape'],
    vfx: '#4ade80',
  },
  attack: {
    kind: 'melee',
    anims: ['Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab', 'Dualwield_Melee_Attack_Chop'],
  },
  base: {
    maxHp: 560, hpRegen: 1.8, maxMana: 320, manaRegen: 1.8,
    attackDamage: 62, abilityPower: 0, armor: 24, magicResist: 28,
    attackSpeed: 0.72, attackRange: 2.4, moveSpeed: 6.4,
    critChance: 0, lifesteal: 0, abilityHaste: 0, armorPen: 0, magicPen: 0,
  },
  growth: {
    maxHp: 88, hpRegen: 0.13, maxMana: 36, manaRegen: 0.09,
    attackDamage: 3.8, armor: 3.5, magicResist: 1.2, attackSpeed: 0.02,
  },
  passive: {
    name: 'Venomed Blades',
    description: 'Basic attacks coat the target in nightshade, dealing magic damage over a few seconds.',
    icon: '🧪',
    onHit: [
      {
        type: 'repeat',
        count: 3,
        interval: 0.6,
        effects: [{ type: 'damage', amount: { base: 4.2, level: 1.05, ad: 0.035 }, dtype: 'magic' }],
      },
    ],
  },
  abilities: [
    {
      id: 'sable_q',
      name: 'Throwing Knives',
      description: 'Flicks a knife in a straight line that pierces through everything in its path, wounding and slowing them. Thrown from stealth, the first blade hits for bonus damage.',
      icon: '🔪',
      targeting: 'direction',
      range: 9,
      cooldown: [7, 6.5, 6, 5.5, 5],
      manaCost: [40, 42, 44, 46, 48],
      castTime: 0.15,
      anim: 'Throw',
      effects: [
        {
          type: 'projectile',
          speed: 32,
          range: 9,
          width: 0.8,
          pierce: true,
          affects: 'enemies',
          visual: { style: 'dagger', color: '#4ade80', size: 1.0 },
          effects: [
            { type: 'if', cond: { test: 'casterHasStatus', status: 'stealth' }, then: [{ type: 'damage', amount: { base: [40, 60, 80, 100, 120], bonusAd: 0.5 }, dtype: 'physical' }] },
            { type: 'damage', amount: { base: [50, 80, 110, 140, 170], bonusAd: 0.8 }, dtype: 'physical' },
            { type: 'status', status: 'slow', duration: 1, power: 0.2 },
          ],
        },
      ],
    },
    {
      id: 'sable_w',
      name: 'Cloak of Thorns',
      description: 'Melts into the shadows and sprints away unseen. Her next attack from stealth strikes for bonus damage and silences the target.',
      icon: '🌿',
      targeting: 'self',
      range: 0,
      cooldown: [16, 15, 14, 13, 12],
      manaCost: [50, 55, 60, 65, 70],
      castTime: 0.1,
      anim: 'Dodge_Forward',
      effects: [
        { type: 'status', status: 'stealth', duration: 3 },
        { type: 'buff', id: 'sable_cloak', duration: 3, pct: { moveSpeed: 0.25 }, vfx: { style: 'smoke', color: '#4ade80' } },
        {
          type: 'empower',
          duration: 3.5,
          effects: [
            { type: 'damage', amount: { base: [60, 95, 130, 165, 200], bonusAd: 0.7 }, dtype: 'physical' },
            { type: 'status', status: 'silence', duration: 1.0 },
          ],
        },
      ],
    },
    {
      id: 'sable_e',
      name: 'Thorn Step',
      description: 'Slips a short distance in any direction, leaving a cloud of choking thorns that damages and slows enemies where she started.',
      icon: '💨',
      targeting: 'point',
      range: 6.5,
      cooldown: [11, 10.5, 10, 9.5, 9],
      manaCost: [45, 50, 55, 60, 65],
      castTime: 0.1,
      anim: 'Dodge_Forward',
      effects: [
        {
          type: 'blink',
          distance: 6.5,
          onDepart: [
            {
              type: 'area',
              shape: 'circle',
              at: 'caster',
              radius: 2.8,
              affects: 'enemies',
              vfx: { style: 'smoke', color: '#16a34a' },
              effects: [
                { type: 'damage', amount: { base: [30, 45, 60, 75, 90], bonusAd: 0.3 }, dtype: 'magic' },
                { type: 'status', status: 'slow', duration: 1.5, power: 0.4 },
              ],
            },
          ],
          onArrive: [{ type: 'buff', id: 'sable_step', duration: 2, pct: { moveSpeed: 0.2 } }],
        },
      ],
    },
    {
      id: 'sable_r',
      name: 'Death Blossom',
      description: 'Dashes onto an enemy and unleashes a flurry of blades, striking again and again while untouchable.',
      icon: '🌸',
      targeting: 'enemy',
      range: 8,
      cooldown: [90, 80, 70],
      manaCost: [80, 90, 100],
      castTime: 0.1,
      anim: 'Dualwield_Melee_Attack_Slice',
      effects: [
        {
          type: 'dash',
          to: 'target',
          distance: 8,
          speed: 30,
          width: 1.2,
          affects: 'enemies',
          stopOnHit: true,
          effects: [{ type: 'damage', amount: { base: [60, 90, 120], bonusAd: 0.35 }, dtype: 'physical' }],
          onArrive: [
            { type: 'status', status: 'invulnerable', duration: 1.1 },
            {
              type: 'repeat',
              count: 5,
              interval: 0.2,
              effects: [
                {
                  type: 'area',
                  shape: 'circle',
                  at: 'caster',
                  radius: 2.6,
                  affects: 'enemies',
                  vfx: { style: 'slash', color: '#bef264' },
                  effects: [{ type: 'damage', amount: { base: [50, 75, 100], bonusAd: 0.35 }, dtype: 'physical' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
