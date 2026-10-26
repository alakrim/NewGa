import type { HeroDef } from '../../types';

export const dirge: HeroDef = {
  id: 'dirge',
  name: 'Dirge',
  title: 'The Quiet Hand',
  role: 'Assassin',
  difficulty: 3,
  faction: 'The Hollow',
  lore:
    `Dirge ran the Thornwood Guild for twenty years and sold half its best students to the highest bidder. When the Sundering came he was in a cellar in Mareth counting coin, and the dead found him there. The Bone Forge raised him as the one thing it could not teach: silence. He has not spoken a word since waking. He moves without the click of bone, and when he strikes there is no sound at all.\n\n` +
    `He hunts those who know where his bargains are buried. Sable Thorne was the first of his old students to learn the price of his generosity, and she is the one he most expects to come looking. Ossian, the scout he was paid to kill in the ash fields before the Hollow rose, is the one who actually does. Dirge takes contracts from both banners now, which is a trick he picked up in life. A dead man has no loyalties, he supposes. Only debts, and those he is good at collecting.`,
  quote: 'The Quiet Hand takes what it is owed. (Thornwood saying)',
  visual: {
    model: 'Skeleton_Rogue',
    tint: '#4338ca',
    accent: '#a5b4fc',
    scale: 0.95,
    weapons: ['Skeleton_Blade', 'Skeleton_Axe'],
    vfx: '#818cf8',
  },
  attack: {
    kind: 'melee',
    anims: ['Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab'],
  },
  base: {
    maxHp: 570, hpRegen: 1.8, maxMana: 320, manaRegen: 1.8,
    attackDamage: 63, abilityPower: 0, armor: 24, magicResist: 28,
    attackSpeed: 0.7, attackRange: 2.4, moveSpeed: 6.5,
    critChance: 0, lifesteal: 0, abilityHaste: 0, armorPen: 0, magicPen: 0,
  },
  growth: {
    maxHp: 90, hpRegen: 0.13, maxMana: 36, manaRegen: 0.09,
    attackDamage: 3.9, armor: 3.5, magicResist: 1.2, attackSpeed: 0.018,
  },
  passive: {
    name: "Reaper's Momentum",
    description: 'Killing a unit instantly refreshes Shade Slip and hides Dirge from sight for a moment, so a chain of kills never has to stop.',
    icon: '🥀',
    onKill: [
      { type: 'resetCooldowns', slots: ['E'] },
      { type: 'status', status: 'stealth', duration: 1.0 },
    ],
  },
  abilities: [
    {
      id: 'dirge_q',
      name: 'Hamstring',
      description: 'Dashes at an enemy and cuts their legs, damaging and slowing them.',
      icon: '🦵',
      targeting: 'enemy',
      range: 6.5,
      cooldown: [8, 7.5, 7, 6.5, 6],
      manaCost: [40, 44, 48, 52, 56],
      castTime: 0.1,
      anim: 'Dodge_Forward',
      effects: [
        {
          type: 'dash',
          to: 'target',
          distance: 6.5,
          speed: 30,
          width: 1.2,
          affects: 'enemies',
          stopOnHit: true,
          effects: [
            { type: 'damage', amount: { base: [55, 85, 115, 145, 175], bonusAd: 0.8 }, dtype: 'physical' },
            { type: 'status', status: 'slow', duration: 1.5, power: 0.4 },
          ],
        },
      ],
    },
    {
      id: 'dirge_w',
      name: 'Rend',
      description: 'Rakes both blades through a wide arc in front of him. The more wounded an enemy is, the more it bleeds.',
      icon: '🩸',
      targeting: 'direction',
      range: 3.5,
      cooldown: [7, 6.5, 6, 5.5, 5],
      manaCost: [35, 38, 41, 44, 47],
      castTime: 0.15,
      anim: 'Dualwield_Melee_Attack_Slice',
      effects: [
        {
          type: 'area',
          shape: 'cone',
          at: 'caster',
          radius: 3.5,
          angle: 90,
          affects: 'enemies',
          vfx: { style: 'slash', color: '#818cf8' },
          effects: [
            { type: 'damage', amount: { base: [50, 80, 110, 140, 170], bonusAd: 0.7, targetMissingHp: 0.06 }, dtype: 'physical' },
          ],
        },
      ],
    },
    {
      id: 'dirge_e',
      name: 'Shade Slip',
      description: 'Vanishes and reappears a short distance away, unseen for a moment and moving fast.',
      icon: '🌫️',
      targeting: 'point',
      range: 6,
      cooldown: [14, 13, 12, 11, 10],
      manaCost: [50, 55, 60, 65, 70],
      castTime: 0.1,
      anim: 'Dodge_Forward',
      effects: [
        {
          type: 'blink',
          distance: 6,
          onArrive: [
            { type: 'status', status: 'stealth', duration: 1.0 },
            { type: 'buff', id: 'dirge_slip', duration: 2, pct: { moveSpeed: 0.25 }, vfx: { style: 'smoke', color: '#818cf8' } },
          ],
        },
      ],
    },
    {
      id: 'dirge_r',
      name: 'Guillotine',
      description: 'Falls on an enemy for a brutal strike that deals far more damage the less health they have left. Killing with it resets its cooldown.',
      icon: '🗡️',
      targeting: 'enemy',
      range: 9,
      cooldown: [90, 80, 70],
      manaCost: [80, 90, 100],
      castTime: 0.2,
      anim: 'Jump_Full_Short',
      effects: [
        {
          type: 'dash',
          to: 'target',
          distance: 9,
          speed: 32,
          width: 1.2,
          affects: 'enemies',
          stopOnHit: true,
          effects: [
            { type: 'damage', amount: { base: [100, 180, 260], bonusAd: 0.9, targetMissingHp: 0.35 }, dtype: 'physical' },
            { type: 'if', cond: { test: 'targetDead' }, then: [{ type: 'resetCooldowns', slots: ['R'] }] },
          ],
        },
      ],
    },
  ],
};
