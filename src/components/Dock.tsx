import { ChevronDown, ChevronUp, ListTree, Settings2, Terminal } from 'lucide-react';
import { useCallback, useRef, type PointerEvent } from 'react';
import type { NetworkEngine } from '../engine/networkEngine';
import { useEngineVersion } from '../hooks/useEngine';
import type { FlowKind } from '../types/network';
import { cx } from '../utils/format';
import { clamp } from '../utils/geometry';
import { NodeConfigModal } from './NodeConfigModal';
import { PacketInspector } from './PacketInspector';
import { TerminalConsole } from './TerminalConsole';
import { TrafficPanel } from './TrafficPanel';

export type DockTab = 'packets' | 'config' | 'terminal';

interface Props {
  engine: NetworkEngine;
  /** Changes whenever a topology is (re)loaded, so per-topology form state resets. */
  sessionKey: number;
  tab: DockTab;
  onTab: (t: DockTab) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  height: number;
  onHeight: (h: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLaunch: (srcNodeId: string, dstIp: string, kind: FlowKind, port?: number, ttl?: number) => void;
}

/** Collapsible, resizable bottom dock: traffic generator + three tabbed tools. */
export function Dock({ engine, sessionKey, tab, onTab, open, onOpen, height, onHeight, selectedId, onSelect, onLaunch }: Props) {
  useEngineVersion(engine);
  const resize = useRef<{ y: number; h: number } | null>(null);
  const selected = selectedId ? engine.node(selectedId) : undefined;
  const drops = engine.captures.reduce((n, c) => n + (c.status === 'dropped' ? 1 : 0), 0);

  const onResizeMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!resize.current) return;
      onHeight(clamp(resize.current.h + resize.current.y - e.clientY, 170, Math.round(window.innerHeight * 0.7)));
    },
    [onHeight],
  );

  const tabs: { id: DockTab; label: string; Icon: typeof Terminal; badge?: string; badgeTone?: string }[] = [
    { id: 'packets', label: 'Packet Inspector', Icon: ListTree, badge: String(engine.captures.length), badgeTone: drops ? 'text-sig-red' : 'text-slate-400' },
    { id: 'config', label: selected ? `Node Config · ${selected.hostname}` : 'Node Config', Icon: Settings2 },
    { id: 'terminal', label: 'Terminal', Icon: Terminal, badge: String(engine.logs.length), badgeTone: 'text-slate-400' },
  ];

  return (
    <div className="relative z-10 flex shrink-0 flex-col border-t border-edge bg-panel" style={{ height: open ? height : 34 }}>
      {open && (
        <div
          className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-ns-resize hover:bg-sig-cyan/30"
          title="Drag to resize"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            resize.current = { y: e.clientY, h: height };
          }}
          onPointerMove={onResizeMove}
          onPointerUp={() => (resize.current = null)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {open && (
          <aside className="hidden w-[256px] shrink-0 border-r border-edge md:block">
            <TrafficPanel key={sessionKey} engine={engine} selectedId={selectedId} onLaunch={onLaunch} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[33px] shrink-0 items-stretch border-b border-edge" role="tablist">
            {tabs.map(({ id, label, Icon, badge, badgeTone }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id && open}
                onClick={() => {
                  onTab(id);
                  onOpen(true);
                }}
                className={cx('flex items-center gap-1.5 border-r border-edge px-3 text-[11px] font-medium transition-colors', tab === id && open ? 'bg-raised text-white shadow-[inset_0_2px_0_#00f0ff]' : 'text-slate-400 hover:bg-raised/60 hover:text-slate-200')}
              >
                <Icon size={13} />
                <span className="max-w-[220px] truncate">{label}</span>
                {badge && badge !== '0' && <span className={cx('rounded bg-obsidian px-1 font-mono text-[9.5px]', badgeTone)}>{badge}</span>}
              </button>
            ))}
            <button onClick={() => onOpen(!open)} title={open ? 'Collapse dock' : 'Expand dock'} aria-label={open ? 'Collapse dock' : 'Expand dock'} className="ml-auto flex w-9 items-center justify-center text-slate-400 hover:bg-raised hover:text-white">
              {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>
          </div>
          {open && (
            <div className="min-h-0 flex-1" role="tabpanel">
              {tab === 'packets' && <PacketInspector engine={engine} />}
              {tab === 'config' && <NodeConfigModal engine={engine} nodeId={selectedId} onDeleted={() => onSelect(null)} />}
              {tab === 'terminal' && <TerminalConsole engine={engine} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
