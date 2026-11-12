import { Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { runCommand } from '../engine/commands';
import type { NetworkEngine } from '../engine/networkEngine';
import { useEngineVersion } from '../hooks/useEngine';
import type { LogLevel } from '../types/network';
import { cx, formatSimTime } from '../utils/format';

const LEVEL_CLASS: Record<LogLevel, string> = {
  info: 'text-slate-300',
  ok: 'text-sig-green',
  drop: 'text-sig-red',
  arp: 'text-sig-amber',
  route: 'text-sig-cyan',
  nat: 'text-sig-violet',
  warn: 'text-sig-amber',
  cmd: 'text-white font-semibold',
  sys: 'text-slate-500',
};

/** Live trace of hop decisions, table lookups and ARP state, plus a small CLI. */
export function TerminalConsole({ engine }: { engine: NetworkEngine }) {
  useEngineVersion(engine);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastId = engine.logs.length ? engine.logs[engine.logs.length - 1].id : 0;

  useEffect(() => {
    if (pinned.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lastId]);

  const submit = () => {
    const line = input.trim();
    if (!line) return;
    pinned.current = true;
    runCommand(engine, line);
    setHistory((h) => [line, ...h.filter((x) => x !== line)].slice(0, 30));
    setCursor(-1);
    setInput('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#090b10]">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-[18px]"
      >
        {engine.logs.map((l) => (
          <div key={l.id} className="flex gap-2 whitespace-pre-wrap">
            <span className="shrink-0 text-slate-600">{formatSimTime(l.time)}</span>
            <span className={cx('w-[92px] shrink-0 truncate', l.node === 'SYSTEM' || l.node === 'CLI' ? 'text-slate-600' : 'text-slate-400')}>{l.node}</span>
            <span className={LEVEL_CLASS[l.level]}>{l.msg}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-edge px-3 py-1.5">
        <span className="font-mono text-[11px] text-sig-green">netscope&gt;</span>
        <input
          value={input}
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'ArrowUp' && history.length) {
              e.preventDefault();
              const next = Math.min(cursor + 1, history.length - 1);
              setCursor(next);
              setInput(history[next]);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              const next = cursor - 1;
              setCursor(Math.max(next, -1));
              setInput(next >= 0 ? history[next] : '');
            }
          }}
          placeholder='type "help" — e.g.  ping PC-A 10.0.0.5   ·   show arp PC-A   ·   show route R1'
          aria-label="Terminal command"
          className="h-6 flex-1 bg-transparent font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
        />
        <button onClick={() => engine.clearLogs()} title="Clear console" aria-label="Clear console" className="rounded p-1 text-slate-500 hover:bg-raised hover:text-white">
          <Eraser size={13} />
        </button>
      </div>
    </div>
  );
}
