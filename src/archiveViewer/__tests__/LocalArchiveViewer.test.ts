import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalArchiveViewer } from '../LocalArchiveViewer';

type TestChild = TestNode | string | number | boolean | null | undefined | TestChild[];

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  children: TestChild[];
}

const runtime = vi.hoisted(() => {
  type HoistedChild = HoistedNode | string | number | boolean | null | undefined | HoistedChild[];
  interface HoistedNode {
    type: unknown;
    props: Record<string, unknown>;
    children: HoistedChild[];
  }

  const Fragment = Symbol('Fragment');
  const fixtureState = {
    selectedPlayer: 'account_alpha',
    selectedSlotId: '1' as string | null,
    search: '',
  };
  let hookStates: unknown[] = [];
  let hookIndex = 0;
  let currentRenderKey = '';
  let lastRenderKey = '';

  function renderKey(): string {
    return `${fixtureState.selectedPlayer}:${fixtureState.selectedSlotId ?? 'auto'}:${fixtureState.search}`;
  }

  function resetHooks(): void {
    hookIndex = 0;
    effectIndex = 0;
    currentRenderKey = renderKey();
    if (currentRenderKey !== lastRenderKey) hookStates = [];
    lastRenderKey = currentRenderKey;
  }

  function clearHookStates(): void {
    hookStates = [];
    hookIndex = 0;
    currentRenderKey = '';
    lastRenderKey = '';
  }

  const effectDepsByKey = new Map<string, string[]>();
  let effectIndex = 0;

  function useEffect(effect: () => unknown, deps?: unknown[]): void {
    effectIndex += 1;
    const signature = JSON.stringify(deps ?? []);
    const previous = effectDepsByKey.get(currentRenderKey)?.[effectIndex - 1];
    if (previous === signature) return;
    const depsForRender = effectDepsByKey.get(currentRenderKey) ?? [];
    depsForRender[effectIndex - 1] = signature;
    effectDepsByKey.set(currentRenderKey, depsForRender);
    effect();
  }

  function useState<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void] {
    const index = hookIndex++;
    if (hookStates.length <= index) hookStates[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    const setState = (value: T | ((current: T) => T)) => {
      const current = hookStates[index] as T;
      hookStates[index] = typeof value === 'function' ? (value as (current: T) => T)(current) : value;
    };
    return [hookStates[index] as T, setState];
  }

  function normalizeChildren(children: unknown): HoistedChild[] {
    if (children === undefined) return [];
    return Array.isArray(children) ? children.flatMap(normalizeChildren) : [children as HoistedChild];
  }

  function h(type: unknown, props?: Record<string, unknown> | null, ...restChildren: unknown[]): HoistedNode | HoistedChild[] {
    const children = restChildren.length > 0 ? normalizeChildren(restChildren) : normalizeChildren(props?.children);
    const nextProps = { ...(props ?? {}), children };
    if (type === Fragment) return children;
    if (typeof type === 'function') return type(nextProps) as HoistedNode;
    return { type, props: nextProps, children };
  }

  return { Fragment, fixtureState, h, resetHooks, clearHookStates, useState, useEffect };
});

vi.mock('react', () => ({
  default: { createElement: runtime.h },
  createElement: runtime.h,
  useEffect: runtime.useEffect,
  useMemo: (factory: () => unknown) => factory(),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: runtime.useState,
}));

vi.mock('react/jsx-runtime', () => ({
  Fragment: runtime.Fragment,
  jsx: runtime.h,
  jsxs: runtime.h,
}));

vi.mock('antd', () => {
  const Empty = ({ description }: { description?: unknown }) => runtime.h('empty', { children: description });
  (Empty as typeof Empty & { PRESENTED_IMAGE_SIMPLE?: string }).PRESENTED_IMAGE_SIMPLE = 'simple';

  const List = ({ dataSource, renderItem }: { dataSource: unknown[]; renderItem: (item: unknown) => unknown }) => runtime.h('list', {
    children: dataSource.map((item) => renderItem(item)),
  });
  (List as typeof List & { Item?: (props: { children?: unknown; className?: string }) => unknown }).Item = ({ children, className }) => runtime.h('list-item', { className, children });

  return {
    Alert: ({ message, description }: { message?: unknown; description?: unknown }) => runtime.h('alert', { children: [message, description] }),
    Button: ({ children, disabled, icon, onClick }: { children?: unknown; disabled?: boolean; icon?: unknown; onClick?: () => void }) => runtime.h('button', { disabled, onClick, children: [icon, children] }),
    Empty,
    Input: ({ placeholder, prefix, value, onChange }: { placeholder?: string; prefix?: unknown; value?: string; onChange?: (event: { target: { value: string } }) => void }) => runtime.h('label', { children: [prefix, runtime.h('input', { placeholder, value, onChange })] }),
    List,
    Spin: () => runtime.h('spin', { children: 'loading' }),
    Tabs: ({ items }: { items: Array<{ children: unknown }> }) => runtime.h('tabs', { children: items[0]?.children }),
    message: { success: vi.fn() },
  };
});

