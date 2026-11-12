import { Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Canvas } from './components/Canvas';
import { CredentialBadge } from './components/CredentialBadge';
import { Dock, type DockTab } from './components/Dock';
import { MissionsDrawer, type MissionResult } from './components/MissionsDrawer';
import { TopBar } from './components/TopBar';
import { CHALLENGES, describeOutcome, testPassed, type Challenge } from './engine/challenges';
import { engine } from './engine/instance';
import { SCENARIOS, scenarioById, type QuickAction } from './engine/scenarios';
import { useEngineVersion, useSimulationLoop } from './hooks/useEngine';
import type { FlowKind } from './types/network';
import { sfx } from './utils/audio';
import { isTypingTarget } from './utils/format';

const PROGRESS_KEY = 'netscope.missions.v1';

let demoStarted = false;

function loadProgress(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id) => CHALLENGES.some((c) => c.id === id)) : [];
  } catch {
    return [];
  }
}

interface Verification {
  challengeId: string;
  flowIds: (string | null)[];
}

export default function App() {
  const version = useEngineVersion(engine);
  useSimulationLoop(engine);

  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [tab, setTab] = useState<DockTab>('packets');
  const [dockOpen, setDockOpen] = useState(true);
  const [dockHeight, setDockHeight] = useState(() => (typeof window !== 'undefined' && window.innerHeight < 800 ? 250 : 310));
  const [missionsOpen, setMissionsOpen] = useState(false);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [completed, setCompleted] = useState<string[]>(loadProgress);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [results, setResults] = useState<Record<string, MissionResult>>({});

  const scenario = scenarioById(scenarioId);

  const loadScenario = useCallback((id: string) => {
    const s = scenarioById(id);
    engine.load(s.build, s.name);
    setScenarioId(s.id);
    setSelectedId(null);
    setVerification(null);
    setResults({});
    setFitKey((k) => k + 1);
    if (s.group === 'mission') setMissionsOpen(true);
  }, []);

  const launch = useCallback((srcNodeId: string, dstIp: string, kind: FlowKind, port?: number, ttl?: number) => {
    const result = engine.startFlow({ srcNodeId, dstIp, kind, port, ttl });
    if (typeof result === 'string') {
      engine.log('SYSTEM', 'warn', result);
      sfx.play('buzz');
    } else if (!engine.running) {
      engine.log('SYSTEM', 'sys', 'Simulation is paused — press Play or Step to move the packet.');
    }
  }, []);

  const runQuickAction = (a: QuickAction) => {
    const node = engine.byName(a.from);
    if (!node) return engine.log('SYSTEM', 'warn', `${a.from} no longer exists in this topology.`);
    launch(node.id, a.dstIp, a.kind, a.port);
  };

  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setTab('config');
      setDockOpen(true);
    }
  }, []);

  // A little motion on first paint so a visitor immediately sees what this is.
  useEffect(() => {
    if (demoStarted) return;
    demoStarted = true;
    setTimeout(() => {
      const first = SCENARIOS[0].quickActions[0];
      const node = engine.byName(first.from);
      if (node && engine.flows.length === 0) engine.startFlow({ srcNodeId: node.id, dstIp: first.dstIp, kind: first.kind });
    }, 700);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        engine.configure({ running: !engine.running });
      } else if (e.key === '.') {
        engine.configure({ running: false });
        engine.step();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── challenge verification ────────────────────────────────────────────────

  const verify = (c: Challenge) => {
    engine.clearTraffic();
    engine.configure({ running: true, lossRate: 0 });
    engine.log('SYSTEM', 'sys', `── Verifying "${c.title}" — launching ${c.tests.length} test flow(s) with packet loss disabled ──`);
    const flowIds = c.tests.map((t) => {
      const node = engine.byName(t.from);
      const flow = node ? engine.startFlow({ srcNodeId: node.id, dstIp: t.dstIp, kind: t.kind, port: t.port }) : `${t.from} is missing`;
      if (typeof flow === 'string') {
        engine.log('SYSTEM', 'warn', `Test "${t.label}" could not start: ${flow}`);
        return null;
      }
      return flow.id;
    });
    setResults((r) => {
      const next = { ...r };
      delete next[c.id];
      return next;
    });
    setVerification({ challengeId: c.id, flowIds });
    setTab('terminal');
    setDockOpen(true);
  };

  useEffect(() => {
    if (!verification) return;
    const challenge = CHALLENGES.find((c) => c.id === verification.challengeId);
    if (!challenge) return;
    const flows = verification.flowIds.map((id) => engine.flows.find((f) => f.id === id));
    if (flows.some((f) => f && (f.state === 'pending' || f.state === 'established'))) return;

    const lines = challenge.tests.map((t, i) => ({ label: t.label, ok: testPassed(t, flows[i]), outcome: describeOutcome(flows[i]) }));
    const pass = lines.every((l) => l.ok);
    setResults((r) => ({ ...r, [challenge.id]: { pass, lines } }));
    setVerification(null);
    engine.log('SYSTEM', pass ? 'ok' : 'drop', pass ? `✔ Mission "${challenge.title}" verified — all objectives met.` : `✘ Mission "${challenge.title}" not solved yet: ${lines.filter((l) => !l.ok).map((l) => `${l.label} → ${l.outcome}`).join('; ')}.`);
    if (pass) {
      sfx.play('success');
      setCompleted((prev) => {
        if (prev.includes(challenge.id)) return prev;
        const next = [...prev, challenge.id];
        try {
          localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
        } catch {
          /* storage unavailable (private mode) — progress simply is not persisted */
        }
        if (next.length === CHALLENGES.length) setTimeout(() => setCredentialOpen(true), 900);
        return next;
      });
    }
  }, [version, verification]);

  const resetProgress = () => {
    setCompleted([]);
    setResults({});
    try {
      localStorage.removeItem(PROGRESS_KEY);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex h-full flex-col bg-obsidian text-slate-200">
      <TopBar
        engine={engine}
        scenarioId={scenarioId}
        onScenario={loadScenario}
        onReset={() => loadScenario(scenarioId)}
        muted={muted}
        onMute={() => {
          sfx.setMuted(!muted);
          setMuted(!muted);
        }}
        missionsOpen={missionsOpen}
        onMissions={() => setMissionsOpen((o) => !o)}
        completed={completed.length}
        total={CHALLENGES.length}
        onCredential={() => setCredentialOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="relative min-h-0 flex-1">
            <Canvas engine={engine} selectedId={selectedId} onSelect={selectNode} fitKey={fitKey}>
              {/* scenario briefing + one-click demo traffic */}
              <div className="pointer-events-none absolute left-[86px] right-3 top-3 flex">
                <div className="pointer-events-auto max-w-full rounded-xl border border-edge bg-panel/95 px-3 py-2 shadow-xl shadow-black/40 backdrop-blur">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-white">{scenario.name}</h2>
                    <p className="text-[11px] text-slate-400">{scenario.description}</p>
                  </div>
                  {scenario.quickActions.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-wider text-slate-500">
                        <Zap size={11} className="text-sig-cyan" /> Try
                      </span>
                      {scenario.quickActions.map((a) => (
                        <button
                          key={a.label}
                          onClick={() => runQuickAction(a)}
                          title={a.expect}
                          className="rounded-md border border-sig-cyan/35 bg-sig-cyan/[0.08] px-2 py-1 font-mono text-[10.5px] text-sig-cyan transition-colors hover:border-sig-cyan/70 hover:bg-sig-cyan/20"
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Canvas>
          </main>
          <Dock engine={engine} sessionKey={fitKey} tab={tab} onTab={setTab} open={dockOpen} onOpen={setDockOpen} height={dockHeight} onHeight={setDockHeight} selectedId={selectedId} onSelect={selectNode} onLaunch={launch} />
        </div>

        {missionsOpen && (
          <MissionsDrawer
            activeScenarioId={scenarioId}
            completed={completed}
            verifyingId={verification?.challengeId ?? null}
            results={results}
            onLoad={(c) => loadScenario(c.scenarioId)}
            onVerify={verify}
            onClose={() => setMissionsOpen(false)}
            onCredential={() => setCredentialOpen(true)}
            onResetProgress={resetProgress}
          />
        )}
      </div>

      {credentialOpen && (
        <CredentialBadge
          completed={completed}
          onClose={() => setCredentialOpen(false)}
          onOpenMissions={() => {
            setCredentialOpen(false);
            setMissionsOpen(true);
          }}
        />
      )}
    </div>
  );
}
