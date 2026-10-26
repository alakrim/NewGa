import type { Snapshot } from '../../shared/protocol';

/** What GameScreen needs from a HUD; implemented by the Crossing `Hud` and the Frontline `FrontHud`. */
export interface GameHud {
  snap: Snapshot | null;
  onLeave: () => void;
  onReplay: () => void;
  onWatchReplay: (() => void) | null;
  onMinimap: (x: number, z: number, button: number) => void;
  readonly chatting: boolean;
  update(s: Snapshot): void;
  frame(): void;
  toggle(kind: 'board'): void;
  closeModal(): void;
  openChat(): void;
  setHost(isHost: boolean): void;
  destroy(): void;
}
