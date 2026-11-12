import { Award, Check, CircleCheck, CircleX, FlaskConical, Lightbulb, Loader, Lock, Target, X } from 'lucide-react';
import { useState } from 'react';
import { CHALLENGES, type Challenge } from '../engine/challenges';
import { cx } from '../utils/format';

export interface MissionResult {
  pass: boolean;
  lines: { label: string; ok: boolean; outcome: string }[];
}

interface Props {
  activeScenarioId: string;
  completed: string[];
  verifyingId: string | null;
  results: Record<string, MissionResult>;
  onLoad: (c: Challenge) => void;
  onVerify: (c: Challenge) => void;
  onClose: () => void;
  onCredential: () => void;
  onResetProgress: () => void;
}

function MissionCard({ c, index, active, done, verifying, result, onLoad, onVerify }: { c: Challenge; index: number; active: boolean; done: boolean; verifying: boolean; result?: MissionResult; onLoad: () => void; onVerify: () => void }) {
  const [hints, setHints] = useState(0);
  return (
    <article className={cx('rounded-xl border bg-raised/60 transition-colors', active ? 'border-sig-amber/60' : 'border-edge')}>
      <header className="flex items-start gap-2.5 p-3 pb-2">
        <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold', done ? 'border-sig-green bg-sig-green/20 text-sig-green' : 'border-edge-bright text-slate-400')}>
          {done ? <Check size={13} /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-white">{c.title}</h3>
          <p className="font-mono text-[9.5px] uppercase tracking-wider text-slate-500">
            {c.difficulty} · {done ? <span className="text-sig-green">solved</span> : active ? <span className="text-sig-amber">in progress</span> : 'not started'}
          </p>
        </div>
      </header>
      <div className="space-y-2.5 px-3 pb-3">
        <p className="text-[11.5px] leading-relaxed text-slate-400">{c.brief}</p>
        <ul className="space-y-1">
          {c.objectives.map((o, i) => {
            const line = result?.lines[i];
            return (
              <li key={o} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                {line ? line.ok ? <CircleCheck size={13} className="mt-px shrink-0 text-sig-green" /> : <CircleX size={13} className="mt-px shrink-0 text-sig-red" /> : <Target size={13} className="mt-px shrink-0 text-slate-600" />}
                <span>
                  {o}
                  {line && !line.ok && <span className="block font-mono text-[10px] text-sig-red">result: {line.outcome}</span>}
                </span>
              </li>
            );
          })}
        </ul>

        {hints > 0 && (
          <ol className="space-y-1 rounded-lg border border-sig-amber/25 bg-sig-amber/[0.06] p-2">
            {c.hints.slice(0, hints).map((h, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-amber-100/90">
                <span className="font-mono text-sig-amber">{i + 1}.</span>
                {h}
              </li>
            ))}
          </ol>
        )}

        {result && !verifying && (
          <p className={cx('rounded-lg border px-2 py-1.5 text-[11px] font-medium', result.pass ? 'border-sig-green/40 bg-sig-green/10 text-sig-green' : 'border-sig-red/40 bg-sig-red/10 text-sig-red')}>
            {result.pass ? 'Verified — network repaired. Mission complete.' : 'Not fixed yet. Check the Terminal for the hop that fails.'}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {active ? (
            <button
              onClick={onVerify}
              disabled={verifying}
              className="flex h-7 items-center gap-1.5 rounded-md border border-sig-green/50 bg-sig-green/15 px-2.5 text-[11px] font-semibold text-sig-green transition-colors hover:bg-sig-green/25 disabled:opacity-60"
            >
              {verifying ? <Loader size={12} className="animate-spin" /> : <FlaskConical size={12} />}
              {verifying ? 'Running test traffic…' : 'Verify fix'}
            </button>
          ) : (
            <button onClick={onLoad} className="flex h-7 items-center gap-1.5 rounded-md border border-sig-amber/50 bg-sig-amber/15 px-2.5 text-[11px] font-semibold text-sig-amber transition-colors hover:bg-sig-amber/25">
              <Target size={12} />
              {done ? 'Replay mission' : 'Start mission'}
            </button>
          )}
          {active && (
            <button onClick={onLoad} className="h-7 rounded-md border border-edge px-2.5 text-[11px] text-slate-400 hover:border-edge-bright hover:text-slate-200" title="Reload the broken topology">
              Restart
            </button>
          )}
          {hints < c.hints.length && (
            <button onClick={() => setHints(hints + 1)} className="ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-slate-400 hover:text-sig-amber">
              <Lightbulb size={12} />
              {hints === 0 ? 'Hint' : `Next hint (${hints}/${c.hints.length})`}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** Guided challenge mode: three broken networks to diagnose and repair. */
export function MissionsDrawer({ activeScenarioId, completed, verifyingId, results, onLoad, onVerify, onClose, onCredential, onResetProgress }: Props) {
  const allDone = CHALLENGES.every((c) => completed.includes(c.id));
  return (
    <aside className="z-10 flex w-[340px] shrink-0 animate-rise flex-col border-l border-edge bg-panel max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:shadow-2xl max-lg:shadow-black">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
        <Target size={15} className="text-sig-amber" />
        <div className="flex-1">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white">Challenge missions</h2>
          <p className="text-[10px] text-slate-500">Diagnose the fault, fix the config, verify.</p>
        </div>
        <button onClick={onClose} aria-label="Close missions" className="rounded p-1 text-slate-400 hover:bg-raised hover:text-white">
          <X size={15} />
        </button>
      </header>

      <div className="border-b border-edge px-3 py-2">
        <div className="mb-1 flex justify-between font-mono text-[10px] text-slate-400">
          <span>Progress</span>
          <span>
            {completed.length}/{CHALLENGES.length} solved
          </span>
        </div>
        <div className="flex gap-1">
          {CHALLENGES.map((c) => (
            <span key={c.id} className={cx('h-1.5 flex-1 rounded-full', completed.includes(c.id) ? 'bg-sig-green shadow-[0_0_8px_#10b981]' : 'bg-edge')} />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {CHALLENGES.map((c, i) => (
          <MissionCard
            key={c.id}
            c={c}
            index={i}
            active={activeScenarioId === c.scenarioId}
            done={completed.includes(c.id)}
            verifying={verifyingId === c.id}
            result={results[c.id]}
            onLoad={() => onLoad(c)}
            onVerify={() => onVerify(c)}
          />
        ))}

        <button
          onClick={onCredential}
          className={cx('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors', allDone ? 'border-sig-green/60 bg-sig-green/10 hover:bg-sig-green/20' : 'border-dashed border-edge-bright hover:bg-raised/60')}
        >
          <span className={cx('flex h-9 w-9 items-center justify-center rounded-full border', allDone ? 'border-sig-green text-sig-green' : 'border-edge-bright text-slate-500')}>{allDone ? <Award size={18} /> : <Lock size={15} />}</span>
          <span>
            <span className={cx('block text-[12px] font-semibold', allDone ? 'text-sig-green' : 'text-slate-300')}>Network Architect Credential</span>
            <span className="block text-[10.5px] text-slate-500">{allDone ? 'Unlocked — view the badge and developer profile.' : 'Solve all three missions to unlock the developer profile.'}</span>
          </span>
        </button>

        {completed.length > 0 && (
          <button onClick={onResetProgress} className="w-full text-center text-[10px] text-slate-600 hover:text-slate-400">
            Reset mission progress
          </button>
        )}
      </div>
    </aside>
  );
}
