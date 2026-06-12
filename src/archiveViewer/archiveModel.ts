import { ARCHIVE_CONFIG_FILE_NAME, ARCHIVE_STORAGE_FILE_NAME } from './archiveFileContract';

export { ARCHIVE_CONFIG_FILE_NAME, ARCHIVE_STORAGE_FILE_NAME };

const ARCHIVE_TYPE_NAMES: Record<number, string> = {
  0: 'str',
  1: 'bool',
  2: 'int',
  3: 'float',
  4: 'table',
};

export const ARCHIVE_TYPE_TABLE = 4;

export class ArchiveLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveLoadError';
  }
}

export interface ArchivePaths {
  inputPath?: string;
  projectPath?: string;
  archiveStoragePath?: string;
  archiveConfigPath?: string;
  title: string;
}

export interface SlotConfig {
  name?: string;
  type?: number | string;
  value?: unknown;
}

export interface SlotDoc {
  data_type?: number | string;
  data_value?: unknown;
}

export interface PlayerDoc {
  archive?: Record<string, SlotDoc>;
  [key: string]: unknown;
}

export interface ArchiveProjectInput {
  storageData: unknown;
  archiveConfig?: unknown;
  paths?: Partial<ArchivePaths>;
}

export interface ArchiveProject {
  paths: ArchivePaths;
  storageData: Record<string, PlayerDoc>;
  archiveConfig: Record<string, SlotConfig>;
}

export interface SlotView {
  slotId: string;
  name: string;
  slotType: number | string | undefined;
  typeName: string;
  value: unknown;
  valueSource: 'player' | 'default';
  summary: string;
}

export interface ArchiveTreeNode {
  label: string;
  value?: unknown;
  typeName?: string;
  children: ArchiveTreeNode[];
}

export function createArchiveProject(input: ArchiveProjectInput): ArchiveProject {
  const storageData = normalizeStorageData(input.storageData);
  const archiveConfig = normalizeArchiveConfig(extractArchiveSlots(input.archiveConfig));
  const title = input.paths?.title ?? input.paths?.archiveStoragePath?.split(/[\\/]/).pop() ?? 'Archive';
  return {
    paths: { title, ...input.paths },
    storageData,
    archiveConfig,
  };
}

export function getPlayers(project: ArchiveProject): string[] {
  return Object.keys(project.storageData).sort();
}

export function getPlayerSlots(project: ArchiveProject, playerName: string): SlotView[] {
  const playerData = project.storageData[playerName] ?? {};
  const playerArchive = isPlainObject(playerData.archive) ? playerData.archive as Record<string, SlotDoc> : {};
  const slotIds = Array.from(new Set([
    ...Object.keys(project.archiveConfig).map(String),
    ...Object.keys(playerArchive).map(String),
  ])).sort(slotSortCompare);

  return slotIds.map((slotId) => {
    const slotConfig = project.archiveConfig[slotId] ?? {};
    const slotDoc = isPlainObject(playerArchive[slotId]) ? playerArchive[slotId] : {};
    const hasPlayerValue = Object.prototype.hasOwnProperty.call(slotDoc, 'data_value');
    const value = hasPlayerValue ? slotDoc.data_value : slotConfig.value;
    const rawSlotType = slotConfig.type ?? slotDoc.data_type;
    const slotType = isSlotType(rawSlotType) ? rawSlotType : undefined;
    const typeName = typeNameFor(slotType);
    return {
      slotId,
      name: slotConfig.name ?? slotId,
      slotType,
      typeName,
      value,
      valueSource: hasPlayerValue ? 'player' : 'default',
      summary: slotType === ARCHIVE_TYPE_TABLE ? summarizeTableValue(value) : summarizeValue(value),
    };
  });
}

export function buildSlotTree(slot: SlotView): ArchiveTreeNode {
  return {
    label: `${slot.slotId} ${slot.name}`,
    typeName: slot.typeName,
    children: slot.slotType === ARCHIVE_TYPE_TABLE
      ? buildTableTree(slot.value)
      : [{ label: 'value', value: slot.value, typeName: slot.typeName, children: [] }],
  };
}

