export type ActiveView =
  | { kind: 'overview' }
  | { kind: 'art' }
  | { kind: 'graph' }
  | { kind: 'maps' }
  | { kind: 'moodboards' }
  | { kind: 'collection'; typeId: string }
  | { kind: 'entry'; entryId: string };

export interface WorkspaceTab {
  id: string;
  view: ActiveView;
}

export function viewKey(view: ActiveView): string {
  switch (view.kind) {
    case 'collection':
      return `collection:${view.typeId}`;
    case 'entry':
      return `entry:${view.entryId}`;
    default:
      return view.kind;
  }
}

export function openViewInTabs(
  tabs: WorkspaceTab[],
  activeTabId: string,
  view: ActiveView,
  openInNewTab = false
): { tabs: WorkspaceTab[]; activeTabId: string } {
  const key = viewKey(view);
  const existing = tabs.find((t) => viewKey(t.view) === key);
  if (existing) {
    return { tabs, activeTabId: existing.id };
  }

  if (openInNewTab || tabs.length === 0) {
    const newTab: WorkspaceTab = { id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, view };
    return { tabs: [...tabs, newTab], activeTabId: newTab.id };
  }

  const nextTabs = tabs.map((t) => (t.id === activeTabId ? { ...t, view } : t));
  return { tabs: nextTabs, activeTabId };
}

export function closeTabById(
  tabs: WorkspaceTab[],
  activeTabId: string,
  tabIdToClose: string
): { tabs: WorkspaceTab[]; activeTabId: string } {
  if (tabs.length <= 1) {
    const fallback: WorkspaceTab = { id: tabs[0]?.id ?? 'tab-root', view: { kind: 'overview' } };
    return { tabs: [fallback], activeTabId: fallback.id };
  }

  const idx = tabs.findIndex((t) => t.id === tabIdToClose);
  const remaining = tabs.filter((t) => t.id !== tabIdToClose);
  if (activeTabId !== tabIdToClose) {
    return { tabs: remaining, activeTabId };
  }

  const nextIdx = Math.max(0, Math.min(idx, remaining.length - 1));
  return { tabs: remaining, activeTabId: remaining[nextIdx].id };
}
