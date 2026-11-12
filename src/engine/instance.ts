import { sfx } from '../utils/audio';
import { NetworkEngine } from './networkEngine';
import { SCENARIOS } from './scenarios';

/**
 * The single engine for the lifetime of the page. React only observes it.
 * It lives in its own module so component hot-reloads never recreate it.
 */
export const engine = new NetworkEngine();
engine.onSound = (name) => sfx.play(name);
engine.load(SCENARIOS[0].build, SCENARIOS[0].name);

// Handy for poking at the simulation from the browser console during development.
if (import.meta.env.DEV) (window as unknown as { __netscope?: NetworkEngine }).__netscope = engine;
