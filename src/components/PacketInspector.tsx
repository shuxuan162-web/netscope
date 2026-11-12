import { ChevronDown, ChevronRight, Eraser, Search, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { NetworkEngine } from '../engine/networkEngine';
import { useEngineVersion } from '../hooks/useEngine';
import type { CapturedPacket, CaptureStatus } from '../types/network';
import { encodeFrame, type LayerSpan } from '../utils/bytes';
import { cx, formatSimTime } from '../utils/format';

const LAYER_COLOR: Record<number, string> = { 2: '#a78bfa', 3: '#00f0ff', 4: '#10b981', 7: '#f59e0b' };
const GRID = 'grid grid-cols-[34px_68px_minmax(92px,0.9fr)_minmax(88px,0.9fr)_minmax(88px,0.9fr)_46px_minmax(150px,2.6fr)] gap-x-2';

function rowTone(protocol: string, status: CaptureStatus, verified: boolean): string {
  if (status === 'dropped') return 'text-sig-red bg-sig-red/[0.07]';
  if (status === 'ignored') return 'text-slate-600';
  if (protocol === 'ARP') return 'text-sig-amber';
  if (verified) return 'text-sig-green';
  return 'text-cyan-200';
}

interface RowProps {
  cap: CapturedPacket;
  status: CaptureStatus;
  selected: boolean;
  onSelect: (no: number) => void;
}

const Row = memo(function Row({ cap, status, selected, onSelect }: RowProps) {
  return (
    <button
      onClick={() => onSelect(cap.no)}
      className={cx(GRID, 'w-full border-b border-edge/40 px-2 py-[3px] text-left font-mono text-[11px] leading-4', rowTone(cap.protocol, status, !!cap.frame.verified), selected ? '!bg-sig-cyan/20 !text-white' : 'hover:bg-white/[0.04]')}
    >
      <span className="text-slate-500">{cap.no}</span>
      <span className="text-slate-400">{formatSimTime(cap.time)}</span>
      <span className="truncate text-slate-400">
        {cap.fromHost} → {cap.toHost}
      </span>
      <span className="truncate">{cap.source}</span>
      <span className="truncate">{cap.destination}</span>
      <span className="font-semibold">{cap.protocol}</span>
      <span className="truncate" title={cap.info}>
        {status === 'dropped' && '✕ '}
        {status === 'ignored' && '(not for this NIC) '}
        {cap.info}
      </span>
    </button>
  );
});

function HexDump({ bytes, layers, highlight }: { bytes: Uint8Array; layers: LayerSpan[]; highlight: [number, number] | null }) {
  const owner = (i: number) => layers.find((l) => i >= l.start && i < l.end)?.layer ?? 0;
  const rows: number[] = [];
  for (let i = 0; i < bytes.length; i += 16) rows.push(i);
  const lit = (i: number) => !!highlight && i >= highlight[0] && i < highlight[1];
  return (
    <div className="font-mono text-[10px] leading-[16px]">
      {rows.map((off) => (
        <div key={off} className="flex gap-2 whitespace-pre">
          <span className="text-slate-600">{off.toString(16).padStart(4, '0')}</span>
          <span>
            {Array.from(bytes.slice(off, off + 16), (b, j) => {
              const i = off + j;
              return (
                <span key={i} className={cx('px-[1.5px]', lit(i) && 'rounded-sm bg-white/25 text-white')} style={{ color: lit(i) ? undefined : LAYER_COLOR[owner(i)], opacity: highlight && !lit(i) ? 0.45 : 1 }}>
                  {b.toString(16).padStart(2, '0')}
                  {j === 7 ? ' ' : ''}
                </span>
              );
            })}
          </span>
          <span className="hidden text-slate-500 2xl:inline">
            {Array.from(bytes.slice(off, off + 16), (b, j) => (
              <span key={j} className={cx(lit(off + j) && 'bg-white/25 text-white')}>
                {b >= 32 && b < 127 ? String.fromCharCode(b) : '·'}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function Details({ cap, onClose }: { cap: CapturedPacket; onClose: () => void }) {
  const encoded = useMemo(() => encodeFrame(cap.frame), [cap]);
  const [open, setOpen] = useState<Record<number, boolean>>({ 2: true, 3: true, 4: true, 7: true });
  const [highlight, setHighlight] = useState<[number, number] | null>(null);
  const statusText: Record<CaptureStatus, string> = { transit: 'in transit', delivered: 'delivered', dropped: 'DROPPED', ignored: 'ignored by receiving NIC (MAC mismatch)' };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative border-b border-edge py-2 pl-3 pr-9 font-mono text-[11px] text-slate-400">
        <button onClick={onClose} title="Close frame details" aria-label="Close frame details" className="absolute right-2 top-1.5 rounded p-1 text-slate-500 hover:bg-raised hover:text-white">
          <X size={13} />
        </button>
        <span className="text-slate-200">Frame {cap.no}</span>: {encoded.bytes.length} bytes on wire · {cap.fromHost} → {cap.toHost} · T+{formatSimTime(cap.time)} ·{' '}
        <span className={cap.status === 'dropped' ? 'font-bold text-sig-red' : cap.status === 'delivered' ? 'text-sig-green' : 'text-slate-400'}>{statusText[cap.status]}</span>
        {cap.dropReason && <span className="text-sig-red"> — {cap.dropReason}</span>}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto xl:grid-cols-[minmax(0,1fr)_auto] xl:overflow-hidden" onMouseLeave={() => setHighlight(null)}>
        <div className="min-h-0 overflow-auto px-2 py-2 xl:border-r xl:border-edge">
          {encoded.layers.map((l) => (
            <div key={l.start} className="mb-1">
              <button
                onClick={() => setOpen((o) => ({ ...o, [l.layer]: !o[l.layer] }))}
                onMouseEnter={() => setHighlight([l.start, l.end])}
                className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left font-mono text-[11px] hover:bg-white/5"
              >
                {open[l.layer] ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
                <span className="rounded px-1 text-[9px] font-bold text-obsidian" style={{ background: LAYER_COLOR[l.layer] }}>
                  L{l.layer}
                </span>
                <span className="shrink-0 whitespace-nowrap font-semibold text-slate-100">{l.title}</span>
                <span className="truncate text-slate-500">{l.summary}</span>
              </button>
              {open[l.layer] && (
                <div className="ml-[18px] border-l border-edge pl-2">
                  {l.fields.map((f) => (
                    <div key={f.start} onMouseEnter={() => setHighlight([f.start, f.end])} className="flex gap-2 rounded px-1 py-[1px] font-mono text-[11px] hover:bg-white/5">
                      <span className="w-[124px] shrink-0 text-slate-500">{f.label}</span>
                      <span className="break-all" style={{ color: LAYER_COLOR[l.layer] }}>
                        {f.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="min-h-0 overflow-auto px-3 py-2">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-slate-600">Raw bytes · hover a field to locate it</p>
          <HexDump bytes={encoded.bytes} layers={encoded.layers} highlight={highlight} />
        </div>
      </div>
    </div>
  );
}

/** Wireshark-lite: chronological capture list plus an OSI-layer byte breakdown. */
export function PacketInspector({ engine }: { engine: NetworkEngine }) {
  useEngineVersion(engine);
  const [selectedNo, setSelectedNo] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const q = filter.trim().toLowerCase();
  const rows = q
    ? engine.captures.filter((c) => `${c.protocol} ${c.source} ${c.destination} ${c.info} ${c.fromHost} ${c.toHost} ${c.status}`.toLowerCase().includes(q))
    : engine.captures;
  const selected = engine.captures.find((c) => c.no === selectedNo) ?? null;
  const lastNo = rows.length ? rows[rows.length - 1].no : 0;

  useEffect(() => {
    if (follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [lastNo, follow]);

  return (
    <div className={cx('grid h-full min-h-0 grid-cols-1', selected ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]' : 'lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]')}>
      <div className="flex min-h-0 flex-col border-edge lg:border-r">
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <div className="flex h-6 flex-1 items-center gap-1.5 rounded border border-edge bg-obsidian px-2">
            <Search size={12} className="text-slate-500" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter: arp, tcp, 10.0.0.5, dropped …" aria-label="Filter packets" className="w-full bg-transparent font-mono text-[11px] text-slate-200 outline-none placeholder:text-slate-600" />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[#00f0ff]" />
            Follow
          </label>
          <span className="font-mono text-[10px] text-slate-500">{rows.length} frames</span>
          <button
            onClick={() => {
              engine.clearCaptures();
              setSelectedNo(null);
            }}
            title="Clear capture"
            aria-label="Clear capture"
            className="rounded p-1 text-slate-400 hover:bg-raised hover:text-white"
          >
            <Eraser size={13} />
          </button>
        </div>
        <div className={cx(GRID, 'border-b border-edge bg-raised px-2 py-1 font-mono text-[9.5px] uppercase tracking-wider text-slate-500')}>
          <span>No.</span>
          <span>Time</span>
          <span>Hop</span>
          <span>Source</span>
          <span>Destination</span>
          <span>Proto</span>
          <span>Info</span>
        </div>
        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-auto"
          onWheel={(e) => e.deltaY < 0 && setFollow(false)}
        >
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">{q ? 'No frames match the filter.' : 'No frames captured yet — launch traffic from the Traffic Generator or a quick action.'}</p>
          ) : (
            rows.map((c) => <Row key={c.no} cap={c} status={c.status} selected={c.no === selectedNo} onSelect={setSelectedNo} />)
          )}
        </div>
      </div>
      <div className="hidden min-h-0 lg:block">
        {selected ? (
          <Details key={selected.no} cap={selected} onClose={() => setSelectedNo(null)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex gap-1">
              {[2, 3, 4, 7].map((l) => (
                <span key={l} className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-obsidian" style={{ background: LAYER_COLOR[l] }}>
                  L{l}
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-400">Select a frame to dissect it layer by layer.</p>
            <p className="max-w-xs text-[11px] text-slate-600">Every frame is serialised to real wire bytes — Ethernet II, ARP, IPv4, ICMP, TCP and UDP headers with valid checksums.</p>
          </div>
        )}
      </div>
    </div>
  );
}