export function buildTableTree(value: unknown): ArchiveTreeNode[] {
  const parsed = parseTableValue(value);
  if (isPlainObject(parsed)) return buildMappingNodes(parsed as Record<string, unknown>);
  if (Array.isArray(parsed)) return buildSequenceNodes(parsed);
  return [{ label: 'raw', value, typeName: typeOfValue(value), children: [] }];
}

export function parseTableValue(value: unknown): unknown {
  if (isPlainObject(value) || Array.isArray(value)) return normalizeTextTree(value);
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return {};
  try {
    return normalizeTextTree(JSON.parse(text));
  } catch {
    // Try Lua-like table syntax below.
  }
  return parseLuaLikeTable(text);
}

export function normalizeStorageData(data: unknown): Record<string, PlayerDoc> {
  if (isFullStorageData(data)) return data as Record<string, PlayerDoc>;
  if (isPlayerArchiveData(data)) return { '当前 JSON': { archive: data as Record<string, SlotDoc> } };
  throw new ArchiveLoadError('请选择有效的 Archive JSON 文件');
}

export function isFullStorageData(data: unknown): data is Record<string, PlayerDoc> {
  if (!isPlainObject(data)) return false;
  return Object.values(data).some((value) => isPlainObject(value) && isPlainObject((value as PlayerDoc).archive));
}

export function isPlayerArchiveData(data: unknown): data is Record<string, SlotDoc> {
  if (!isPlainObject(data) || Object.keys(data).length === 0) return false;
  return Object.values(data).every((value) => (
    isPlainObject(value)
    && Object.prototype.hasOwnProperty.call(value, 'data_value')
    && Object.prototype.hasOwnProperty.call(value, 'data_type')
  ));
}

export function normalizeArchiveConfig(config: unknown): Record<string, SlotConfig> {
  if (!isPlainObject(config)) return {};
  const ret: Record<string, SlotConfig> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isPlainObject(value)) ret[String(key)] = value as SlotConfig;
  }
  return ret;
}

export function extractArchiveSlots(config: unknown): unknown {
  if (!isPlainObject(config)) return config;
  return isPlainObject(config.archive_slots) ? config.archive_slots : config;
}

