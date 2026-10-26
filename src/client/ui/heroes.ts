import { HEROES } from '../../shared/data/heroes';
import type { AbilityDef, HeroDef, Role } from '../../shared/types';
import { esc } from './dom';
import { portrait, splash } from './portraits';

const ROLES: (Role | 'All')[] = ['All', 'Tank', 'Fighter', 'Assassin', 'Mage', 'Marksman', 'Support'];
const DIFF = ['', 'Easy', 'Medium', 'Hard'];

export function abilityRow(a: AbilityDef, key: string): string {
  const cd = a.cooldown.length ? `${a.cooldown[0]}${a.cooldown.length > 1 ? `→${a.cooldown[a.cooldown.length - 1]}` : ''}s` : '';
  const mana = a.manaCost[0] ? ` · ${a.manaCost[0]} mana` : '';
  return `<div class="ab"><div class="ico">${a.icon}<b>${key}</b></div><div><div class="t">${esc(a.name)} <span class="muted" style="font-weight:400;font-size:11px">${cd}${mana}</span></div><div class="d">${esc(a.description)}</div></div></div>`;
}

export function heroDetail(def: HeroDef): string {
  const b = def.base;
  const bars: [string, number][] = [
    ['Health', (b.maxHp - 450) / 300], ['Damage', (b.attackDamage - 40) / 30], ['Armor', (b.armor - 15) / 25],
    ['Range', b.attackRange / 9.5], ['Speed', (b.moveSpeed - 5.2) / 1.4],
  ];
  return `<div class="hero-detail">
    <img class="big" src="${splash(def.id)}" alt="">
    <h3 class="serif">${esc(def.name)}</h3>
    <div class="title">${esc(def.title)}</div>
    <div class="row" style="flex-wrap:wrap;gap:6px"><span class="tag">${def.role}${def.secondaryRole ? ` / ${def.secondaryRole}` : ''}</span><span class="tag">${DIFF[def.difficulty]}</span><span class="tag">${esc(def.faction)}</span><span class="tag">${def.attack.kind}</span></div>
    <div class="quote">“${esc(def.quote)}”</div>
    <div class="statbars">${bars.map(([n, v]) => `<span class="muted">${n}</span><div class="bar"><div style="width:${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%"></div></div>`).join('')}</div>
    <div class="ab"><div class="ico">${def.passive.icon}<b>P</b></div><div><div class="t">${esc(def.passive.name)} <span class="muted" style="font-weight:400;font-size:11px">passive</span></div><div class="d">${esc(def.passive.description)}</div></div></div>
    ${def.abilities.map((a, i) => abilityRow(a, 'QWER'[i])).join('')}
    <details style="margin-top:8px"><summary class="gold" style="cursor:pointer">Story</summary><p class="lore">${esc(def.lore)}</p></details>
  </div>`;
}

/** Hero picker grid. `taken` = hero ids unavailable to you (picked by teammates). */
export class HeroPicker {
  private role: Role | 'All' = 'All';
  selected: string | null;
  constructor(private grid: HTMLElement, private detail: HTMLElement, private onPick: (id: string) => void, initial: string | null) {
    this.selected = initial;
  }
  render(taken: Set<string> = new Set()) {
    const list = HEROES.filter((h) => this.role === 'All' || h.role === this.role || h.secondaryRole === this.role);
    this.grid.innerHTML = `<div class="filters">${ROLES.map((r) => `<button data-role="${r}" class="${r === this.role ? 'on' : ''}">${r}</button>`).join('')}</div>
      <div class="hero-grid">${list.map((h) => `<button class="hero-card ${h.id === this.selected ? 'selected' : ''} ${taken.has(h.id) ? 'taken' : ''}" data-hero="${h.id}" title="${esc(h.name)}, ${esc(h.title)}">
        <img src="${portrait(h.id)}" alt=""><span class="role">${h.role}</span><span class="hn">${esc(h.name)}</span></button>`).join('')}</div>`;
    this.grid.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((b) => b.onclick = () => { this.role = b.dataset.role as Role; this.render(taken); });
    this.grid.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((b) => {
      b.onclick = () => { if (taken.has(b.dataset.hero!)) return; this.selected = b.dataset.hero!; this.onPick(this.selected); this.render(taken); };
      b.onmouseenter = () => { this.detail.innerHTML = heroDetail(HEROES.find((x) => x.id === b.dataset.hero)!); };
    });
    const show = HEROES.find((x) => x.id === this.selected) ?? HEROES[0];
    this.detail.innerHTML = heroDetail(show);
  }
}
