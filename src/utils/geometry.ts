export interface Point {
  x: number;
  y: number;
}

/** Cubic bezier control polygon: [start, control 1, control 2, end]. */
export type Curve = [Point, Point, Point, Point];

/**
 * S-curve between two node centres. The control points blend continuously
 * between a horizontal and a vertical bias, so links never snap while a node
 * is being dragged. Shared by the SVG link paths and the canvas packet layer.
 */
export function linkCurve(a: Point, b: Point): Curve {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sum = Math.abs(dx) + Math.abs(dy) || 1;
  const w = Math.abs(dx) / sum;
  return [
    { x: a.x, y: a.y },
    { x: a.x + dx * 0.5 * w, y: a.y + dy * 0.5 * (1 - w) },
    { x: b.x - dx * 0.5 * w, y: b.y - dy * 0.5 * (1 - w) },
    { x: b.x, y: b.y },
  ];
}

export function curvePath([p0, c1, c2, p3]: Curve): string {
  return `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p3.x},${p3.y}`;
}

export function curvePoint([p0, c1, c2, p3]: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
