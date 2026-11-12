import { Award, Gauge, Lock, Pause, Play, RotateCcw, StepForward, Target, TriangleAlert, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { PROFILE } from '../config/profile';
import type { NetworkEngine } from '../engine/networkEngine';
import { SCENARIOS } from '../engine/scenarios';
import { useEngineVersion } from '../hooks/useEngine';
import { cx, formatSimTime } from '../utils/format';
import { GithubMark } from './icons';

interface Props {
  engine: NetworkEngine;
  scenarioId: string;
  onScenario: (id: string) => void;
  onReset: () => void;
  muted: boolean;
  onMute: () => void;
  missionsOpen: boolean;
  onMissions: () => void;
  completed: number;
  total: number;
  onCredential: () => void;
}

/** Clock and in-flight counter update every frame without re-rendering React. */
function SimClock({ engine }: { engine: NetworkEngine }) {
  const timeRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (timeRef.current) timeRef.current.textContent = formatSimTime(engine.time);
      if (countRef.current) countRef.current.textContent = String(engine.packets.length).padStart(2, '0');
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);
  return (
    <div className="hidden items-center gap-3 rounded-md border border-edge bg-obsidian px-2.5 py-1 font-mono text-[11px] min-[1400px]:flex" title="Simulated time · frames in flight">
      <span className="text-slate-500">T+</span>
      <span ref={timeRef} className="w-[66px] text-sig-cyan">
        00:00.000
      </span>
      <span className="text-slate-500">PKT</span>
      <span ref={countRef} className="w-4 text-sig-green">
        00
      </span>
    </div>
  );
}

const iconBtn = 'flex h-8 w-8 items-center justify-center rounded-md border border-edge bg-raised text-slate-300 transition-colors hover:border-edge-bright hover:text-white';

