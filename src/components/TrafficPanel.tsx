import { CircleCheck, CircleX, Loader, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { describeOutcome } from '../engine/challenges';
import { isValidIp } from '../engine/ip';
import type { NetworkEngine } from '../engine/networkEngine';
import { useEngineVersion } from '../hooks/useEngine';
import type { FlowKind } from '../types/network';
import { cx } from '../utils/format';

interface Props {
  engine: NetworkEngine;
  selectedId: string | null;
  onLaunch: (srcNodeId: string, dstIp: string, kind: FlowKind, port?: number, ttl?: number) => void;
}

const ACTIONS: { kind: FlowKind; label: string; hint: string }[] = [
  { kind: 'ping', label: 'Ping', hint: 'ICMP echo request / reply' },
  { kind: 'http', label: 'HTTP', hint: 'TCP 3-way handshake to port 80, then GET /' },
  { kind: 'ssh', label: 'SSH', hint: 'TCP connection attempt to port 22' },
  { kind: 'dns', label: 'DNS', hint: 'UDP query to port 53' },
];

const fieldCls = 'h-7 w-full rounded border border-edge bg-obsidian px-2 font-mono text-[11px] text-slate-100 outline-none focus:border-sig-cyan/70';

/** Originates pings, HTTP GETs, SSH attempts and arbitrary TCP connections. */
export function TrafficPanel({ engine, selectedId, onLaunch }: Props) {
  useEngineVersion(engine);
  const sources = engine.nodes.filter((n) => n.kind !== 'switch' && n.interfaces.some((i) => i.ip));
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');
  const [port, setPort] = useState('443');
  const [ttl, setTtl] = useState('64');

  // Follow the canvas selection when it is a node that can originate traffic.
  useEffect(() => {
    if (selectedId && sources.some((n) => n.id === selectedId)) setSrc(selectedId);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = sources.find((n) => n.id === src) ?? sources.find((n) => n.kind === 'host') ?? sources[0];
  const targets = engine.addressBook().filter((a) => a.nodeId !== source?.id);
  const dstOk = isValidIp(dst.trim());
  const portNum = Number(port);
  const portOk = /^\d{1,5}$/.test(port) && portNum >= 1 && portNum <= 65535;
  const ttlNum = Math.max(1, Math.min(255, Number(ttl) || 64));
  const ready = !!source && dstOk;
  const recent = engine.flows.slice(-4).reverse();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-edge px-3">
        <Send size={12} className="text-sig-cyan" />
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">Traffic generator</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">From</span>
          <select value={source?.id ?? ''} onChange={(e) => setSrc(e.target.value)} className={fieldCls} aria-label="Source node">
            {sources.length === 0 && <option value="">no addressed nodes</option>}
            {sources.map((n) => (
              <option key={n.id} value={n.id}>
                {n.hostname} · {n.interfaces.find((i) => i.ip)?.ip}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">To (IP address)</span>
          <input value={dst} onChange={(e) => setDst(e.target.value)} list="netscope-targets" placeholder="pick or type an IP" spellCheck={false} aria-label="Destination IP" className={cx(fieldCls, dst && !dstOk && '!border-sig-red/80 text-sig-red')} />
          <datalist id="netscope-targets">
            {targets.map((t) => (
              <option key={`${t.nodeId}${t.ip}`} value={t.ip}>
                {t.hostname}
              </option>
            ))}
          </datalist>
        </label>
        <div className="flex flex-wrap gap-1">
          {targets
            .filter((t, i) => targets.findIndex((x) => x.nodeId === t.nodeId) === i)
            .slice(0, 8)
            .map((t) => (
            <button key={`${t.nodeId}${t.ip}`} onClick={() => setDst(t.ip)} title={t.ip} className={cx('rounded border px-1.5 py-0.5 font-mono text-[9.5px] transition-colors', dst === t.ip ? 'border-sig-cyan/60 bg-sig-cyan/10 text-sig-cyan' : 'border-edge text-slate-400 hover:border-edge-bright hover:text-slate-200')}>
              {t.hostname}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {ACTIONS.map((a) => (
            <button
              key={a.kind}
              disabled={!ready}
              title={a.hint}
              onClick={() => onLaunch(source!.id, dst.trim(), a.kind, undefined, ttlNum)}
              className="h-7 rounded border border-sig-cyan/40 bg-sig-cyan/10 text-[10.5px] font-semibold text-sig-cyan transition-colors hover:bg-sig-cyan/20 disabled:cursor-not-allowed disabled:border-edge disabled:bg-transparent disabled:text-slate-600"
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_64px_52px] items-end gap-1">
          <button
            disabled={!ready || !portOk}
            title="Open a TCP connection to any port"
            onClick={() => onLaunch(source!.id, dst.trim(), 'tcp', portNum, ttlNum)}
            className="h-7 rounded border border-edge bg-raised text-[10.5px] font-semibold text-slate-200 transition-colors hover:border-sig-cyan/50 hover:text-sig-cyan disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:border-edge"
          >
            TCP connect →
          </button>
          <label>
            <span className="mb-0.5 block text-[9px] uppercase tracking-wider text-slate-500">Port</span>
            <input value={port} onChange={(e) => setPort(e.target.value)} aria-label="TCP port" className={cx(fieldCls, !portOk && '!border-sig-red/80')} />
          </label>
          <label title="Initial IP time-to-live. Try 1 to watch a router drop the packet.">
            <span className="mb-0.5 block text-[9px] uppercase tracking-wider text-slate-500">TTL</span>
            <input value={ttl} onChange={(e) => setTtl(e.target.value)} aria-label="IP TTL" className={fieldCls} />
          </label>
        </div>

        {recent.length > 0 && (
          <div className="space-y-1 border-t border-edge pt-2">
            {recent.map((f) => (
              <div key={f.id} className="flex items-center gap-1.5 font-mono text-[10px]" title={f.label}>
                {f.state === 'success' ? <CircleCheck size={11} className="shrink-0 text-sig-green" /> : f.state === 'failed' ? <CircleX size={11} className="shrink-0 text-sig-red" /> : <Loader size={11} className="shrink-0 animate-spin text-sig-cyan" />}
                <span className="truncate text-slate-300">{f.label}</span>
                <span className={cx('ml-auto shrink-0', f.state === 'success' ? 'text-sig-green' : f.state === 'failed' ? 'text-sig-red' : 'text-slate-500')}>{describeOutcome(f)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
