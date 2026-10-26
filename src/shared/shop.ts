import { ITEM_BY_ID } from './data/items';

/** Price to buy `itemId` with the given inventory; owned components (searched recursively) are consumed. */
export function priceFor(items: (string | null)[], itemId: string): { price: number; consume: number[] } {
  const it = ITEM_BY_ID[itemId];
  if (!it) return { price: Infinity, consume: [] };
  const consume: number[] = [];
  let discount = 0;
  const take = (id: string): boolean => {
    const i = items.findIndex((x, idx) => x === id && !consume.includes(idx));
    if (i < 0) return false;
    consume.push(i);
    discount += ITEM_BY_ID[id].cost;
    return true;
  };
  const walk = (id: string) => { for (const c of ITEM_BY_ID[id]?.components ?? []) if (!take(c)) walk(c); };
  walk(itemId);
  return { price: Math.max(0, it.cost - discount), consume };
}
