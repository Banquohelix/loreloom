import { describe, it, expect } from 'vitest';
import { computeGraphLayout } from '../../shared/graph-layout';

describe('computeGraphLayout', () => {
  it('is deterministic and holds linked nodes near the spring length', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` }));
    const edges = [{ sourceId: 'n0', targetId: 'n6' }];
    const first = computeGraphLayout(nodes, edges);
    expect(computeGraphLayout(nodes, edges)).toEqual(first);

    const pos = new Map(first.map((p) => [p.id, p]));
    const dist = (x: string, y: string) => Math.hypot(pos.get(x)!.x - pos.get(y)!.x, pos.get(x)!.y - pos.get(y)!.y);
    // n0 and n6 start on opposite sides of the ring; the spring pulls them to ~115px
    expect(dist('n0', 'n6')).toBeGreaterThan(60);
    expect(dist('n0', 'n6')).toBeLessThan(170);
  });

  it('lays out a 2,000-entry World quickly with finite positions', () => {
    const nodes = Array.from({ length: 2000 }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: 3000 }, (_, i) => ({
      sourceId: `n${i % 2000}`,
      targetId: `n${(i * 7 + 3) % 2000}`,
    }));
    const started = performance.now();
    const positions = computeGraphLayout(nodes, edges);
    const elapsed = performance.now() - started;
    expect(positions).toHaveLength(2000);
    expect(positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // The old O(n²) layout needed ~280M force calculations here; Barnes–Hut takes a few hundred ms
    expect(elapsed).toBeLessThan(5000);
  });

  it('handles empty and single-node graphs', () => {
    expect(computeGraphLayout([], [])).toEqual([]);
    const [only] = computeGraphLayout([{ id: 'x' }], []);
    expect(Number.isFinite(only.x)).toBe(true);
  });
});
