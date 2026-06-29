import React, { useMemo, useState } from 'react';
import type { RecoveryFieldEntry, RecoverySlotFragment } from './recoveryInference';

interface RecoveryPreviewTreeProps {
  fragments: RecoverySlotFragment[];
}

type RecoveryPreviewTreeNode = RecoveryPreviewGroupNode | RecoveryPreviewFieldNode | RecoveryPreviewValueGroupNode | RecoveryPreviewValueNode;

type ParsedRecoveryValue = Record<string, unknown> | unknown[];

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

interface RecoveryPreviewValueGroupNode extends RecoveryPreviewBaseNode {
  kind: 'value-group';
  children: RecoveryPreviewTreeNode[];
  field: RecoveryFieldEntry;
}

interface RecoveryPreviewFieldNode extends RecoveryPreviewBaseNode {
  kind: 'field';
  field: RecoveryFieldEntry;
}

interface RecoveryPreviewValueNode extends RecoveryPreviewBaseNode {
  kind: 'value';
  value: unknown;
  field: RecoveryFieldEntry;
}

interface MutableGroupNode {
  key: string;
  label: string;
  depth: number;
  children: Map<string, MutableGroupNode | RecoveryPreviewFieldNode | RecoveryPreviewValueGroupNode>;
}

function buildRecoveryPreviewTree(fragments: RecoverySlotFragment[]): RecoveryPreviewTreeNode[] {
  const roots = new Map<string, MutableGroupNode | RecoveryPreviewFieldNode | RecoveryPreviewValueGroupNode>();

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
          const nodeKey = `${path}\u0000${field.sourceTimestamp ?? field.source}`;
          siblings.set(nodeKey, createRecoveryFieldNode({ key: nodeKey, label: part, depth: index, field }));
          return;
        }

        const current = siblings.get(path);
        let group: MutableGroupNode;
        if (isMutableGroupNode(current)) {
          group = current;
        } else {
          group = { key: path, label: part, depth: index, children: new Map() };
          siblings.set(path, group);
        }
        siblings = group.children;
      });
    }
  }

  return Array.from(roots.values()).map(finalizePreviewNode).sort(compareTreeNodes);
}

function createRecoveryFieldNode(node: RecoveryPreviewBaseNode & { field: RecoveryFieldEntry }): RecoveryPreviewFieldNode | RecoveryPreviewValueGroupNode {
  const parsedValue = parseStructuredRecoveryValue(node.field.recoveryValue);
  if (parsedValue === null) {
    return { kind: 'field', ...node };
  }
  return {
    kind: 'value-group',
    ...node,
    children: buildValueNodes(parsedValue, node.field, node.key, node.depth + 1),
  };
}

function splitRecoveryKey(key: string): string[] {
  return key.split('-').map((part) => part.trim()).filter(Boolean);
}

function finalizePreviewNode(node: MutableGroupNode | RecoveryPreviewFieldNode | RecoveryPreviewValueGroupNode): RecoveryPreviewTreeNode {
  return isMutableGroupNode(node) ? finalizeGroup(node) : node;
}

function isMutableGroupNode(node: MutableGroupNode | RecoveryPreviewFieldNode | RecoveryPreviewValueGroupNode | undefined): node is MutableGroupNode {
  return Boolean(node && !('kind' in node));
}

function finalizeGroup(node: MutableGroupNode): RecoveryPreviewGroupNode {
  const children = Array.from(node.children.values()).map(finalizePreviewNode).sort(compareTreeNodes);
  const provenCount = children.reduce((sum, child) => sum + nodeProvenCount(child), 0);
  const insufficientCount = children.reduce((sum, child) => sum + nodeInsufficientCount(child), 0);
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

function buildValueNodes(value: ParsedRecoveryValue, field: RecoveryFieldEntry, parentKey: string, depth: number): RecoveryPreviewTreeNode[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => valueToNode(String(index), entry, field, `${parentKey}[${index}]`, depth));
  }
  return Object.keys(value).sort(recoveryTreeLabelCompare).map((entryKey) => valueToNode(entryKey, value[entryKey], field, `${parentKey}.${entryKey}`, depth));
}

function valueToNode(label: string, value: unknown, field: RecoveryFieldEntry, key: string, depth: number): RecoveryPreviewTreeNode {
  if (isPlainObject(value) || Array.isArray(value)) {
    return {
      kind: 'value-group',
      key,
      label,
      depth,
      field,
      children: buildValueNodes(value as ParsedRecoveryValue, field, key, depth + 1),
    };
  }
  return { kind: 'value', key, label, depth, value, field };
}

function parseStructuredRecoveryValue(value: string | null): ParsedRecoveryValue | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) return null;
  try {
    const parsed = new PythonLikeValueParser(text).parse();
    return isPlainObject(parsed) || Array.isArray(parsed) ? parsed as ParsedRecoveryValue : null;
  } catch {
    return null;
  }
}

