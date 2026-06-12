import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, List, Spin, Tabs, message } from 'antd';
import { CopyOutlined, FolderOpenOutlined, FileTextOutlined, SearchOutlined } from '@ant-design/icons';
import { buildSlotTree, getPlayerSlots, type ArchiveTreeNode, type SlotView } from './archiveModel';
import { useLocalArchiveViewer } from './useLocalArchiveViewer';

export interface LocalArchiveInitialOpen {
  id: number;
  path: string;
}

export const LocalArchiveViewer: React.FC<{ initialOpen?: LocalArchiveInitialOpen | null; onInitialPathConsumed?: () => void }> = ({ initialOpen, onInitialPathConsumed }) => {
  const state = useLocalArchiveViewer();
  const consumedInitialOpenIdRef = useRef<number | null>(null);
  const { openPath } = state;

  useEffect(() => {
    if (!initialOpen || consumedInitialOpenIdRef.current === initialOpen.id) return;
    consumedInitialOpenIdRef.current = initialOpen.id;
    void openPath(initialOpen.path).then(() => onInitialPathConsumed?.());
  }, [initialOpen, onInitialPathConsumed, openPath]);

  const selectedTree = useMemo(() => state.selectedSlot ? buildSlotTree(state.selectedSlot) : null, [state.selectedSlot]);
  const currentProject = state.currentTab?.project;
  const playerSlotCounts = useMemo(() => {
    if (!currentProject) return new Map<string, number>();
    return new Map(state.players.map((player) => [player, getPlayerSlots(currentProject, player).length]));
  }, [currentProject, state.players]);
  const sourceTitle = state.currentTab?.title ?? '未打开 Archive';
  const sourcePath = currentProject?.paths.archiveStoragePath ?? currentProject?.paths.inputPath ?? state.currentTab?.inputPath ?? '';

  const copySelected = async () => {
    if (!state.selectedSlot || !selectedTree) return;
    const readableJson = JSON.stringify(readableSlotJson(state.selectedSlot, selectedTree), null, 2);
    await navigator.clipboard?.writeText(readableJson);
    message.success('已复制当前 Slot 数据');
  };

  return (
    <div className="local-archive-viewer">
      <div className="local-archive-toolbar">
        <div className="local-archive-toolbar__copy">
          <div className="local-archive-toolbar__eyebrow">本地 Archive 查看</div>
          <div className="local-archive-toolbar__title-row">
            <span className="local-archive-toolbar__title">本地存档查看</span>
            <span className="archive-status-chip archive-status-chip--readonly">只读</span>
            <span className="archive-status-chip">项目文件夹 / Archive JSON</span>
          </div>
          <div className="local-archive-toolbar__path" title={sourcePath || undefined}>{sourceTitle}{sourcePath ? ` · ${sourcePath}` : ''}</div>
        </div>
        <div className="local-archive-toolbar__actions">
          <Button size="small" icon={<FileTextOutlined />} onClick={state.openArchiveFile}>打开 JSON</Button>
          <Button size="small" icon={<FolderOpenOutlined />} onClick={state.openArchiveDirectory}>打开项目文件夹</Button>
        </div>
      </div>

      {state.error && <Alert type="error" message={state.error} closable className="local-archive-alert" />}
      {state.loading && <Spin className="local-archive-loading" />}
      {state.tabs.length === 0 ? (
        <div className="local-archive-empty-state local-archive-empty-stage">
          <div className="local-archive-empty-card">
            <Empty description="打开 Y3 项目文件夹或 Archive JSON" />
            <div className="local-archive-empty-actions">
              <Button icon={<FileTextOutlined />} onClick={state.openArchiveFile}>打开 JSON</Button>
              <Button icon={<FolderOpenOutlined />} onClick={state.openArchiveDirectory}>打开项目文件夹</Button>
            </div>
          </div>
        </div>
      ) : (
        <Tabs
          type="editable-card"
          activeKey={state.currentTab?.key}
          onChange={(key) => state.setCurrentIndex(state.tabs.findIndex((tab) => tab.key === key))}
          onEdit={(targetKey, action) => {
            if (action === 'remove') state.closeTab(state.tabs.findIndex((tab) => tab.key === String(targetKey)));
          }}
          items={state.tabs.map((tab) => ({
            key: tab.key,
            label: tab.status === 'error' ? `! ${tab.title}` : tab.title,
            closable: true,
            children: tab.status === 'error' ? (
              <div className="local-archive-error-pane">
                <Alert type="error" message="打开 Archive 失败" description={`${tab.inputPath}\n${tab.error ?? ''}`} className="local-archive-tab-error" />
              </div>
            ) : (
              <div className="local-archive-grid">
                <Panel
                  title="玩家"
                  subtitle={`${state.players.length} 个玩家`}
                  className="local-archive-panel--players"
                >
                  <List
                    size="small"
                    dataSource={state.players}
                    renderItem={(player) => {
                      const selected = player === tab.selectedPlayer;
                      return (
                        <List.Item className="archive-list-item-reset">
                          <button
                            type="button"
                            onClick={() => state.setSelectedPlayer(player)}
                            aria-pressed={selected}
                            className={`archive-row-button archive-player-card${selected ? ' archive-player-card--selected' : ''}`}
                          >
                            <span className="archive-player-card__name">{player}</span>
                            <span className="archive-player-card__meta">{playerSlotCounts.get(player) ?? 0} 个 Slot</span>
                          </button>
                        </List.Item>
                      );
                    }}
                  />
                </Panel>

                <Panel
                  title="Slot 列表"
                  subtitle={`已显示 ${state.filteredSlots.length} / 共 ${state.slots.length}`}
                  className="local-archive-panel--slots"
                >
                  <div className="archive-slot-search">
                    <Input
                      size="small"
                      prefix={<SearchOutlined />}
                      placeholder="搜索 Slot ID、名称或类型"
                      value={tab.search}
                      onChange={(e) => state.setSearch(e.target.value)}
                      allowClear
                    />
                  </div>
                  <div className="archive-slot-list" role="list" aria-label="Archive Slot 列表">
                    {state.filteredSlots.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的 Slot" />
                    ) : state.filteredSlots.map((slot) => (
                      <SlotButton
                        key={slot.slotId}
                        slot={slot}
                        selected={state.selectedSlot?.slotId === slot.slotId}
                        onClick={() => state.setSelectedSlotId(slot.slotId)}
                      />
                    ))}
                  </div>
                </Panel>

                <Panel
                  title={state.selectedSlot ? `Slot ${state.selectedSlot.slotId}` : 'Slot 详情'}
                  subtitle={state.selectedSlot ? `${state.selectedSlot.name} · ${state.selectedSlot.typeName}` : '选择一个 Slot 查看详情'}
                  className="local-archive-panel--inspector"
                  extra={<Button size="small" icon={<CopyOutlined />} onClick={copySelected} disabled={!selectedTree}>复制</Button>}
                >
                  {state.selectedSlot && selectedTree ? (
                    <SlotInspector key={state.selectedSlot.slotId} slot={state.selectedSlot} tree={selectedTree} />
                  ) : (
                    <Empty description="请选择 Slot" />
                  )}
                </Panel>
              </div>
            ),
          }))}
          className="local-archive-tabs"
        />
      )}
    </div>
  );
};

