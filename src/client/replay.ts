import type { Command, GameInit, Snapshot } from '../shared/protocol';
import { TICK_RATE } from '../shared/constants';
import { Game, type Replay } from '../shared/sim/game';
import type { ChatLine, Session } from './net';

/** Plays a recorded match back through the real simulation, as an all-seeing spectator. */
export class ReplaySession implements Session {
  readonly online = false;
  onInit: (init: GameInit) => void = () => {};
  onSnap: (s: Snapshot) => void = () => {};
  onChat: (c: ChatLine) => void = () => {};
  rtt = 0;
  speed = 1;
  paused = false;
  private game: Game;
  private timer = 0;

  constructor(readonly replay: Replay) { this.game = Game.fromReplay(replay); }

  get progress() { return this.game.tick / Math.max(1, this.replay.ticks); }

  start() {
    this.onInit({ ...this.game.init(''), you: '' });
    let acc = 0, last = performance.now();
    this.timer = window.setInterval(() => {
      const now = performance.now();
      acc += Math.min(250, now - last) * this.speed;
      last = now;
      if (this.paused) { acc = 0; return; }
      let stepped = false;
      while (acc >= 1000 / TICK_RATE && this.game.tick < this.replay.ticks) { this.game.step(); acc -= 1000 / TICK_RATE; stepped = true; }
      if (stepped) { this.onSnap(this.game.snapshot(null, -1)); this.game.flushEvents(); }
    }, 1000 / TICK_RATE / 2);
  }
  send(_cmd: Command) { /* spectators cannot act */ }
  chat() {}
  close() { clearInterval(this.timer); }
}

export function downloadReplay(r: Replay) {
  const blob = new Blob([JSON.stringify(r)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bannerfall-replay-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
