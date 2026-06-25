import React, { useMemo, useState } from 'react';
import type { RecoveryFieldEntry, RecoverySlotFragment } from './recoveryInference';

interface RecoveryPreviewTreeProps {
  fragments: RecoverySlotFragment[];
}

type RecoveryPreviewTreeNode = RecoveryPreviewGroupNode | RecoveryPreviewFieldNode;

interface RecoveryPreviewBaseNode {
  key: string;
  label: string;
  depth: number;
}

interface RecoveryPreviewGroupNode extends RecoveryPreviewBaseNode {
  kind: 'group';
  children: RecoveryPreviewTreeNode[];
  provenCount: number;
  insufficientCount: number;
}

interface RecoveryPreviewFieldNode extends RecoveryPreviewBaseNode {
  kind: 'field';
  field: RecoveryFieldEntry;
}

interface MutableGroupNode {
  key: string;
  label: string;
  depth: number;
  children: Map<string, MutableGroupNode | RecoveryPreviewFieldNode>;
}

function buildRecoveryPreviewTree(fragments: RecoverySlotFragment[]): RecoveryPreviewTreeNode[] {
  const roots = new Map<string, MutableGroupNode | RecoveryPreviewFieldNode>();

  for (const fragment of fragments) {
    for (const field of fragment.fields) {
      const parts = splitRecoveryKey(field.key);
      const safeParts = parts.length > 0 ? parts : [field.fieldLabel || field.key];
      let siblings = roots;
      let path = '';

      safeParts.forEach((part, index) => {
        path = path ? `${path}-${part}` : part;
        const isLeaf = index === safeParts.length - 1;
        if (isLeaf) {
          siblings.set(`${path}\u0000${field.sourceTimestamp ?? field.source}`, {
            kind: 'field',
            key: `${path}\u0000${field.sourceTimestamp ?? field.source}`,
            label: part,
            depth: index,
            field,
          });
          return;
        }

        const current = siblings.get(path);
        let group: MutableGroupNode;
        if (current && 'children' in current) {
          group = current;
        } else {
          group = { key: path, label: part, depth: index, children: new Map() };
          siblings.set(path, group);
        }
        siblings = group.children;
      });
    }
  }

  return Array.from(roots.values()).map((node) => (
    'children' in node ? finalizeGroup(node) : node
  )).sort(compareTreeNodes);
}

function splitRecoveryKey(key: string): string[] {
  return key.split('-').map((part) => part.trim()).filter(Boolean);
}

function finalizeGroup(node: MutableGroupNode): RecoveryPreviewGroupNode {
  const children = Array.from(node.children.values()).map((child) => (
    'children' in child ? finalizeGroup(child) : child
  )).sort(compareTreeNodes);
  const provenCount = children.reduce((sum, child) => sum + (child.kind === 'field' ? (child.field.evidenceStatus === 'proven' ? 1 : 0) : child.provenCount), 0);
  const insufficientCount = children.reduce((sum, child) => sum + (child.kind === 'field' ? (child.field.evidenceStatus === 'evidence-insufficient' ? 1 : 0) : child.insufficientCount), 0);
  return {
    kind: 'group',
    key: node.key,
    label: node.label,
    depth: node.depth,
    children,
    provenCount,
    insufficientCount,
  };
}

function compareTreeNodes(left: RecoveryPreviewTreeNode, right: RecoveryPreviewTreeNode): number {
  return recoveryTreeLabelCompare(left.label, right.label) || left.key.localeCompare(right.key);
}

function recoveryTreeLabelCompare(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftNumeric = Number.isFinite(leftNumber) && String(leftNumber) === left;
  const rightNumeric = Number.isFinite(rightNumber) && String(rightNumber) === right;
  if (leftNumeric && rightNumeric) return leftNumber - rightNumber;
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left.localeCompare(right);
}

function defaultExpandedKeys(nodes: RecoveryPreviewTreeNode[]): Set<string> {
  const keys = new Set<string>();
  const visit = (node: RecoveryPreviewGroupNode) => {
    keys.add(node.key);
    node.children.forEach((child) => {
      if (child.kind === 'group') visit(child);
    });
  };
  nodes.forEach((node) => {
    if (node.kind === 'group') visit(node);
  });
  return keys;
}

