export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = html;
  return el;
}

export const ui = () => document.getElementById('ui')!;
export const overlay = () => document.getElementById('overlay')!;

export function toast(text: string, color = '#e9c46a') {
  const t = h('div', { class: 'toast panel' }, esc(text));
  t.style.color = color;
  ui().appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
