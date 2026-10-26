import type { HeroDef } from '../../types';
import { aldric } from './aldric';
import { hrodgar } from './hrodgar';
import { hallen } from './hallen';
import { valen } from './valen';
import { skarra } from './skarra';
import { kraghul } from './kraghul';
import { rattle } from './rattle';
import { sable } from './sable';
import { wren } from './wren';
import { dirge } from './dirge';
import { ysolde } from './ysolde';
import { kaelen } from './kaelen';
import { morvane } from './morvane';
import { zhal } from './zhal';
import { tamsin } from './tamsin';
import { merrow } from './merrow';
import { ossian } from './ossian';
import { seraphine } from './seraphine';
import { nerissa } from './nerissa';
import { pell } from './pell';

/** Roster order: Tanks, Fighters, Assassins, Mages, Marksmen, Supports. */
export const HEROES: HeroDef[] = [
  // Tanks
  aldric, hrodgar, hallen,
  // Fighters
  valen, skarra, kraghul, rattle,
  // Assassins
  sable, wren, dirge,
  // Mages
  ysolde, kaelen, morvane, zhal,
  // Marksmen
  tamsin, merrow, ossian,
  // Supports
  seraphine, nerissa, pell,
];

export const HERO_BY_ID: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));
