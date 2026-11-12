import { useEffect, useSyncExternalStore } from 'react';
import type { NetworkEngine } from '../engine/networkEngine';

/** Re-renders the calling component whenever the engine's observable state changes. */
export function useEngineVersion(engine: NetworkEngine): number {
  return useSyncExternalStore(engine.subscribe, engine.getVersion);
}

/** Drives the simulation clock from requestAnimationFrame. */
export function useSimulationLoop(engine: NetworkEngine): void {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      engine.tick(now - last);
      last = now;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);
}
