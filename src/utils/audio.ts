import type { SoundName } from '../types/network';

/**
 * Sound effects synthesised with the Web Audio API — no audio assets.
 * The AudioContext is only created after the first user gesture, as browsers
 * require, so nothing plays (or warns) on page load.
 */

let ctx: AudioContext | null = null;
let unlocked = false;
let muted = false;
const lastPlayed: Partial<Record<SoundName, number>> = {};
const MIN_GAP_MS: Record<SoundName, number> = { click: 40, chirp: 70, buzz: 140, success: 200 };

if (typeof window !== 'undefined') {
  const unlock = () => {
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function audio(): AudioContext | null {
  if (!unlocked || muted || typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface Tone {
  type: OscillatorType;
  from: number;
  to?: number;
  duration: number;
  gain: number;
  delay?: number;
}

function tone(ac: AudioContext, t: Tone): void {
  const start = ac.currentTime + (t.delay ?? 0);
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = t.type;
  osc.frequency.setValueAtTime(t.from, start);
  if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(t.gain, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + t.duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + t.duration + 0.02);
}

export const sfx = {
  play(name: SoundName): void {
    const now = performance.now();
    if (now - (lastPlayed[name] ?? -1e9) < MIN_GAP_MS[name]) return;
    const ac = audio();
    if (!ac) return;
    lastPlayed[name] = now;
    switch (name) {
      case 'click': // node connection
        tone(ac, { type: 'square', from: 1500, to: 900, duration: 0.035, gain: 0.03 });
        break;
      case 'chirp': // packet received
        tone(ac, { type: 'sine', from: 1500, to: 2400, duration: 0.07, gain: 0.03 });
        break;
      case 'buzz': // packet dropped
        tone(ac, { type: 'sawtooth', from: 120, to: 70, duration: 0.2, gain: 0.05 });
        break;
      case 'success': // flow completed
        tone(ac, { type: 'triangle', from: 880, duration: 0.09, gain: 0.04 });
        tone(ac, { type: 'triangle', from: 1320, duration: 0.14, gain: 0.04, delay: 0.09 });
        break;
    }
  },
  setMuted(value: boolean): void {
    muted = value;
  },
};