vi.mock('@ant-design/icons', () => {
  const Icon = () => runtime.h('icon', {});
  return {
    CopyOutlined: Icon,
    FileTextOutlined: Icon,
    FolderOpenOutlined: Icon,
    SearchOutlined: Icon,
  };
});

vi.mock('../useLocalArchiveViewer', async () => {
  const model = await import('../archiveModel');
  const project = model.createArchiveProject({
    storageData: {
      account_alpha: {
        archive: {
          '1': { data_type: 2, data_value: 100 },
          '2': { data_type: 4, data_value: { '1001': { level: 5, name: 'knight' } } },
          '5': { data_type: 4, data_value: { outer: { inner: { leaf: 'hidden-until-expanded' } } } },
        },
      },
      account_beta: {
        archive: {
          '1': { data_type: 2, data_value: 250 },
          '4': { data_type: 0, data_value: 'beta-only' },
        },
      },
    },
    archiveConfig: {
      archive_slots: {
        '1': { name: 'Gold', type: 2, value: 0 },
        '2': { name: 'Hero Inventory', type: 4, value: {} },
        '3': { name: 'Tutorial Flag', type: 1, value: false },
        '5': { name: 'Very Long Slot Name That Should Stay Inside The Slot Card Without Pushing Badges Outside', type: 4, value: {} },
      },
    },
    paths: {
      inputPath: 'C:/Y3/Project/archive/archive_storage.json',
      archiveStoragePath: 'C:/Y3/Project/archive/archive_storage.json',
      title: 'archive_storage.json',
    },
  });

  return {
    useLocalArchiveViewer: () => {
      const players = model.getPlayers(project);
      const slots = model.getPlayerSlots(project, runtime.fixtureState.selectedPlayer);
      const filteredSlots = filterSlots(slots, runtime.fixtureState.search);
      const selectedSlot = selectedSlotFor(filteredSlots, runtime.fixtureState.selectedSlotId);
      const currentTab = {
        key: 'fixture-tab',
        inputPath: project.paths.inputPath ?? '',
        title: project.paths.title,
        status: 'loaded' as const,
        project,
        error: null,
        selectedPlayer: runtime.fixtureState.selectedPlayer,
        selectedSlotId: runtime.fixtureState.selectedSlotId,
        search: runtime.fixtureState.search,
      };

      return {
        tabs: [currentTab],
        currentIndex: 0,
        currentTab,
        loading: false,
        error: null,
        openArchiveFile: vi.fn(),
        openArchiveDirectory: vi.fn(),
        openBrowserArchiveFile: vi.fn(),
        openPath: vi.fn(),
        closeTab: vi.fn(),
        setCurrentIndex: vi.fn(),
        setSelectedPlayer: (player: string) => {
          runtime.fixtureState.selectedPlayer = player;
          runtime.fixtureState.selectedSlotId = null;
        },
        setSelectedSlotId: (slotId: string) => {
          runtime.fixtureState.selectedSlotId = slotId;
        },
        setSearch: (search: string) => {
          runtime.fixtureState.search = search;
        },
        players,
        slots,
        filteredSlots,
        selectedSlot,
      };
    },
  };

  function filterSlots(slots: import('../archiveModel').SlotView[], search: string): import('../archiveModel').SlotView[] {
    const text = search.trim().toLowerCase();
    if (!text) return slots;
    return slots.filter((slot) => `${slot.slotId} ${slot.name} ${slot.typeName} ${slot.summary}`.toLowerCase().includes(text));
  }

  function selectedSlotFor(slots: import('../archiveModel').SlotView[], selectedSlotId: string | null): import('../archiveModel').SlotView | null {
    if (!selectedSlotId) return slots[0] ?? null;
    return slots.find((slot) => slot.slotId === selectedSlotId) ?? slots[0] ?? null;
  }
});

function renderArchiveViewer(): TestNode {
  runtime.resetHooks();
  const rendered = materialize(LocalArchiveViewer({}) as unknown);
  if (!isTestNode(rendered)) throw new Error('LocalArchiveViewer did not render a test node');
  return rendered;
}

function materialize(value: unknown): TestChild {
  if (Array.isArray(value)) return value.map(materialize);
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return value as TestChild;
  if (isTestNode(value)) return { ...value, children: flattenChildren(value.children).map(materialize) };
  if (isReactElement(value)) {
    if (value.type === runtime.Fragment) return materialize(value.props.children);
    if (typeof value.type === 'function') return materialize(value.type(value.props));
    const children = normalizeMaterialChildren(value.props.children).map(materialize);
    return { type: value.type, props: { ...value.props, children }, children };
  }
  return undefined;
}

