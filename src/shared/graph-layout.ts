/**
 * Force-directed layout for the World Lore Graph.
 * Repulsion uses a Barnes–Hut quadtree (O(n log n) per step instead of O(n²)), so a World with
 * thousands of entries lays out in well under a second. Deterministic: same input, same output.
 */

export interface LayoutNodeInput {
  id: string;
}

export interface LayoutEdgeInput {
  sourceId: string;
  targetId: string;
}

export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
}

const REPULSION = 5200;
const SPRING_LENGTH = 115;
const SPRING_K = 0.045;
const GRAVITY = 0.012;
const DAMPING = 0.78;
const THETA = 0.9; // Barnes–Hut accuracy: larger = faster, less exact

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Quad {
  x0: number;
  y0: number;
  size: number;
  mass: number;
  cx: number;
  cy: number;
  body: Body | null;
  children: Quad[] | null;
}

function makeQuad(x0: number, y0: number, size: number): Quad {
  return { x0, y0, size, mass: 0, cx: 0, cy: 0, body: null, children: null };
}

function insert(q: Quad, b: Body, depth = 0): void {
  if (q.mass === 0 && !q.children) {
    q.body = b;
    q.mass = 1;
    q.cx = b.x;
    q.cy = b.y;
    return;
  }
  if (!q.children) {
    const half = q.size / 2;
    q.children = [
      makeQuad(q.x0, q.y0, half),
      makeQuad(q.x0 + half, q.y0, half),
      makeQuad(q.x0, q.y0 + half, half),
      makeQuad(q.x0 + half, q.y0 + half, half),
    ];
    const existing = q.body;
    q.body = null;
    if (existing && depth < 40) insertIntoChild(q, existing, depth);
  }
  q.cx = (q.cx * q.mass + b.x) / (q.mass + 1);
  q.cy = (q.cy * q.mass + b.y) / (q.mass + 1);
  q.mass += 1;
  if (depth < 40) insertIntoChild(q, b, depth);
}

function insertIntoChild(q: Quad, b: Body, depth: number): void {
  const half = q.size / 2;
  const idx = (b.x >= q.x0 + half ? 1 : 0) + (b.y >= q.y0 + half ? 2 : 0);
  insert(q.children![idx], b, depth + 1);
}

function applyRepulsion(q: Quad, b: Body): void {
  if (q.mass === 0 || q.body === b) return;
  const dx = q.cx - b.x || 0.01;
  const dy = q.cy - b.y || 0.01;
  const distSq = dx * dx + dy * dy + 25;
  if (!q.children || (q.size * q.size) / distSq < THETA * THETA) {
    const dist = Math.sqrt(distSq);
    const force = (REPULSION * q.mass) / distSq;
    b.vx -= (dx / dist) * force;
    b.vy -= (dy / dist) * force;
    return;
  }
  for (const child of q.children) applyRepulsion(child, b);
}

export function computeGraphLayout(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[]): LayoutPosition[] {
  const count = nodes.length;
  if (count === 0) return [];

  const radius = Math.max(180, Math.min(360, count * 14));
  const bodies: Body[] = nodes.map((_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 };
  });
  const indexById = new Map(nodes.map((n, i) => [n.id, i]));
  const springs = edges
    .map((e) => [indexById.get(e.sourceId), indexById.get(e.targetId)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined);

  const iterations = Math.min(140, Math.max(60, count * 2));
  for (let iter = 0; iter < iterations; iter++) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of bodies) {
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x > maxX) maxX = b.x;
      if (b.y > maxY) maxY = b.y;
    }
    const size = Math.max(maxX - minX, maxY - minY, 1) + 1;
    const root = makeQuad(minX, minY, size);
    for (const b of bodies) insert(root, b);
    for (const b of bodies) applyRepulsion(root, b);

    for (const [ai, bi] of springs) {
      const a = bodies[ai];
      const b = bodies[bi];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - SPRING_LENGTH) * SPRING_K;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const b of bodies) {
      b.vx = (b.vx - b.x * GRAVITY) * DAMPING;
      b.vy = (b.vy - b.y * GRAVITY) * DAMPING;
      b.x += b.vx;
      b.y += b.vy;
    }
  }

  return nodes.map((n, i) => ({ id: n.id, x: bodies[i].x, y: bodies[i].y }));
}