class PythonLikeValueParser {
  private index = 0;

  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): unknown {
    const value = this.parseValue();
    this.skipWhitespace();
    if (!this.isAtEnd()) throw new Error('Unexpected trailing text');
    return value;
  }

  private parseValue(): unknown {
    this.skipWhitespace();
    const char = this.peek();
    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === '"' || char === "'") return this.parseString();
    return this.parseAtom();
  }

  private parseObject(): Record<string, unknown> {
    this.expect('{');
    const result: Record<string, unknown> = {};
    while (true) {
      this.skipWhitespace();
      if (this.peek() === '}') {
        this.index += 1;
        return result;
      }
      const key = String(this.parseValue());
      this.skipWhitespace();
      this.expect(':');
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.index += 1;
        continue;
      }
      if (this.peek() === '}') continue;
      throw new Error('Expected object separator');
    }
  }

  private parseArray(): unknown[] {
    this.expect('[');
    const result: unknown[] = [];
    while (true) {
      this.skipWhitespace();
      if (this.peek() === ']') {
        this.index += 1;
        return result;
      }
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.index += 1;
        continue;
      }
      if (this.peek() === ']') continue;
      throw new Error('Expected array separator');
    }
  }

  private parseString(): string {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") throw new Error('Expected string');
    this.index += 1;
    let result = '';
    while (!this.isAtEnd()) {
      const char = this.text[this.index++];
      if (char === quote) return result;
      if (char === '\\' && !this.isAtEnd()) {
        const next = this.text[this.index++];
        if (next === quote || next === '\\') result += next;
        else result += `\\${next}`;
      } else {
        result += char;
      }
    }
    throw new Error('Unclosed string');
  }

  private parseAtom(): unknown {
    const start = this.index;
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === ',' || char === '}' || char === ']') break;
      this.index += 1;
    }
    const raw = this.text.slice(start, this.index).trim();
    if (!raw) throw new Error('Expected atom');
    if (/^(true|True)$/i.test(raw)) return true;
    if (/^(false|False)$/i.test(raw)) return false;
    if (/^(nil|null|None)$/i.test(raw)) return null;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd() && /\s/.test(this.peek())) this.index += 1;
  }

  private expect(char: string): void {
    if (this.peek() !== char) throw new Error(`Expected ${char}`);
    this.index += 1;
  }

  private peek(): string {
    return this.text[this.index] ?? '';
  }

  private isAtEnd(): boolean {
    return this.index >= this.text.length;
  }
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
  const visit = (node: RecoveryPreviewTreeNode) => {
    if (!isExpandableNode(node)) return;
    keys.add(node.key);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return keys;
}

function treeSignature(nodes: RecoveryPreviewTreeNode[]): string {
  const signatureForNode = (node: RecoveryPreviewTreeNode): string => (
    isExpandableNode(node)
      ? `${node.key}[${node.children.map(signatureForNode).join(',')}]`
      : node.key
  );
  return nodes.map(signatureForNode).join('|');
}

function isExpandableNode(node: RecoveryPreviewTreeNode): node is RecoveryPreviewGroupNode | RecoveryPreviewValueGroupNode {
  return node.kind === 'group' || node.kind === 'value-group';
}

function nodeProvenCount(node: RecoveryPreviewTreeNode): number {
  if (node.kind === 'field') return node.field.evidenceStatus === 'proven' ? 1 : 0;
  if (node.kind === 'value') return 0;
  if (node.kind === 'value-group') return node.field.evidenceStatus === 'proven' ? 1 : 0;
  return node.provenCount;
}

function nodeInsufficientCount(node: RecoveryPreviewTreeNode): number {
  if (node.kind === 'field') return node.field.evidenceStatus === 'evidence-insufficient' ? 1 : 0;
  if (node.kind === 'value') return 0;
  if (node.kind === 'value-group') return node.field.evidenceStatus === 'evidence-insufficient' ? 1 : 0;
  return node.insufficientCount;
}


function formatEvidenceStatusLabel(field: RecoveryFieldEntry): string {
  if (field.evidenceStatus !== 'proven') return '证据不足';
  const sourceTime = formatRecoverySourceTimestamp(field.sourceTimestamp);
  return sourceTime ? `已证明 · 来源日志 ${sourceTime}` : '已证明';
}

function formatRecoverySourceTimestamp(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatRecoveryPreviewValue(value: unknown): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

  if (isExpandableNode(node)) {
    const expanded = expandedKeys.has(node.key);
    const isRecoveryGroup = node.kind === 'group';
    const countText = isRecoveryGroup
      ? `${node.children.length} 项 · 已证明 ${node.provenCount}${node.insufficientCount > 0 ? ` · 证据不足 ${node.insufficientCount}` : ''}`
      : `${node.children.length} 项 · ${formatEvidenceStatusLabel(node.field)}`;
    return (
      <>
        <div className="recovery-preview-tree__row recovery-preview-tree__row--group" style={style} role="treeitem" aria-expanded={expanded} aria-level={node.depth + 1}>
          <button type="button" className="recovery-preview-tree__toggle" onClick={() => onToggle(node.key)} aria-label={`${expanded ? '折叠' : '展开'} ${node.label}`}>
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
          <span className="recovery-preview-tree__key">{node.label}</span>
          <span className="recovery-preview-tree__brace">{'{'}</span>
          <span className="recovery-preview-tree__count">{countText}</span>
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

  const label = node.label;
  const value = node.kind === 'field'
    ? node.field.recoveryValue ?? '未知'
    : formatRecoveryPreviewValue(node.value);
  const statusLabel = node.kind === 'field'
    ? formatEvidenceStatusLabel(node.field)
    : null;
  const statusClass = node.kind === 'field' ? ` recovery-preview-tree__status--${node.field.evidenceStatus}` : '';
  const title = node.kind === 'field' ? node.field.key : label;
  return (
    <div className="recovery-preview-tree__row recovery-preview-tree__row--field" style={style} role="treeitem" aria-level={node.depth + 1}>
      <span className="recovery-preview-tree__spacer" aria-hidden="true" />
      <span className="recovery-preview-tree__key" title={title}>{label}</span>
      <span className="recovery-preview-tree__colon">:</span>
      <span className="recovery-preview-tree__value" title={value}>{value}</span>
      {statusLabel && <span className={`recovery-preview-tree__status${statusClass}`}>{statusLabel}</span>}
    </div>
  );
};
