// Team-wide fortress upgrades. Any player can fund them with their own gold; the effect is shared.

export type UpgradeId = 'forge' | 'armory' | 'bulwark' | 'treasury' | 'horn' | 'watch';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  costs: number[]; // per level
  description: string;
  levelText: string[];
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'forge', name: 'Bone Forge', icon: '⚒️', costs: [600, 1000, 1500],
    description: 'Your monster waves grow stronger and larger.',
    levelText: ['+15% monster health & damage', '+30%, +1 Footman per wave', '+45%, a Forge Wraith joins every wave'],
  },
  {
    id: 'armory', name: 'Tower Armory', icon: '🏹', costs: [500, 900, 1400],
    description: 'All your towers hit harder and gain health (repairs the difference).',
    levelText: ['+20% tower damage, +15% health', '+40% damage, +30% health', '+60% damage, +45% health'],
  },
  {
    id: 'bulwark', name: 'Fortress Bulwark', icon: '🛡️', costs: [700, 1100, 1600],
    description: 'Your fortress core gains armor, regeneration and firepower.',
    levelText: ['+25 armor/MR, +10 hp/s', '+50 armor/MR, +20 hp/s, +30% damage', '+75 armor/MR, +30 hp/s, +60% damage'],
  },
  {
    id: 'treasury', name: 'War Treasury', icon: '💰', costs: [700, 1100, 1600],
    description: 'Every member of your team earns more passive gold.',
    levelText: ['+0.6 gold/s each', '+1.2 gold/s each', '+1.8 gold/s each'],
  },
  {
    id: 'horn', name: 'Rally Horn', icon: '📯', costs: [600, 1000],
    description: 'Your heroes respawn faster.',
    levelText: ['-20% respawn time', '-40% respawn time'],
  },
  {
    id: 'watch', name: 'Watchfires', icon: '🔥', costs: [400, 800],
    description: 'Your structures and banners see further, and night hurts your vision less.',
    levelText: ['+4 structure sight, +2 night sight', '+8 structure sight, +4 night sight'],
  },
];
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;

export type Directive = 'balanced' | 'swarm' | 'phalanx' | 'siege';
/** Per-lane orders for the Bone Forge. Free to change; applies from the next wave. */
export const DIRECTIVES: Record<Directive, { name: string; icon: string; text: string }> = {
  balanced: { name: 'Balanced', icon: '⚖️', text: '3 footmen, 2 hexers, a brute every third wave.' },
  swarm: { name: 'Swarm', icon: '🐜', text: '6 footmen and 3 hexers, each 30% weaker. Floods the lane and soaks tower shots.' },
  phalanx: { name: 'Phalanx', icon: '🛡️', text: '4 footmen with +40% health and +20 armor, 1 hexer. Fewer bodies, much harder to kill.' },
  siege: { name: 'Siege', icon: '🏗️', text: '2 footmen, 1 hexer and a brute every wave; brutes deal +60% to structures.' },
};

export const MERCENARY = { cost: 350, name: 'Hire a Bone Brute', description: 'A heavy brute joins the next wave in the lane you pick.' };
