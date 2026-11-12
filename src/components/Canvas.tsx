import { Cable, Maximize, MousePointer2, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { NetworkEngine } from '../engine/networkEngine';
import { useEngineVersion } from '../hooks/useEngine';
import type { NetworkNode, NodeKind } from '../types/network';
import { sfx } from '../utils/audio';
import { cx, isTypingTarget } from '../utils/format';
import { clamp, curvePath, curvePoint, linkCurve, type Point } from '../utils/geometry';
import { renderOverlay } from './canvasRenderer';
import { KIND_META, NODE_KINDS, SIGNAL } from './nodeMeta';

type Tool = 'select' | 'link' | 'delete';
interface View {
  x: number;
  y: number;
  k: number;
}
type Drag =
  | { kind: 'node'; id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean }
  | { kind: 'link'; id: string; sx: number; sy: number; moved: boolean }
  | { kind: 'pan'; vx: number; vy: number; sx: number; sy: number; moved: boolean };

const DRAG_TYPE = 'application/x-netscope-node';
// Space kept clear of floating chrome when auto-fitting the topology.
const INSET = { left: 92, right: 36, top: 84, bottom: 52 };

interface Props {
  engine: NetworkEngine;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Changing this value re-fits the view (e.g. after loading a scenario). */
  fitKey: number;
  children?: ReactNode;
}

function nodeSubtitle(n: NetworkNode): string {
  switch (n.kind) {
    case 'host':
    case 'server': {
      const i = n.interfaces[0];
      return i.ip ? `${i.ip}/${i.prefix}` : 'no IP address';
    }
    case 'switch':
      return `L2 · ${n.interfaces.length} port${n.interfaces.length === 1 ? '' : 's'}`;
    case 'router':
      return 'L3 router';
    case 'firewall':
      return n.nat.enabled ? 'ACL + NAT' : `ACL · ${n.acl.length} rule${n.acl.length === 1 ? '' : 's'}`;
  }
}

/**
 * Interactive topology canvas. Nodes and bezier links are SVG (crisp, easy to
 * hit-test); packets and effects are painted on a canvas overlay at 60 FPS.
 * Pan, zoom, drag and link math are implemented natively — no graph library.
 */
export function Canvas({ engine, selectedId, onSelect, fitKey, children }: Props) {
  useEngineVersion(engine);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  const autoFit = useRef(true);
  const drag = useRef<Drag | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [placing, setPlacing] = useState<NodeKind | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  const setView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!engine.nodes.length) return setView({ x: 0, y: 0, k: 1 });
    const xs = engine.nodes.map((n) => n.x);
    const ys = engine.nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 60;
    const maxX = Math.max(...xs) + 60;
    const minY = Math.min(...ys) - 50;
    const maxY = Math.max(...ys) + 75;
    const availW = Math.max(120, w - INSET.left - INSET.right);
    const availH = Math.max(120, h - INSET.top - INSET.bottom);
    const k = clamp(Math.min(availW / (maxX - minX), availH / (maxY - minY)), 0.3, 1.3);
    setView({
      k,
      x: INSET.left + (availW - (maxX - minX) * k) / 2 - minX * k,
      y: INSET.top + (availH - (maxY - minY) * k) / 2 - minY * k,
    });
  }, [engine, setView]);

  useLayoutEffect(() => {
    autoFit.current = true;
    fit();
  }, [fitKey, fit]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => autoFit.current && fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // 60 FPS overlay loop — independent of React rendering.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const el = wrapRef.current;
      if (!canvas || !el) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const v = viewRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(v.x, v.y);
      ctx.scale(v.k, v.k);
      renderOverlay(ctx, engine);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  }, []);

  const zoomAt = useCallback(
    (factor: number, cx0?: number, cy0?: number) => {
      const el = wrapRef.current;
      if (!el) return;
      const v = viewRef.current;
      const px = cx0 ?? el.clientWidth / 2;
      const py = cy0 ?? el.clientHeight / 2;
      const k = clamp(v.k * factor, 0.3, 2.5);
      autoFit.current = false;
      setView({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k });
    },
    [setView],
  );

  // Wheel zoom needs a non-passive listener to suppress page scrolling.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const cancelModes = useCallback(() => {
    setTool('select');
    setPlacing(null);
    setLinkFrom(null);
    setCursor(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape') cancelModes();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        engine.removeNode(selectedId);
        onSelect(null);
      } else if (e.key.toLowerCase() === 'v') cancelModes();
      else if (e.key.toLowerCase() === 'c') {
        setPlacing(null);
        setTool('link');
      } else if (e.key.toLowerCase() === 'f') {
        autoFit.current = true;
        fit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelModes, engine, fit, onSelect, selectedId]);

  // ── pointer interaction ────────────────────────────────────────────────────

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const nodeId = target.closest('[data-node]')?.getAttribute('data-node');
    const linkId = target.closest('[data-link]')?.getAttribute('data-link');
    e.currentTarget.setPointerCapture(e.pointerId);
    const base = { sx: e.clientX, sy: e.clientY, moved: false };
    const node = nodeId ? engine.node(nodeId) : undefined;
    if (node) {
      const w = toWorld(e.clientX, e.clientY);
      drag.current = { kind: 'node', id: node.id, dx: w.x - node.x, dy: w.y - node.y, ...base };
    } else if (linkId) {
      drag.current = { kind: 'link', id: linkId, ...base };
    } else {
      drag.current = { kind: 'pan', vx: viewRef.current.x, vy: viewRef.current.y, ...base };
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (linkFrom || placing) setCursor(toWorld(e.clientX, e.clientY));
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    if (d.kind === 'node' && tool === 'select' && !placing) {
      const w = toWorld(e.clientX, e.clientY);
      engine.moveNode(d.id, Math.round(w.x - d.dx), Math.round(w.y - d.dy));
    } else if (d.kind === 'pan') {
      autoFit.current = false;
      setView({ ...viewRef.current, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
    }
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d || d.moved) return;

    if (placing) {
      const w = toWorld(e.clientX, e.clientY);
      const node = engine.addNode(placing, Math.round(w.x), Math.round(w.y));
      sfx.play('click');
      setPlacing(null);
      setCursor(null);
      onSelect(node.id);
      return;
    }
    if (d.kind === 'node') {
      if (tool === 'delete') {
        engine.removeNode(d.id);
        if (selectedId === d.id) onSelect(null);
      } else if (tool === 'link') {
        if (!linkFrom) setLinkFrom(d.id);
        else if (linkFrom !== d.id) {
          const result = engine.addLink(linkFrom, d.id);
          if (typeof result === 'string') {
            engine.log('SYSTEM', 'warn', result);
            sfx.play('buzz');
          }
          setLinkFrom(null);
          setCursor(null);
        }
      } else onSelect(d.id);
    } else if (d.kind === 'link') {
      if (tool === 'delete') engine.removeLink(d.id);
    } else {
      setLinkFrom(null);
      setCursor(null);
      if (tool === 'select') onSelect(null);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData(DRAG_TYPE) as NodeKind;
    if (!NODE_KINDS.includes(kind)) return;
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    const node = engine.addNode(kind, Math.round(w.x), Math.round(w.y));
    sfx.play('click');
    onSelect(node.id);
  };

  // ── render ─────────────────────────────────────────────────────────────────

  const nodeById = new Map(engine.nodes.map((n) => [n.id, n]));
  const linkSource = linkFrom ? nodeById.get(linkFrom) : undefined;
  const hint = placing
    ? `Click anywhere on the canvas to place the ${KIND_META[placing].short.toLowerCase()} · Esc to cancel`
    : tool === 'link'
      ? linkFrom
        ? 'Now click the node to connect to · Esc to cancel'
        : 'Connect mode — click the first node'
      : tool === 'delete'
        ? 'Delete mode — click a node or a link to remove it · Esc to exit'
        : null;

  return (
    <div
      ref={wrapRef}
      className={cx('absolute inset-0 overflow-hidden select-none', placing ? 'cursor-copy' : tool === 'link' ? 'cursor-crosshair' : tool === 'delete' ? 'cursor-not-allowed' : 'cursor-grab')}
      style={{
        backgroundColor: '#0b0d13',
        backgroundImage: 'radial-gradient(#1b2130 1.4px, transparent 1.6px)',
        backgroundSize: `${26 * view.k}px ${26 * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
      onDrop={onDrop}
    >
      <svg ref={svgRef} className="absolute inset-0 h-full w-full touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {engine.links.map((l) => {
            const a = nodeById.get(l.a.nodeId);
            const b = nodeById.get(l.b.nodeId);
            if (!a || !b) return null;
            const curve = linkCurve(a, b);
            const d = curvePath(curve);
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            // Labels sit a fixed distance from their node so they clear the tile at any link length.
            const at = (n: NetworkNode) => clamp((n.kind === 'switch' ? 48 : 82) / len, 0.1, 0.45);
            const labels = [
              { node: a, iface: a.interfaces.find((i) => i.id === l.a.ifaceId), t: at(a), below: a.kind === 'switch' },
              // On short links the far-end address drops below the wire so the two never collide.
              { node: b, iface: b.interfaces.find((i) => i.id === l.b.ifaceId), t: 1 - at(b), below: b.kind === 'switch' || (a.kind !== 'switch' && len < 260) },
            ];
            return (
              <g key={l.id} data-link={l.id} className="group">
                <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
                <path d={d} fill="none" stroke="#263047" strokeWidth={2.4} strokeLinecap="round" className={cx('transition-colors', tool === 'delete' ? 'group-hover:stroke-sig-red' : 'group-hover:stroke-edge-bright')} />
                <path d={d} fill="none" stroke={SIGNAL.cyan} strokeOpacity={0.16} strokeWidth={1} strokeDasharray="2 6" pointerEvents="none" />
                {labels.map(({ node, iface, t, below }) => {
                  if (!iface || node.kind === 'host' || node.kind === 'server') return null;
                  const p = curvePoint(curve, t);
                  const text = node.kind === 'switch' ? iface.name : iface.ip ? `${iface.ip}/${iface.prefix}` : `${iface.name} · no IP`;
                  return (
                    <text key={iface.id} x={p.x} y={below ? p.y + 14 : p.y - 7} textAnchor="middle" pointerEvents="none" className="font-mono text-[9px]" fill={node.kind === 'switch' ? '#5b6887' : iface.ip ? '#8fa0c4' : SIGNAL.amber} stroke="#0b0d13" strokeWidth={3} paintOrder="stroke">
                      {text}
                    </text>
                  );
                })}
              </g>
            );
          })}

          {linkSource && cursor && (
            <path d={curvePath(linkCurve(linkSource, cursor))} fill="none" stroke={SIGNAL.amber} strokeWidth={2} strokeDasharray="6 6" className="animate-march" pointerEvents="none" />
          )}

          {engine.nodes.map((n) => {
            const meta = KIND_META[n.kind];
            const selected = n.id === selectedId;
            const arming = n.id === linkFrom;
            return (
              <g key={n.id} data-node={n.id} transform={`translate(${n.x},${n.y})`} className={cx(tool === 'select' && !placing && 'cursor-pointer')}>
                {(selected || arming) && (
                  <rect x={-34} y={-34} width={68} height={68} rx={18} fill="none" stroke={arming ? SIGNAL.amber : meta.color} strokeWidth={1.5} strokeDasharray="5 5" className="animate-march" />
                )}
                <rect x={-27} y={-27} width={54} height={54} rx={13} fill="#10131c" stroke={meta.color} strokeOpacity={selected ? 1 : 0.75} strokeWidth={selected ? 2 : 1.4} />
                <rect x={-27} y={-27} width={54} height={54} rx={13} fill={meta.color} fillOpacity={selected ? 0.16 : 0.07} />
                <meta.Icon x={-13} y={-13} width={26} height={26} color={meta.color} strokeWidth={1.6} pointerEvents="none" />
                <text y={44} textAnchor="middle" pointerEvents="none" className="font-mono text-[11px] font-semibold" fill="#e6ebf5" stroke="#0b0d13" strokeWidth={3} paintOrder="stroke">
                  {n.hostname}
                </text>
                <text y={57} textAnchor="middle" pointerEvents="none" className="font-mono text-[9.5px]" fill="#7383a6" stroke="#0b0d13" strokeWidth={3} paintOrder="stroke">
                  {nodeSubtitle(n)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {engine.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-dashed border-edge-bright px-8 py-6 text-center">
            <p className="font-mono text-sm text-slate-300">Empty canvas</p>
            <p className="mt-1 text-xs text-slate-500">Drag a device from the palette on the left, or click one and then click here.</p>
          </div>
        </div>
      )}

      {/* device palette + tools */}
      <div className="absolute left-3 top-3 flex max-h-[calc(100%-24px)] w-[62px] flex-col gap-1 overflow-y-auto rounded-xl border border-edge bg-panel/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur">
        {NODE_KINDS.map((kind) => {
          const meta = KIND_META[kind];
          const active = placing === kind;
          return (
            <button
              key={kind}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, kind);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => {
                setTool('select');
                setLinkFrom(null);
                setPlacing(active ? null : kind);
              }}
              title={`${meta.label} — drag onto the canvas, or click then click the canvas`}
              className={cx('flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-1 py-1 transition-colors', active ? 'border-sig-cyan/70 bg-sig-cyan/10' : 'border-transparent hover:bg-raised')}
            >
              <meta.Icon size={20} color={meta.color} strokeWidth={1.7} />
              <span className="text-[9px] font-medium tracking-wide text-slate-400">{meta.short}</span>
            </button>
          );
        })}
        <div className="my-1 h-px bg-edge" />
        {(
          [
            { id: 'select', Icon: MousePointer2, label: 'Select / move (V)' },
            { id: 'link', Icon: Cable, label: 'Connect two nodes (C)' },
            { id: 'delete', Icon: Trash2, label: 'Delete a node or link' },
          ] as const
        ).map(({ id, Icon, label }) => (
          <button
            key={id}
            title={label}
            aria-label={label}
            onClick={() => {
              setPlacing(null);
              setLinkFrom(null);
              setTool(id);
            }}
            className={cx(
              'flex h-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
              tool === id && !placing ? (id === 'delete' ? 'border-sig-red/60 bg-sig-red/10 text-sig-red' : 'border-sig-cyan/60 bg-sig-cyan/10 text-sig-cyan') : 'border-transparent text-slate-400 hover:bg-raised hover:text-slate-200',
            )}
          >
            <Icon size={17} />
          </button>
        ))}
      </div>

      {/* zoom */}
      <div className="absolute bottom-3 left-[86px] flex items-center gap-0.5 rounded-lg border border-edge bg-panel/95 p-1 backdrop-blur">
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25)} className="rounded p-1.5 text-slate-400 hover:bg-raised hover:text-slate-100">
          <ZoomOut size={15} />
        </button>
        <span className="w-10 text-center font-mono text-[10px] text-slate-400">{Math.round(view.k * 100)}%</span>
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoomAt(1.25)} className="rounded p-1.5 text-slate-400 hover:bg-raised hover:text-slate-100">
          <ZoomIn size={15} />
        </button>
        <button
          title="Fit topology to view (F)"
          aria-label="Fit topology to view"
          onClick={() => {
            autoFit.current = true;
            fit();
          }}
          className="rounded p-1.5 text-slate-400 hover:bg-raised hover:text-slate-100"
        >
          <Maximize size={15} />
        </button>
      </div>

      {/* legend */}
      <div className="absolute bottom-3 right-3 hidden items-center gap-3 rounded-lg border border-edge bg-panel/95 px-3 py-1.5 font-mono text-[10px] text-slate-400 backdrop-blur md:flex">
        {[
          ['TCP/IP', SIGNAL.cyan],
          ['Allowed', SIGNAL.green],
          ['Dropped', SIGNAL.red],
          ['ARP / broadcast', SIGNAL.amber],
        ].map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
            {label}
          </span>
        ))}
      </div>

      {hint && (
        <div className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2 rounded-full border border-sig-amber/40 bg-panel/95 px-4 py-1.5 font-mono text-[11px] text-sig-amber shadow-lg">
          {hint}
        </div>
      )}

      {children}
    </div>
  );
}
