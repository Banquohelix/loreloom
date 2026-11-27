import { describe, it, expect } from 'vitest';
import { closeTabById, openViewInTabs, type WorkspaceTab } from '../../shared/tab-utils';

describe('TabUtils', () => {
  it('reuses existing tabs instead of duplicating and supports opening new tabs', () => {
    const initial: WorkspaceTab[] = [{ id: 't1', view: { kind: 'overview' } }];

    const r1 = openViewInTabs(initial, 't1', { kind: 'entry', entryId: 'e1' }, true);
    expect(r1.tabs).toHaveLength(2);
    expect(r1.activeTabId).toBe(r1.tabs[1].id);

    // Opening the same entry again focuses existing tab
    const r2 = openViewInTabs(r1.tabs, 't1', { kind: 'entry', entryId: 'e1' }, true);
    expect(r2.tabs).toHaveLength(2);
    expect(r2.activeTabId).toBe(r1.tabs[1].id);
  });

  it('activates an adjacent tab when closing the active tab and keeps at least one tab open', () => {
    const tabs: WorkspaceTab[] = [
      { id: 't1', view: { kind: 'overview' } },
      { id: 't2', view: { kind: 'maps' } },
      { id: 't3', view: { kind: 'art' } },
    ];

    const afterClose = closeTabById(tabs, 't2', 't2');
    expect(afterClose.tabs).toHaveLength(2);
    expect(afterClose.activeTabId).toBe('t3');

    const lastRemaining = closeTabById([{ id: 't1', view: { kind: 'art' } }], 't1', 't1');
    expect(lastRemaining.tabs).toHaveLength(1);
    expect(lastRemaining.tabs[0].view.kind).toBe('overview');
  });
});