const Panel: React.FC<{ title: string; subtitle?: string; extra?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, subtitle, extra, children, className }) => (
  <section className={`local-archive-panel ${className ?? ''}`.trim()}>
    <div className="local-archive-panel__header">
      <div>
        <div className="local-archive-panel__title">{title}</div>
        {subtitle && <div className="local-archive-panel__subtitle">{subtitle}</div>}
      </div>
      {extra && <div className="local-archive-panel__extra">{extra}</div>}
    </div>
    <div className="local-archive-panel__body">{children}</div>
  </section>
);

const SlotButton: React.FC<{ slot: SlotView; selected: boolean; onClick: () => void }> = ({ slot, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={`archive-row-button archive-slot-card${selected ? ' archive-slot-card--selected' : ''}`}
  >
    <span className="archive-slot-card__id">#{slot.slotId}</span>
    <span className="archive-slot-card__main">
      <span className="archive-slot-card__name">{slot.name}</span>
      <span className="archive-slot-card__summary">{slot.summary || '空值'}</span>
    </span>
    <span className="archive-slot-card__badges">
      <TypeBadge typeName={slot.typeName} />
    </span>
  </button>
);

const SlotInspector: React.FC<{ slot: SlotView; tree: ArchiveTreeNode }> = ({ slot, tree }) => {
  const treeSignature = useMemo(() => treeNodeSignature(tree), [tree]);
  const defaultExpandedKeys = useMemo(() => defaultExpandedNodeKeys(tree), [tree]);
  const [expandedState, setExpandedState] = useState<{ treeSignature: string; keys: Set<string> }>(() => ({
    treeSignature,
    keys: new Set(defaultExpandedKeys),
  }));
  const expandedKeys = expandedState.treeSignature === treeSignature
    ? expandedState.keys
    : new Set(defaultExpandedKeys);

  const toggleNode = (nodeKey: string) => {
    setExpandedState((current) => {
      const next = new Set(current.treeSignature === treeSignature ? current.keys : defaultExpandedKeys);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return { treeSignature, keys: next };
    });
  };

  return (
    <div className="archive-inspector">
      <div className="archive-inspector__summary-card">
        <div>
          <div className="archive-inspector__label">当前 Slot</div>
          <div className="archive-inspector__title">{slot.slotId} · {slot.name}</div>
        </div>
        <div className="archive-inspector__meta">
          <TypeBadge typeName={slot.typeName} />
        </div>
      </div>
      <div className="archive-inspector__table" role="treegrid" aria-label="Slot 字段">
        <div className="archive-inspector__head" role="row">
          <span role="columnheader">字段</span>
          <span role="columnheader">类型</span>
          <span role="columnheader">值</span>
        </div>
        <ArchiveTree node={tree} root expandedKeys={expandedKeys} onToggle={toggleNode} />
      </div>
    </div>
  );
};

const ArchiveTree: React.FC<{
  node: ArchiveTreeNode;
  depth?: number;
  nodeKey?: string;
  root?: boolean;
  expandedKeys: Set<string>;
  onToggle: (nodeKey: string) => void;
}> = ({ node, depth = 0, nodeKey = 'root', root = false, expandedKeys, onToggle }) => {
  const hasChildren = node.children.length > 0;
  const expanded = root || expandedKeys.has(nodeKey);
  const rowStyle = { '--archive-tree-depth': depth } as React.CSSProperties;
  return (
    <>
      {!root && (
        <div
          className={`archive-tree-row${hasChildren ? ' archive-tree-row--group' : ''}`}
          style={rowStyle}
          role="row"
          aria-level={depth + 1}
        >
          <span className="archive-tree-row__field" role="cell">
            {hasChildren ? (
              <button
                type="button"
                className="archive-tree-row__toggle"
                aria-expanded={expanded}
                aria-label={`${expanded ? '收起' : '展开'} ${node.label}`}
                onClick={() => onToggle(nodeKey)}
              >
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
              </button>
            ) : (
              <span className="archive-tree-row__toggle-spacer" aria-hidden="true" />
            )}
            <span className="archive-tree-row__label" title={node.label}>{node.label}</span>
          </span>
          <span className="archive-tree-row__type" role="cell">
            {node.typeName === 'dict' ? null : <TypeBadge typeName={node.typeName ?? ''} compact />}
          </span>
          <span className="archive-tree-row__value" role="cell" title={node.value !== undefined && node.value !== null ? String(node.value) : undefined}>
            {node.value !== undefined && node.value !== null ? String(node.value) : hasChildren ? childCountText(node) : ''}
          </span>
        </div>
      )}
      {expanded && node.children.map((child, index) => {
        const childKey = `${nodeKey}/${escapeTreeKey(child.label, index)}`;
        return (
          <ArchiveTree
            key={childKey}
            node={child}
            nodeKey={childKey}
            depth={root ? 0 : depth + 1}
            expandedKeys={expandedKeys}
            onToggle={onToggle}
          />
        );
      })}
    </>
  );
};

const TypeBadge: React.FC<{ typeName: string; compact?: boolean }> = ({ typeName, compact }) => {
  const normalized = normalizeTypeName(typeName);
  return <span className={`archive-type-badge archive-type-badge--${normalized}${compact ? ' archive-type-badge--compact' : ''}`}>{typeName || '未知'}</span>;
};

function treeNodeSignature(node: ArchiveTreeNode): string {
  return `${node.label}\u001e${node.typeName ?? ''}\u001e${node.value === undefined || node.value === null ? '' : String(node.value)}\u001e[${node.children.map(treeNodeSignature).join('\u001d')}]`;
}

function defaultExpandedNodeKeys(root: ArchiveTreeNode): string[] {
  const keys: string[] = [];
  collectExpandedNodeKeys(root, 'root', keys);
  return keys;
}

function collectExpandedNodeKeys(node: ArchiveTreeNode, nodeKey: string, keys: string[]): void {
  node.children.forEach((child, index) => {
    const childKey = `${nodeKey}/${escapeTreeKey(child.label, index)}`;
    if (child.children.length > 0) {
      keys.push(childKey);
      collectExpandedNodeKeys(child, childKey, keys);
    }
  });
}

function escapeTreeKey(label: string, index: number): string {
  return `${index}:${label.replaceAll('/', '//')}`;
}

function childCountText(node: ArchiveTreeNode): string {
  return `${node.children.length} 项`;
}

function normalizeTypeName(typeName: string): string {
  const text = typeName.toLowerCase();
  if (text === 'table' || text === 'dict' || text === 'list') return 'table';
  if (text === 'int' || text === 'float' || text === 'number') return 'number';
  if (text === 'bool' || text === 'boolean') return 'boolean';
  if (text === 'str' || text === 'string') return 'string';
  if (!text || text === 'nonetype') return 'empty';
  return 'other';
}

interface ReadableSlotJson {
  slotId: string;
  name: string;
  type: string;
  source: SlotView['valueSource'];
  summary: string;
  value: unknown;
}

function readableSlotJson(slot: SlotView, tree: ArchiveTreeNode): ReadableSlotJson {
  return {
    slotId: slot.slotId,
    name: slot.name,
    type: slot.typeName,
    source: slot.valueSource,
    summary: slot.summary,
    value: treeValue(tree),
  };
}

function treeValue(node: ArchiveTreeNode): unknown {
  if (node.children.length === 0) return node.value ?? null;
  if (node.children.length === 1 && node.children[0].label === 'value') return treeValue(node.children[0]);
  if (node.typeName === 'list') return node.children.map(treeValue);
  return Object.fromEntries(node.children.map((child) => [child.label, treeValue(child)]));
}