function normalizeMaterialChildren(children: unknown): unknown[] {
  if (children === undefined) return [];
  return Array.isArray(children) ? children.flatMap(normalizeMaterialChildren) : [children];
}

function isReactElement(value: unknown): value is { type: unknown; props: Record<string, unknown> } {
  return Boolean(value && typeof value === 'object' && '$$typeof' in value && 'type' in value && 'props' in value);
}

function isTestNode(value: unknown): value is TestNode {
  return Boolean(value && typeof value === 'object' && 'type' in value && 'children' in value && Array.isArray((value as { children?: unknown }).children));
}

function flattenChildren(children: TestChild[]): TestChild[] {
  return children.flatMap((child) => Array.isArray(child) ? flattenChildren(child) : [child]);
}

function textContent(child: TestChild): string {
  if (child === null || child === undefined || typeof child === 'boolean') return '';
  if (typeof child === 'string' || typeof child === 'number') return String(child);
  if (Array.isArray(child)) return flattenChildren(child).map(textContent).join('');
  return flattenChildren(child.children).map(textContent).join('');
}

function findAll(node: TestChild, predicate: (node: TestNode) => boolean): TestNode[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, predicate));
  if (!isTestNode(node)) return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...flattenChildren(node.children).flatMap((child) => findAll(child, predicate)),
  ];
}

function getByText(root: TestNode, text: string): TestNode {
  const found = findAll(root, (node) => textContent(node) === text)[0];
  if (!found) throw new Error(`Unable to find text: ${text}`);
  return found;
}

function queryByText(root: TestNode, text: string): TestNode | null {
  return findAll(root, (node) => textContent(node) === text)[0] ?? null;
}

function queryAllByText(root: TestNode, text: string): TestNode[] {
  return findAll(root, (node) => textContent(node) === text);
}

function getButtonByText(root: TestNode, text: string): TestNode {
  const found = findAll(root, (node) => node.type === 'button' && textContent(node).includes(text))[0];
  if (!found) throw new Error(`Unable to find button text: ${text}`);
  return found;
}

function getButtonByLabel(root: TestNode, label: string): TestNode {
  const found = findAll(root, (node) => node.type === 'button' && node.props['aria-label'] === label)[0];
  if (!found) throw new Error(`Unable to find button label: ${label}`);
  return found;
}

function queryButtonByLabel(root: TestNode, label: string): TestNode | null {
  return findAll(root, (node) => node.type === 'button' && node.props['aria-label'] === label)[0] ?? null;
}

function getInputByPlaceholder(root: TestNode, placeholder: string): TestNode {
  const found = findAll(root, (node) => node.type === 'input' && node.props.placeholder === placeholder)[0];
  if (!found) throw new Error(`Unable to find input placeholder: ${placeholder}`);
  return found;
}

function click(node: TestNode): void {
  const handler = node.props.onClick;
  if (typeof handler !== 'function') throw new Error('Node has no onClick handler');
  handler();
}

function changeInput(node: TestNode, value: string): void {
  const handler = node.props.onChange;
  if (typeof handler !== 'function') throw new Error('Node has no onChange handler');
  handler({ target: { value } });
}

