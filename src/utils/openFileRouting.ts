import { isCsvPath, isJsonPath } from './localInputContract';

export type OpenFileRoute =
  | { kind: 'diff-csv'; path: string }
  | { kind: 'local-archive-json'; path: string }
  | { kind: 'local-archive-directory'; path: string }
  | { kind: 'unsupported'; path: string; error: string };

export interface DroppedLocalInput {
  path?: string;
  name?: string;
  isDirectory?: boolean;
}

interface DroppedFileLike {
  name?: string;
  path?: unknown;
  type?: string;
}

interface DroppedEntryLike {
  name?: string;
  isDirectory?: boolean;
}

interface DroppedItemLike {
  kind?: string;
  getAsFile?: () => DroppedFileLike | null;
  webkitGetAsEntry?: () => DroppedEntryLike | null;
}

const UNSUPPORTED_FILE_MESSAGE = '不支持的文件类型：请选择 .csv 变动日志、.json Archive 文件或 Y3 项目文件夹';
const MISSING_ELECTRON_DIRECTORY_PATH_MESSAGE = '拖拽文件夹需要桌面应用读取本地路径；也可以点击“打开项目文件夹”';
const MISSING_ELECTRON_FILE_PATH_MESSAGE = '拖拽本地文件需要桌面应用读取路径；也可以点击页面内的打开或选择按钮';

export function classifyOpenFilePath(filePath: string): OpenFileRoute {
  return classifyLocalInput({ path: filePath });
}

export function classifyLocalInput(input: DroppedLocalInput): OpenFileRoute {
  const path = input.path?.trim() ?? '';
  const displayPath = path || input.name?.trim() || '';
  if (!path) {
    return {
      kind: 'unsupported',
      path: displayPath,
      error: input.isDirectory ? MISSING_ELECTRON_DIRECTORY_PATH_MESSAGE : MISSING_ELECTRON_FILE_PATH_MESSAGE,
    };
  }

  if (input.isDirectory) return { kind: 'local-archive-directory', path };

  if (isCsvPath(path)) return { kind: 'diff-csv', path };
  if (isJsonPath(path)) return { kind: 'local-archive-json', path };
  return {
    kind: 'unsupported',
    path,
    error: UNSUPPORTED_FILE_MESSAGE,
  };
}

export function getDroppedLocalInputs(dataTransfer: Pick<DataTransfer, 'items' | 'files'>): DroppedLocalInput[] {
  const itemInputs = Array.from(dataTransfer.items ?? [])
    .map((item) => droppedItemToLocalInput(item as DroppedItemLike))
    .filter((input): input is DroppedLocalInput => input !== null);

  if (itemInputs.length > 0) return itemInputs;

  return Array.from(dataTransfer.files ?? []).map((file) => droppedFileToLocalInput(file as DroppedFileLike, false));
}

export function routeRequiresLocalArchive(route: OpenFileRoute): route is Extract<OpenFileRoute, { kind: 'local-archive-json' | 'local-archive-directory' }> {
  return route.kind === 'local-archive-json' || route.kind === 'local-archive-directory';
}

export function shouldSkipRootDropRoute(input: DroppedLocalInput | undefined, childAlreadyHandled: boolean): boolean {
  if (!input) return childAlreadyHandled;

  const droppedCsv = !input.isDirectory && Boolean(
    (input.path && isCsvPath(input.path)) || (input.name && isCsvPath(input.name)),
  );

  // CSV import is intentionally page-scoped. The app shell should not behave like a
  // global CSV dropzone, even when Electron provides a real local path.
  if (droppedCsv) return true;

  return childAlreadyHandled;
}

function droppedItemToLocalInput(item: DroppedItemLike): DroppedLocalInput | null {
  if (item.kind && item.kind !== 'file') return null;
  const entry = item.webkitGetAsEntry?.() ?? null;
  const file = item.getAsFile?.() ?? null;
  if (!file && !entry) return null;

  return droppedFileToLocalInput(file, Boolean(entry?.isDirectory), entry?.name);
}

function droppedFileToLocalInput(file: DroppedFileLike | null, isDirectoryFromEntry: boolean, fallbackName?: string): DroppedLocalInput {
  const path = readElectronFilePath(file);
  const name = file?.name ?? fallbackName;
  return {
    path,
    name,
    isDirectory: isDirectoryFromEntry || inferDirectoryFromDroppedFile(file, path),
  };
}

function readElectronFilePath(file: DroppedFileLike | null): string | undefined {
  const candidate = file?.path;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : undefined;
}

function inferDirectoryFromDroppedFile(file: DroppedFileLike | null, filePath: string | undefined): boolean {
  if (!file || !filePath || file.type) return false;
  const name = file.name?.trim() ?? '';
  const leaf = filePath.split(/[\\/]/).pop() ?? filePath;
  return Boolean(name && leaf && !hasFileExtension(name) && !hasFileExtension(leaf));
}

function hasFileExtension(value: string): boolean {
  return /\.[^\\/.]+$/.test(value);
}