function treeSignature(nodes: RecoveryPreviewTreeNode[]): string {
  const signatureForNode = (node: RecoveryPreviewTreeNode): string => (
    node.kind === 'group'
      ? `${node.key}[${node.children.map(signatureForNode).join(',')}]`
      : node.key
  );
  return nodes.map(signatureForNode).join('|');
}

export const RecoveryPreviewTree: React.FC<RecoveryPreviewTreeProps> = ({ fragments }) => {
  const nodes = useMemo(() => buildRecoveryPreviewTree(fragments), [fragments]);
  const treeState = useMemo(() => ({
    signature: treeSignature(nodes),
    defaultExpandedKeys: defaultExpandedKeys(nodes),
  }), [nodes]);
  const [expandedState, setExpandedState] = useState<{ signature: string; keys: Set<string> }>(() => ({
    signature: treeState.signature,
    keys: treeState.defaultExpandedKeys,
  }));
  const expandedKeys = expandedState.signature === treeState.signature ? expandedState.keys : treeState.defaultExpandedKeys;

  const toggle = (key: string) => {
    setExpandedState((current) => {
      const next = new Set(current.signature === treeState.signature ? current.keys : treeState.defaultExpandedKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { signature: treeState.signature, keys: next };
    });
  };

  return (
    <div className="recovery-preview-tree" role="tree" aria-label="回退 JSON 树预览">
      {nodes.map((node) => (
        <RecoveryPreviewTreeRow key={node.key} node={node} expandedKeys={expandedKeys} onToggle={toggle} />
      ))}
    </div>
  );
};

const RecoveryPreviewTreeRow: React.FC<{
  node: RecoveryPreviewTreeNode;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}> = ({ node, expandedKeys, onToggle }) => {
  const style = { '--recovery-tree-depth': node.depth } as React.CSSProperties;

  if (node.kind === 'group') {
    const expanded = expandedKeys.has(node.key);
    return (
      <>
        <div className="recovery-preview-tree__row recovery-preview-tree__row--group" style={style} role="treeitem" aria-expanded={expanded} aria-level={node.depth + 1}>
          <button type="button" className="recovery-preview-tree__toggle" onClick={() => onToggle(node.key)} aria-label={`${expanded ? '折叠' : '展开'} ${node.label}`}>
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
          <span className="recovery-preview-tree__key">{node.label}</span>
          <span className="recovery-preview-tree__brace">{'{'}</span>
          <span className="recovery-preview-tree__count">{node.children.length} 项 · 已证明 {node.provenCount}{node.insufficientCount > 0 ? ` · 证据不足 ${node.insufficientCount}` : ''}</span>
        </div>
        {expanded && (
          <div role="group">
            {node.children.map((child) => (
              <RecoveryPreviewTreeRow key={child.key} node={child} expandedKeys={expandedKeys} onToggle={onToggle} />
            ))}
            <div className="recovery-preview-tree__row recovery-preview-tree__row--end" style={style} aria-hidden="true">
              <span className="recovery-preview-tree__brace">{'}'}</span>
            </div>
          </div>
        )}
      </>
    );
  }

  const value = node.field.recoveryValue ?? '未知';
  const statusLabel = node.field.evidenceStatus === 'proven' ? '已证明' : '证据不足';
  return (
    <div className="recovery-preview-tree__row recovery-preview-tree__row--field" style={style} role="treeitem" aria-level={node.depth + 1}>
      <span className="recovery-preview-tree__spacer" aria-hidden="true" />
      <span className="recovery-preview-tree__key" title={node.field.key}>{node.label}</span>
      <span className="recovery-preview-tree__colon">:</span>
      <span className="recovery-preview-tree__value" title={value}>{value}</span>
      <span className={`recovery-preview-tree__status recovery-preview-tree__status--${node.field.evidenceStatus}`}>{statusLabel}</span>
    </div>
  );
};