beforeEach(() => {
  runtime.fixtureState.selectedPlayer = 'account_alpha';
  runtime.fixtureState.selectedSlotId = '1';
  runtime.fixtureState.search = '';
  runtime.clearHookStates();
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
    configurable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LocalArchiveViewer refreshed archive panels', () => {
  it('filters slots by search text', () => {
    let root = renderArchiveViewer();
    expect(getByText(root, 'Gold')).toBeDefined();
    expect(getByText(root, 'Hero Inventory')).toBeDefined();
    expect(getByText(root, 'Tutorial Flag')).toBeDefined();

    changeInput(getInputByPlaceholder(root, '搜索 Slot ID、名称或类型'), 'hero');
    root = renderArchiveViewer();

    expect(getByText(root, 'Hero Inventory')).toBeDefined();
    expect(queryByText(root, 'Gold')).toBeNull();
    expect(queryByText(root, 'Tutorial Flag')).toBeNull();
    expect(getByText(root, '已显示 1 / 共 4')).toBeDefined();
  });

  it('updates the visible slot list when the selected player changes', () => {
    let root = renderArchiveViewer();
    expect(queryAllByText(root, '100').length).toBeGreaterThan(0);
    expect(queryAllByText(root, '250')).toHaveLength(0);

    click(getButtonByText(root, 'account_beta'));
    root = renderArchiveViewer();

    expect(queryAllByText(root, '250').length).toBeGreaterThan(0);
    expect(getByText(root, '已显示 5 / 共 5')).toBeDefined();
    expect(getByText(root, 'beta-only')).toBeDefined();
    expect(queryAllByText(root, '100')).toHaveLength(0);
  });

  it('updates the inspector when a slot is selected', () => {
    let root = renderArchiveViewer();
    expect(getByText(root, '1 · Gold')).toBeDefined();

    click(getButtonByText(root, 'Hero Inventory'));
    root = renderArchiveViewer();

    expect(getByText(root, '2 · Hero Inventory')).toBeDefined();
    expect(getByText(root, '1001')).toBeDefined();
    expect(getByText(root, 'level')).toBeDefined();
    expect(getByText(root, '5')).toBeDefined();
    expect(getByText(root, 'name')).toBeDefined();
    expect(getByText(root, 'knight')).toBeDefined();
  });


  it('renders dict type cells blank while preserving non-dict type badges', () => {
    let root = renderArchiveViewer();
    click(getButtonByText(root, 'Hero Inventory'));
    root = renderArchiveViewer();

    const row1001 = findAll(root, (node) => node.props.className === 'archive-tree-row' || String(node.props.className ?? '').includes('archive-tree-row--group'))
      .find((node) => textContent(node).includes('1001'));
    expect(row1001).toBeDefined();
    const typeCells = findAll(row1001!, (node) => node.props.className === 'archive-tree-row__type');
    expect(typeCells).toHaveLength(1);
    expect(textContent(typeCells[0])).toBe('');
    expect(getByText(root, 'number')).toBeDefined();
    expect(getByText(root, 'string')).toBeDefined();
  });

  it('hides selected slot source badges from the inspector header', () => {
    const root = renderArchiveViewer();
    const inspectorMeta = findAll(root, (node) => node.props.className === 'archive-inspector__meta')[0];

    expect(inspectorMeta).toBeDefined();
    expect(textContent(inspectorMeta)).toBe('int');
    expect(findAll(inspectorMeta, (node) => String(node.props.className ?? '').includes('archive-source-badge'))).toHaveLength(0);
  });

  it('supports accessible tree disclosure with all containers expanded by default', () => {
    let root = renderArchiveViewer();
    click(getButtonByText(root, 'Very Long Slot Name'));
    root = renderArchiveViewer();

    const outerToggle = getButtonByLabel(root, '收起 outer');
    expect(outerToggle.props['aria-expanded']).toBe(true);
    const innerToggle = getButtonByLabel(root, '收起 inner');
    expect(innerToggle.props['aria-expanded']).toBe(true);
    expect(getByText(root, 'hidden-until-expanded')).toBeDefined();
    expect(queryButtonByLabel(root, '展开 leaf')).toBeNull();

    click(innerToggle);
    root = renderArchiveViewer();

    expect(getButtonByLabel(root, '展开 inner').props['aria-expanded']).toBe(false);
    expect(queryByText(root, 'hidden-until-expanded')).toBeNull();
  });

  it('resets tree expansion defaults when the selected slot changes', () => {
    let root = renderArchiveViewer();
    click(getButtonByText(root, 'Very Long Slot Name'));
    root = renderArchiveViewer();
    click(getButtonByLabel(root, '收起 inner'));
    root = renderArchiveViewer();
    expect(queryByText(root, 'hidden-until-expanded')).toBeNull();

    click(getButtonByText(root, 'Gold'));
    root = renderArchiveViewer();
    expect(getByText(root, '1 · Gold')).toBeDefined();

    click(getButtonByText(root, 'Very Long Slot Name'));
    root = renderArchiveViewer();
    expect(getButtonByLabel(root, '收起 inner').props['aria-expanded']).toBe(true);
    expect(getByText(root, 'hidden-until-expanded')).toBeDefined();
  });

  it('keeps readable JSON copy output independent from tree collapse state', async () => {
    let root = renderArchiveViewer();
    click(getButtonByText(root, 'Hero Inventory'));
    root = renderArchiveViewer();
    click(getButtonByLabel(root, '收起 1001'));
    root = renderArchiveViewer();
    expect(queryByText(root, 'knight')).toBeNull();

    click(getButtonByText(root, '复制'));

    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify({
      slotId: '2',
      name: 'Hero Inventory',
      type: 'table',
      source: 'player',
      summary: '1 项',
      value: {
        '1001': {
          level: 5,
          name: 'knight',
        },
      },
    }, null, 2));
  });

  it('copies the selected slot as readable formatted JSON', async () => {
    let root = renderArchiveViewer();
    click(getButtonByText(root, 'Hero Inventory'));
    root = renderArchiveViewer();

    click(getButtonByText(root, '复制'));

    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify({
      slotId: '2',
      name: 'Hero Inventory',
      type: 'table',
      source: 'player',
      summary: '1 项',
      value: {
        '1001': {
          level: 5,
          name: 'knight',
        },
      },
    }, null, 2));
  });

});