export function TopBar({ engine, scenarioId, onScenario, onReset, muted, onMute, missionsOpen, onMissions, completed, total, onCredential }: Props) {
  useEngineVersion(engine);
  const unlocked = completed >= total;

  return (
    <header className="z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge bg-panel px-3 py-2">
      <div className="flex items-center gap-2 pr-1">
        <svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden>
          <rect width="64" height="64" rx="14" fill="#0b0d13" stroke="#232a3c" />
          <path d="M16 44 C28 44 24 20 36 20 S44 44 50 30" fill="none" stroke="#1f2a3d" strokeWidth="5" strokeLinecap="round" />
          <path d="M16 44 C28 44 24 20 36 20" fill="none" stroke="#00f0ff" strokeWidth="5" strokeLinecap="round" />
          <circle cx="16" cy="44" r="6" fill="#0b0d13" stroke="#00f0ff" strokeWidth="3" />
          <circle cx="36" cy="20" r="6" fill="#0b0d13" stroke="#10b981" strokeWidth="3" />
          <circle cx="50" cy="30" r="5" fill="#f59e0b" />
        </svg>
        <div className="leading-tight">
          <h1 className="font-mono text-[13px] font-bold tracking-[0.18em] text-white">NETSCOPE</h1>
          <p className="hidden text-[10px] text-slate-500 sm:block">Packet flow simulator</p>
        </div>
      </div>

      {/* simulation control ribbon */}
      <div className="flex items-center gap-1.5 rounded-lg border border-edge bg-obsidian/60 p-1">
        <button
          onClick={() => engine.configure({ running: !engine.running })}
          title={engine.running ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={engine.running ? 'Pause simulation' : 'Play simulation'}
          className={cx('flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors', engine.running ? 'bg-sig-cyan/15 text-sig-cyan hover:bg-sig-cyan/25' : 'bg-sig-amber/15 text-sig-amber hover:bg-sig-amber/25')}
        >
          {engine.running ? <Pause size={14} /> : <Play size={14} />}
          <span className="w-10 text-left">{engine.running ? 'Pause' : 'Play'}</span>
        </button>
        <button
          onClick={() => {
            engine.configure({ running: false });
            engine.step();
          }}
          title="Pause and step to the next frame arrival (.)"
          aria-label="Step forward"
          className={iconBtn}
        >
          <StepForward size={14} />
        </button>
        <button onClick={onReset} title="Reset topology — reload this scenario and clear all state" aria-label="Reset topology" className={cx(iconBtn, 'w-auto gap-1.5 px-2.5 text-xs')}>
          <RotateCcw size={13} />
          <span className="hidden lg:inline">Reset</span>
        </button>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-slate-400" title="Global simulation speed">
        <Gauge size={14} className="text-slate-500" />
        <span className="hidden 2xl:inline">Speed</span>
        <input type="range" min={0.25} max={4} step={0.25} value={engine.speed} onChange={(e) => engine.configure({ speed: Number(e.target.value) })} className="w-20" aria-label="Simulation speed" />
        <span className="w-10 font-mono text-sig-cyan">{engine.speed.toFixed(2).replace(/0$/, '')}x</span>
      </label>

      <label className="flex items-center gap-2 text-[11px] text-slate-400" title="Probability that a frame is lost on each link traversal">
        <TriangleAlert size={14} className={engine.lossRate > 0 ? 'text-sig-red' : 'text-slate-500'} />
        <span className="hidden 2xl:inline">Loss</span>
        <input
          type="range"
          min={0}
          max={50}
          step={1}
          value={Math.round(engine.lossRate * 100)}
          onChange={(e) => engine.configure({ lossRate: Number(e.target.value) / 100 })}
          className="w-20"
          style={{ accentColor: engine.lossRate > 0 ? '#f43f5e' : undefined }}
          aria-label="Packet loss rate"
        />
        <span className={cx('w-8 font-mono', engine.lossRate > 0 ? 'text-sig-red' : 'text-slate-400')}>{Math.round(engine.lossRate * 100)}%</span>
      </label>

      <select
        value={scenarioId}
        onChange={(e) => onScenario(e.target.value)}
        aria-label="Load scenario"
        title="Quick-load a scenario"
        className="h-8 max-w-[210px] rounded-md border border-edge bg-raised px-2 text-xs text-slate-200 hover:border-edge-bright"
      >
        <optgroup label="Scenario presets">
          {SCENARIOS.filter((s) => s.group === 'preset').map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Challenge missions">
          {SCENARIOS.filter((s) => s.group === 'mission').map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Build your own">
          {SCENARIOS.filter((s) => s.group === 'sandbox').map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      </select>

      <div className="ml-auto flex items-center gap-1.5">
        <SimClock engine={engine} />
        <button
          onClick={onMissions}
          aria-pressed={missionsOpen}
          title="Challenge missions — diagnose broken networks"
          className={cx('flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors', missionsOpen ? 'border-sig-amber/60 bg-sig-amber/15 text-sig-amber' : 'border-edge bg-raised text-slate-200 hover:border-sig-amber/50 hover:text-sig-amber')}
        >
          <Target size={14} />
          Missions
          <span className="rounded bg-obsidian px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
            {completed}/{total}
          </span>
        </button>
        <button
          onClick={onCredential}
          title={unlocked ? 'View your Network Architect credential' : 'Complete all missions to unlock the credential'}
          className={cx('flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors', unlocked ? 'border-sig-green/60 bg-sig-green/15 text-sig-green hover:bg-sig-green/25' : 'border-edge bg-raised text-slate-400 hover:text-slate-200')}
        >
          {unlocked ? <Award size={14} /> : <Lock size={13} />}
          <span className="hidden md:inline">Credential</span>
        </button>
        <button onClick={onMute} title={muted ? 'Unmute sound effects' : 'Mute sound effects'} aria-label={muted ? 'Unmute' : 'Mute'} className={iconBtn}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        {PROFILE.sourceUrl && (
          <a href={PROFILE.sourceUrl} target="_blank" rel="noreferrer" title="View source on GitHub" aria-label="View source on GitHub" className={iconBtn}>
            <GithubMark size={15} />
          </a>
        )}
      </div>
    </header>
  );
}