export function slotSortCompare(left: string, right: string): number {
  const leftNumber = numericSlotId(left);
  const rightNumber = numericSlotId(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return String(left).localeCompare(String(right));
}

export function summarizeValue(value: unknown, maxLen = 80): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 3)}...`;
}

export function summarizeTableValue(value: unknown): string {
  const parsed = parseTableValue(value);
  if (isPlainObject(parsed)) return `${Object.keys(parsed).length} 项`;
  if (Array.isArray(parsed)) return `${parsed.length} 行`;
  return summarizeValue(value);
}

export function treeRowText(node: ArchiveTreeNode): string {
  return `${node.label}\t${node.typeName ?? ''}\t${node.value === undefined || node.value === null ? '' : String(node.value)}`;
}

function buildMappingNodes(mapping: Record<string, unknown>): ArchiveTreeNode[] {
  return Object.keys(mapping).sort(slotSortCompare).map((key) => valueToNode(key, mapping[key]));
}

function buildSequenceNodes(sequence: unknown[]): ArchiveTreeNode[] {
  return sequence.map((value, index) => valueToNode(String(index), value));
}

function valueToNode(label: string, value: unknown): ArchiveTreeNode {
  const typeName = typeOfValue(value);
  if (isPlainObject(value)) return { label, typeName, children: buildMappingNodes(value as Record<string, unknown>) };
  if (Array.isArray(value)) return { label, typeName, children: buildSequenceNodes(value) };
  return { label, value, typeName, children: [] };
}

function parseLuaLikeTable(text: string): unknown {
  const parser = new LuaLikeParser(text);
  try {
    const value = parser.parseValue();
    parser.skipWhitespace();
    return parser.isAtEnd() ? normalizeTextTree(value) : text;
  } catch {
    return text;
  }
}

class LuaLikeParser {
  private index = 0;

  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  parseValue(): unknown {
    this.skipWhitespace();
    if (this.peek() === '{') return this.parseTable();
    if (this.peek() === '"' || this.peek() === "'") return this.parseString();
    return this.parseAtom();
  }

  parseTable(): unknown {
    this.expect('{');
    const entries: Array<{ key?: string | number; value: unknown }> = [];
    let sequentialIndex = 1;
    while (true) {
      this.skipWhitespace();
      if (this.peek() === '}') {
        this.index++;
        break;
      }
      let key: string | number | undefined;
      let value: unknown;
      if (this.peek() === '[') {
        this.index++;
        key = this.parseKeyInsideBrackets();
        this.skipWhitespace();
        this.expect(']');
        this.skipWhitespace();
        this.expect('=');
        value = this.parseValue();
      } else {
        const checkpoint = this.index;
        const identifier = this.tryParseIdentifier();
        if (identifier !== null) {
          this.skipWhitespace();
          if (this.peek() === '=') {
            this.index++;
            key = identifier;
            value = this.parseValue();
          } else {
            this.index = checkpoint;
            value = this.parseValue();
            key = sequentialIndex++;
          }
        } else {
          value = this.parseValue();
          key = sequentialIndex++;
        }
      }
      entries.push({ key, value });
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.index++;
        continue;
      }
      if (this.peek() === '}') continue;
      if (this.isAtEnd()) throw new Error('Unclosed table');
    }

    const explicitKeys = entries.some((entry) => typeof entry.key === 'string' || !isSequentialNumericKey(entry.key));
    if (!explicitKeys) return entries.map((entry) => entry.value);
    const result: Record<string, unknown> = {};
    for (const entry of entries) result[String(entry.key)] = entry.value;
    return result;
  }

  parseKeyInsideBrackets(): string | number {
    this.skipWhitespace();
    if (this.peek() === '"' || this.peek() === "'") return this.parseString();
    const atom = this.parseAtom();
    return typeof atom === 'number' || typeof atom === 'string' ? atom : String(atom);
  }

  parseString(): string {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") throw new Error('Expected string');
    this.index++;
    let result = '';
    while (!this.isAtEnd()) {
      const char = this.text[this.index++];
      if (char === quote) return result;
      if (char === '\\' && !this.isAtEnd()) {
        const next = this.text[this.index++];
        if (next === 'n') result += '\n';
        else if (next === 't') result += '\t';
        else result += next;
      } else {
        result += char;
      }
    }
    throw new Error('Unclosed string');
  }

  parseAtom(): unknown {
    this.skipWhitespace();
    const start = this.index;
    let depth = 0;
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (depth === 0 && (char === ',' || char === '}' || char === ']')) break;
      if (char === '(') depth++;
      if (char === ')') depth--;
      this.index++;
    }
    const raw = this.text.slice(start, this.index).trim();
    if (!raw) throw new Error('Expected atom');
    if (/^true$/i.test(raw)) return true;
    if (/^false$/i.test(raw)) return false;
    if (/^nil$/i.test(raw)) return null;
    const fix32 = raw.match(/^Fix32\(([^()]+)\)$/);
    if (fix32) return Number(fix32[1]);
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }

  tryParseIdentifier(): string | null {
    this.skipWhitespace();
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.index));
    if (!match) return null;
    this.index += match[0].length;
    return match[0];
  }

  skipWhitespace(): void {
    while (!this.isAtEnd() && /\s/.test(this.peek())) this.index++;
  }

  expect(char: string): void {
    if (this.peek() !== char) throw new Error(`Expected ${char}`);
    this.index++;
  }

  peek(): string {
    return this.text[this.index] ?? '';
  }

  isAtEnd(): boolean {
    return this.index >= this.text.length;
  }
}


function isSlotType(value: unknown): value is string | number | undefined {
  return value === undefined || typeof value === 'string' || typeof value === 'number';
}

function normalizeTextTree(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeTextTree);
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) result[String(key)] = normalizeTextTree(child);
    return result;
  }
  return value;
}

function typeNameFor(slotType: number | string | undefined): string {
  return typeof slotType === 'number' ? ARCHIVE_TYPE_NAMES[slotType] ?? String(slotType) : String(slotType ?? '');
}

function typeOfValue(value: unknown): string {
  if (Array.isArray(value)) return 'list';
  if (value === null) return 'NoneType';
  return typeof value === 'object' ? 'dict' : typeof value;
}

function numericSlotId(slotId: string): number | null {
  if (!/^-?\d+$/.test(String(slotId))) return null;
  return Number(slotId);
}

function isSequentialNumericKey(key: string | number | undefined): boolean {
  return typeof key === 'number' && Number.isInteger(key) && key > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
