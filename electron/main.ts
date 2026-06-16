import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ARCHIVE_CONFIG_FILE_NAME,
  ARCHIVE_FOLDER_NAME,
  ARCHIVE_STORAGE_FILE_NAME,
  isJsonPath,
} from '../src/archiveViewer/archiveFileContract';
import { findStartupOpenPath, type StartupOpenPathKind } from './startupOpenPath';
import { resolveSafeAgentArtifactDownloadUrl } from './agentArtifactDownload';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_AGENT_RUNNER_URL = typeof __AGENT_RUNNER_URL__ === 'string' ? __AGENT_RUNNER_URL__ : '';

function getConfiguredAgentRunnerUrl(): string {
  const configuredUrl = process.env.AGENT_RUNNER_URL || process.env.VITE_AGENT_RUNNER_URL || BUILD_AGENT_RUNNER_URL;
  if (configuredUrl) return configuredUrl;
  return app.isPackaged ? 'http://127.0.0.1:8790' : 'http://127.0.0.1:8791';
}

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#090b10',
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 开发环境加载 Vite dev server，生产环境加载打包后的 HTML。
  // WSL 启动 Windows electron.exe 时，VITE_DEV_SERVER_URL 有时不会进入 Electron 主进程；
  // 因此开发模式下额外探测默认 Vite 地址，避免加载 stale dist/index.html。
  const devServerUrl = await resolveDevServerUrl();
  if (devServerUrl) {
    await mainWindow.webContents.session.clearCache();
    mainWindow.loadURL(withDevCacheBust(devServerUrl));
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const isReloadShortcut = (input.control || input.meta) && key === 'r';
    const isHardReloadShortcut = (input.control || input.meta) && input.shift && key === 'r';
    const isF5 = input.key === 'F5';

    if (isReloadShortcut || isHardReloadShortcut || isF5) {
      event.preventDefault();
      if (isHardReloadShortcut) {
        void mainWindow?.webContents.session.clearCache().finally(() => {
          mainWindow?.webContents.reloadIgnoringCache();
        });
      } else {
        mainWindow?.webContents.reload();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}


// IPC: 自绘窗口控制按钮
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

// IPC: 原生 CSV 文件对话框（保持现有 diff 流程兼容）
ipcMain.handle('dialog:openFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: 本地 Archive JSON 文件对话框
ipcMain.handle('dialog:openArchiveFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Archive JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: 本地 Y3 项目文件夹对话框
ipcMain.handle('dialog:openArchiveDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: kkres 图片输入：选择一个图片文件夹
ipcMain.handle('dialog:openKkresImageDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: kkres 图片输入：选择一个或多个图片文件
ipcMain.handle('dialog:openKkresImageFiles', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga', 'psd'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths;
});


// IPC: kkres 图片输入：把本机图片/目录上传到任务服务暂存区，返回 staging: 标识。
ipcMain.handle('kkres:stageImageInputs', async (event, request: unknown) => {
  try {
    const identifiers = await stageKkresImageInputs(request, (progress) => {
      event.sender.send('kkres:stageImageProgress', progress);
    });
    return { success: true, identifiers };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// IPC: Agent artifact download handoff. Renderer may pass only URLs generated from
// the configured task service; main validates origin/path before starting download.
ipcMain.handle('agent-artifact:download', async (event, request: unknown) => {
  try {
    const url = resolveSafeAgentArtifactDownloadUrl(request, getConfiguredAgentRunnerUrl());
    event.sender.downloadURL(url.toString());
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// IPC: 读取文件内容
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  try {
    const content = await readUtf8TextFile(filePath);
    return { success: true, content, fileName: path.basename(filePath), filePath };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});


// IPC: Task-service JSON proxy. Packaged Electron loads from file://, so renderer fetches to
// a local or configured HTTP service can be CORS-blocked; keep the bridge narrow and pinned.
ipcMain.handle('agent-service:request', async (_event, request: unknown) => {
  try {
    const result = await proxyAgentServiceRequest(request);
    return { success: true, ...result };
  } catch (err: unknown) {
    return { success: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
});

// IPC: 读取本地 Archive 输入（只读，不写 archive 文件）。主进程校验 archive 边界后只返回已解析 JSON。
ipcMain.handle('archive:readInput', async (_event, inputPath: string) => {
  try {
    const resolved = await resolveArchiveInput(inputPath);
    const storageData = await readArchiveJson(resolved.archiveStoragePath, 'Selected JSON is not an archive JSON');
    validateArchiveStorageShape(storageData);

    let archiveConfig: unknown | null = null;
    try {
      archiveConfig = await readArchiveJson(resolved.archiveConfigPath, 'archive.json 不是有效 JSON');
    } catch (err) {
      if (!isMissingFileError(err)) throw err;
      archiveConfig = null;
    }

    return {
      success: true,
      inputPath,
      projectPath: resolved.projectPath,
      archiveStoragePath: resolved.archiveStoragePath,
      archiveConfigPath: resolved.archiveConfigPath,
      storageData,
      archiveConfig,
      title: path.basename(resolved.projectPath) || path.basename(resolved.archiveStoragePath),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// 处理文件关联启动
app.on('ready', () => {
  void createWindow();
  void sendStartupOpenPathWhenReady(process.argv, process.platform);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});


async function resolveDevServerUrl(): Promise<string | null> {
  if (process.env.VITE_DEV_SERVER_URL) return process.env.VITE_DEV_SERVER_URL;
  if (app.isPackaged) return null;

  const fallbackUrls = [
    // Only probe the isolated dev frontend port. Port 5173 may belong to the
    // public-runtime service and can otherwise make local Electron load stale UI.
    'http://127.0.0.1:5174/',
    'http://localhost:5174/',
  ];

  for (const fallbackUrl of fallbackUrls) {
    if (await canReachUrl(fallbackUrl)) return fallbackUrl;
  }

  return null;
}


function withDevCacheBust(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

function canReachUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 500);
    });
    request.setTimeout(800, () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}



const KKRES_STAGE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const KKRES_STAGE_MAX_FILES = 50;
const KKRES_STAGE_MAX_FILE_BYTES = 64 * 1024 * 1024;

type KkresStagePhase = 'collecting' | 'uploading' | 'complete' | 'failed';

interface KkresImageStageProgress {
  requestId: string;
  phase: KkresStagePhase;
  currentFile?: string;
  currentFileIndex: number;
  totalFiles: number;
  uploadedBytes: number;
  totalBytes: number;
  message: string;
}

type KkresStageProgressReporter = (progress: KkresImageStageProgress) => void;

async function stageKkresImageInputs(value: unknown, reportProgress?: KkresStageProgressReporter): Promise<string[]> {
  if (!isPlainObject(value) || !Array.isArray(value.inputs) || typeof value.ownerToken !== 'string') {
    throw new Error('Invalid kkres staging request');
  }
  const requestId = typeof value.requestId === 'string' && value.requestId.trim() ? value.requestId.trim() : `kkres-stage-${Date.now()}`;
  const ownerToken = value.ownerToken.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(ownerToken)) throw new Error('Owner token is invalid');
  const inputPaths = value.inputs
    .filter((input): input is string => typeof input === 'string')
    .map((input) => input.trim())
    .filter(Boolean);
  if (inputPaths.length === 0) return [];

  reportProgress?.({ requestId, phase: 'collecting', currentFileIndex: 0, totalFiles: 0, uploadedBytes: 0, totalBytes: 0, message: '正在扫描图片输入…' });
  const files = await collectKkresImageFiles(inputPaths);
  if (files.length === 0) throw new Error('未找到可上传的 kkres 图片；支持 png/jpg/webp/bmp。');
  if (files.length > KKRES_STAGE_MAX_FILES) throw new Error(`一次最多上传 ${KKRES_STAGE_MAX_FILES} 张 kkres 图片。`);

  const fileSizes = await Promise.all(files.map(async (filePath) => (await fs.stat(filePath)).size));
  const totalBytes = fileSizes.reduce((sum, size) => sum + size, 0);
  const identifiers: string[] = [];
  let uploadedBytes = 0;
  reportProgress?.({ requestId, phase: 'uploading', currentFileIndex: 0, totalFiles: files.length, uploadedBytes, totalBytes, message: `准备上传 ${files.length} 张图片…` });
  for (const [index, filePath] of files.entries()) {
    const beforeFileBytes = uploadedBytes;
    identifiers.push(await uploadKkresStagingImage(filePath, ownerToken, (fileUploadedBytes) => {
      reportProgress?.({
        requestId,
        phase: 'uploading',
        currentFile: path.basename(filePath),
        currentFileIndex: index + 1,
        totalFiles: files.length,
        uploadedBytes: beforeFileBytes + fileUploadedBytes,
        totalBytes,
        message: `正在上传 ${path.basename(filePath)} (${index + 1}/${files.length})`,
      });
    }));
    uploadedBytes += fileSizes[index] ?? 0;
  }
  reportProgress?.({ requestId, phase: 'complete', currentFileIndex: files.length, totalFiles: files.length, uploadedBytes: totalBytes, totalBytes, message: `已上传 ${files.length} 张图片` });
  return identifiers;
}

async function collectKkresImageFiles(inputPaths: string[]): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const inputPath of inputPaths) {
    const stat = await fs.stat(inputPath).catch(() => null);
    if (!stat) throw new Error(`图片路径不存在或不可读：${path.basename(inputPath) || inputPath}`);
    if (stat.isFile()) {
      await addKkresImageFile(inputPath, seen, files);
    } else if (stat.isDirectory()) {
      await walkKkresImageDirectory(inputPath, seen, files);
    } else {
      throw new Error(`图片路径不是文件或文件夹：${path.basename(inputPath) || inputPath}`);
    }
  }
  return files;
}

async function walkKkresImageDirectory(dirPath: string, seen: Set<string>, files: string[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length > KKRES_STAGE_MAX_FILES) return;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) await walkKkresImageDirectory(fullPath, seen, files);
    else if (entry.isFile()) await addKkresImageFile(fullPath, seen, files);
  }
}

async function addKkresImageFile(filePath: string, seen: Set<string>, files: string[]): Promise<void> {
  const extension = path.extname(filePath).toLowerCase();
  if (!KKRES_STAGE_IMAGE_EXTENSIONS.has(extension)) return;
  const realPath = await fs.realpath(filePath);
  if (seen.has(realPath)) return;
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) return;
  if (stat.size <= 0) throw new Error(`图片文件为空：${path.basename(filePath)}`);
  if (stat.size > KKRES_STAGE_MAX_FILE_BYTES) throw new Error(`图片文件超过 64MB：${path.basename(filePath)}`);
  seen.add(realPath);
  files.push(realPath);
}

async function uploadKkresStagingImage(filePath: string, ownerToken: string, onProgress?: (uploadedBytes: number) => void): Promise<string> {
  const stat = await fs.stat(filePath);
  const target = new URL('/api/kkres/staging', getConfiguredAgentRunnerUrl());
  const stream = createReadStream(filePath);
  let uploadedBytes = 0;
  stream.on('data', (chunk: Buffer) => {
    uploadedBytes += chunk.length;
    onProgress?.(Math.min(uploadedBytes, stat.size));
  });
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': contentTypeForImagePath(filePath),
      'Content-Length': String(stat.size),
      'X-Owner-Token': ownerToken,
      'X-Filename': encodeURIComponent(path.basename(filePath)),
    },
    body: stream as unknown as BodyInit,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const payload = await response.json().catch(() => ({})) as { identifier?: unknown; error?: unknown };
  if (!response.ok || typeof payload.identifier !== 'string') {
    throw new Error(typeof payload.error === 'string' ? payload.error : `图片上传失败：HTTP ${response.status}`);
  }
  return payload.identifier;
}

function contentTypeForImagePath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}


interface AgentServiceProxyResponse {
  status: number;
  payload: unknown;
}

async function proxyAgentServiceRequest(value: unknown): Promise<AgentServiceProxyResponse> {
  if (!isPlainObject(value) || typeof value.path !== 'string') throw new Error('Invalid task service request');
  const method = typeof value.method === 'string' ? value.method.toUpperCase() : 'GET';
  if (!['GET', 'POST'].includes(method)) throw new Error('Task service proxy only supports GET/POST');
  if (!value.path.startsWith('/api/') || value.path.includes('://')) throw new Error('Task service proxy path must be a local /api/ path');

  const baseUrl = getConfiguredAgentRunnerUrl();
  const configuredBase = new URL(baseUrl);
  if (!['http:', 'https:'].includes(configuredBase.protocol)) throw new Error('Task service proxy only supports http(s) URLs');
  const target = new URL(value.path, configuredBase);
  if (target.origin !== configuredBase.origin) throw new Error('Task service proxy target must stay on the configured origin');

  const response = await fetch(target, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(typeof value.ownerToken === 'string' ? { 'X-Owner-Token': value.ownerToken } : {}),
    },
    body: method === 'POST' ? JSON.stringify(value.body ?? {}) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

interface ResolvedArchiveInput {
  projectPath: string;
  archiveStoragePath: string;
  archiveConfigPath: string;
}

async function resolveArchiveInput(inputPath: string): Promise<ResolvedArchiveInput> {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('请选择 Y3 项目文件夹或 archive JSON 文件');
  }

  const stat = await fs.stat(inputPath);
  if (stat.isDirectory()) {
    const projectPath = path.basename(inputPath) === ARCHIVE_FOLDER_NAME ? path.dirname(inputPath) : inputPath;
    const archiveStoragePath = path.join(projectPath, ARCHIVE_FOLDER_NAME, ARCHIVE_STORAGE_FILE_NAME);
    await assertReadableJsonFile(archiveStoragePath, '请选择 Y3 项目文件夹，需包含 archive/archive_storage.json');
    return {
      projectPath,
      archiveStoragePath,
      archiveConfigPath: path.join(projectPath, ARCHIVE_FOLDER_NAME, ARCHIVE_CONFIG_FILE_NAME),
    };
  }

  if (!stat.isFile() || !isJsonPath(inputPath)) {
    throw new Error('本地 Archive 查看仅支持 .json 文件或 Y3 项目文件夹');
  }

  const parentPath = path.dirname(inputPath);
  const projectPath = path.basename(parentPath) === ARCHIVE_FOLDER_NAME ? path.dirname(parentPath) : parentPath;
  return {
    projectPath,
    archiveStoragePath: inputPath,
    archiveConfigPath: path.join(projectPath, ARCHIVE_FOLDER_NAME, ARCHIVE_CONFIG_FILE_NAME),
  };
}

async function assertReadableJsonFile(filePath: string, errorMessage: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || !isJsonPath(filePath)) throw new Error(errorMessage);
  } catch (err) {
    if (isMissingFileError(err)) throw new Error(errorMessage);
    throw err;
  }
}

async function readUtf8TextFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

async function readArchiveJson(filePath: string, shapeErrorMessage: string): Promise<unknown> {
  if (!isJsonPath(filePath)) throw new Error('本地 Archive 查看仅支持 .json 文件');
  try {
    return JSON.parse(await readUtf8TextFile(filePath)) as unknown;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`${path.basename(filePath)} 不是有效 JSON`);
    if (isMissingFileError(err)) throw err;
    throw new Error(shapeErrorMessage);
  }
}

function validateArchiveStorageShape(data: unknown): void {
  if (isFullStorageData(data) || isPlayerArchiveData(data)) return;
  throw new Error('Selected JSON is not an archive JSON');
}

function isFullStorageData(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  return Object.values(data).some((value) => isPlainObject(value) && isPlainObject(value.archive));
}

function isPlayerArchiveData(data: unknown): boolean {
  if (!isPlainObject(data) || Object.keys(data).length === 0) return false;
  return Object.values(data).every((value) => (
    isPlainObject(value)
    && Object.prototype.hasOwnProperty.call(value, 'data_value')
    && Object.prototype.hasOwnProperty.call(value, 'data_type')
  ));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFileError(err: unknown): boolean {
  return isPlainObject(err) && err.code === 'ENOENT';
}


async function sendStartupOpenPathWhenReady(argv: readonly string[], platform: NodeJS.Platform): Promise<void> {
  const filePath = await findStartupOpenPath(argv, platform, { statPath: statStartupOpenPath });
  if (!filePath || !mainWindow) return;

  // 等待渲染进程就绪后再发送文件路径；renderer 根据扩展名做模式感知路由。
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.send('file:open', filePath);
  });
}

async function statStartupOpenPath(candidatePath: string): Promise<StartupOpenPathKind> {
  try {
    const stat = await fs.stat(candidatePath);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'missing';
  } catch {
    return 'missing';
  }
}
