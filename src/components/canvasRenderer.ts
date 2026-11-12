import type { NetworkEngine } from '../engine/networkEngine';
import type { Link, NetworkNode } from '../types/network';
import { clamp, curvePoint, linkCurve, type Point } from '../utils/geometry';
import { SIGNAL, STATUS_COLOR } from './nodeMeta';

const TONE = { std: SIGNAL.cyan, ok: SIGNAL.green, arp: SIGNAL.amber } as const;
const MONO = '"JetBrains Mono Variable", ui-monospace, Consolas, monospace';
const EFFECT_MS = 900;
const TAU = Math.PI * 2;

function disc(ctx: CanvasRenderingContext2D, p: Point, r: number): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.fill();
}

/**
 * Immediate-mode layer drawn every animation frame above the SVG topology:
 * packet pulses with trails and direction arrows, drop bursts, delivery rings
 * and per-node status indicators. Reads engine state directly, so animation
 * never triggers a React render.
 */
export function renderOverlay(ctx: CanvasRenderingContext2D, engine: NetworkEngine): void {
  const t = engine.time;
  const nodes = new Map<string, NetworkNode>();
  for (const n of engine.nodes) nodes.set(n.id, n);
  const links = new Map<string, Link>();
  for (const l of engine.links) links.set(l.id, l);
  const inbound = new Map<string, number>();

  const along = (link: Link, fromNodeId: string, u: number): Point | null => {
    const a = nodes.get(link.a.nodeId);
    const b = nodes.get(link.b.nodeId);
    if (!a || !b) return null;
    return curvePoint(linkCurve(a, b), fromNodeId === link.a.nodeId ? u : 1 - u);
  };

  // ── node status ────────────────────────────────────────────────────────────
  for (const p of engine.packets) inbound.set(p.toNodeId, (inbound.get(p.toNodeId) ?? 0) + 1);
  ctx.textAlign = 'center';
  for (const n of engine.nodes) {
    const status = engine.statusOf(n, inbound.get(n.id) ?? 0);
    const color = STATUS_COLOR[status];
    if (status !== 'online') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(n.x - 31, n.y - 31, 62, 62, 16);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = `700 8px ${MONO}`;
      ctx.fillText(status.toUpperCase(), n.x, n.y - 37);
    }
    const led = { x: n.x + 21, y: n.y - 21 };
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;
    disc(ctx, led, 6.5);
    ctx.globalAlpha = 1;
    disc(ctx, led, 3.2);
  }

  // ── packets ────────────────────────────────────────────────────────────────
  ctx.textAlign = 'left';
  ctx.font = `600 9px ${MONO}`;
  ctx.lineJoin = 'round';
  for (const p of engine.packets) {
    if (t < p.start) continue;
    const link = links.get(p.linkId);
    if (!link) continue;
    const u = clamp((t - p.start) / p.duration, 0, 1);
    const head = along(link, p.fromNodeId, u);
    if (!head) continue;
    const lostAt = (p.end - p.start) / p.duration;
    const color = p.lost && u > lostAt - 0.12 ? SIGNAL.red : TONE[p.tone];
    ctx.fillStyle = color;

    for (let i = 1; i <= 7; i++) {
      const tu = u - i * 0.024;
      if (tu < 0) break;
      const tp = along(link, p.fromNodeId, tu)!;
      ctx.globalAlpha = 0.38 * (1 - i / 8);
      disc(ctx, tp, 3.4 * (1 - i / 11));
    }
    ctx.globalAlpha = 0.12;
    disc(ctx, head, 10);
    ctx.globalAlpha = 0.24;
    disc(ctx, head, 6.5);
    ctx.globalAlpha = 1;

    // directional arrow oriented along the curve tangent
    const ahead = along(link, p.fromNodeId, Math.min(1, u + 0.012))!;
    const behind = along(link, p.fromNodeId, Math.max(0, u - 0.012))!;
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(Math.atan2(ahead.y - behind.y, ahead.x - behind.x));
    ctx.beginPath();
    ctx.moveTo(7.5, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#0b0d13';
    ctx.lineWidth = 3;
    ctx.strokeText(p.label, head.x + 9, head.y - 9);
    ctx.fillText(p.label, head.x + 9, head.y - 9);
  }

  // ── transient effects ──────────────────────────────────────────────────────
  for (const e of engine.effects) {
    const age = t - e.t;
    if (age < 0 || age > EFFECT_MS) continue;
    const q = age / EFFECT_MS;
    const ease = 1 - (1 - q) * (1 - q);
    let at: Point | null = null;
    if (e.nodeId) at = nodes.get(e.nodeId) ?? null;
    else if (e.linkId && e.fromNodeId) {
      const link = links.get(e.linkId);
      at = link ? along(link, e.fromNodeId, e.frac ?? 0.5) : null;
    }
    if (!at) continue;

    if (e.type === 'burst') {
      ctx.strokeStyle = SIGNAL.red;
      ctx.fillStyle = SIGNAL.red;
      ctx.globalAlpha = (1 - q) * 0.9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 10 + 34 * ease, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * TAU + (e.t % 7);
        const r0 = 8 + 38 * ease;
        const r1 = r0 + 7 * (1 - q);
        ctx.beginPath();
        ctx.moveTo(at.x + Math.cos(ang) * r0, at.y + Math.sin(ang) * r0);
        ctx.lineTo(at.x + Math.cos(ang) * r1, at.y + Math.sin(ang) * r1);
        ctx.stroke();
      }
      // the "X" of a rejected packet
      const s = 6;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(at.x - s, at.y - s);
      ctx.lineTo(at.x + s, at.y + s);
      ctx.moveTo(at.x + s, at.y - s);
      ctx.lineTo(at.x - s, at.y + s);
      ctx.stroke();
    } else {
      ctx.strokeStyle = SIGNAL.green;
      ctx.lineWidth = 2.5 * (1 - q) + 0.5;
      for (const delay of [0, 0.25]) {
        const qq = clamp((q - delay) / (1 - delay), 0, 1);
        if (qq <= 0) continue;
        ctx.globalAlpha = (1 - qq) * 0.9;
        ctx.beginPath();
        ctx.arc(at.x, at.y, 30 + 34 * (1 - (1 - qq) * (1 - qq)), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
