// Procedural sound effects (WebAudio). No audio files, so no licensing to track.

type Sfx = 'hit' | 'crit' | 'cast' | 'shoot' | 'boom' | 'heal' | 'gold' | 'level' | 'death' | 'horn' | 'click' | 'blink' | 'zap' | 'thud';

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<Sfx, number>();
  volume = 0.5;
  muted = false;

  /** Must be called from a user gesture (browsers block audio before one). */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  toggleMute() { this.muted = !this.muted; this.setVolume(this.volume); return this.muted; }

  private env(g: GainNode, t: number, a: number, d: number, peak: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, out: AudioNode) {
    const c = this.ctx!;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, 0.005, dur, peak);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private burst(t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1: number, out: AudioNode, q = 1) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.004, dur, peak);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  /** gain 0..1 (use distance attenuation), pan -1..1 */
  play(kind: Sfx, gain = 1, pan = 0) {
    if (!this.ctx || !this.master || this.muted || gain < 0.03) return;
    const now = this.ctx.currentTime;
    const minGap = kind === 'hit' ? 0.03 : kind === 'shoot' ? 0.04 : 0.06;
    if (now - (this.last.get(kind) ?? 0) < minGap) return;
    this.last.set(kind, now);
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const g = this.ctx.createGain();
    g.gain.value = gain;
    p.connect(g).connect(this.master);
    const t = now + 0.005, j = 1 + (Math.random() - 0.5) * 0.15;
    switch (kind) {
      case 'hit': this.burst(t, 0.08, 0.5, 'bandpass', 1800 * j, 600, p, 2); this.tone('triangle', 180 * j, 90, t, 0.07, 0.25, p); break;
      case 'crit': this.burst(t, 0.14, 0.7, 'bandpass', 2600 * j, 500, p, 3); this.tone('square', 320 * j, 120, t, 0.12, 0.15, p); break;
      case 'thud': this.tone('sine', 120 * j, 45, t, 0.18, 0.6, p); this.burst(t, 0.1, 0.25, 'lowpass', 800, 200, p); break;
      case 'shoot': this.burst(t, 0.12, 0.35, 'highpass', 3000 * j, 6000, p); this.tone('triangle', 900 * j, 300, t, 0.08, 0.12, p); break;
      case 'cast': this.burst(t, 0.35, 0.35, 'bandpass', 400 * j, 2400, p, 4); this.tone('sine', 300 * j, 700, t, 0.3, 0.15, p); break;
      case 'zap': this.tone('sawtooth', 1400 * j, 200, t, 0.18, 0.12, p); this.burst(t, 0.15, 0.25, 'highpass', 4000, 2000, p); break;
      case 'boom': this.burst(t, 0.6, 0.9, 'lowpass', 900, 60, p); this.tone('sine', 90, 35, t, 0.5, 0.7, p); break;
      case 'heal': [523, 659, 784].forEach((f, i) => this.tone('sine', f, f * 1.01, t + i * 0.06, 0.35, 0.18, p)); break;
      case 'gold': this.tone('square', 1568, 1568, t, 0.07, 0.08, p); this.tone('square', 2093, 2093, t + 0.07, 0.15, 0.08, p); break;
      case 'level': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.07, 0.3, 0.2, p)); break;
      case 'death': this.tone('sawtooth', 220, 55, t, 0.7, 0.2, p); this.burst(t, 0.5, 0.2, 'lowpass', 1200, 100, p); break;
      case 'horn': [196, 247, 294].forEach((f) => this.tone('sawtooth', f, f * 1.005, t, 1.1, 0.07, p)); this.tone('sawtooth', 392, 392, t + 0.45, 0.8, 0.06, p); break;
      case 'click': this.tone('sine', 1200, 900, t, 0.04, 0.15, p); break;
      case 'blink': this.tone('sine', 400, 1800, t, 0.18, 0.2, p); break;
    }
  }
}

export const sfx = new Audio();

if (typeof window !== 'undefined') {
  const unlock = () => sfx.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
