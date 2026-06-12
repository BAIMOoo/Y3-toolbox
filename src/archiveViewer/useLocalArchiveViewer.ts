import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveLoadError,
  type ArchiveProject,
  type SlotView,
  createArchiveProject,
  getPlayerSlots,
  getPlayers,
} from './archiveModel';
import { nextIndexAfterClose, parseArchiveSession, serializeArchiveSession } from './archiveSession';

const SESSION_KEY = 'y3-local-archive-viewer-session-v1';
const WEB_ARCHIVE_INPUT_PREFIX = 'web-json:';
export const WEB_ARCHIVE_SESSION_INPUT_PREFIX = WEB_ARCHIVE_INPUT_PREFIX;
export const LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE = '当前环境无法直接读取本地路径。请使用桌面版打开 JSON 或项目文件夹，或点击“打开 JSON”选择单个文件';

type ArchiveTabStatus = 'loaded' | 'error';

export interface ArchiveTab {
  key: string;
  inputPath: string;
  title: string;
  status: ArchiveTabStatus;
  project: ArchiveProject | null;
  error: string | null;
  selectedPlayer: string | null;
  selectedSlotId: string | null;
  search: string;
}

export interface LocalArchiveViewerState {
  tabs: ArchiveTab[];
  currentIndex: number;
  currentTab: ArchiveTab | null;
  loading: boolean;
  error: string | null;
  openArchiveFile: () => Promise<void>;
  openArchiveDirectory: () => Promise<void>;
  openBrowserArchiveFile: (file: File) => Promise<void>;
  openPath: (inputPath: string) => Promise<void>;
  closeTab: (index: number) => void;
  setCurrentIndex: (index: number) => void;
  setSelectedPlayer: (player: string) => void;
  setSelectedSlotId: (slotId: string) => void;
  setSearch: (search: string) => void;
  players: string[];
  slots: SlotView[];
  filteredSlots: SlotView[];
  selectedSlot: SlotView | null;
}

export function useLocalArchiveViewer(): LocalArchiveViewerState {
  const [tabs, setTabs] = useState<ArchiveTab[]>([]);
  const [currentIndex, setCurrentIndexState] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restoredRef = useRef(false);
  const archiveOpenRequestIdRef = useRef(0);
  const browserArchiveOpenIdRef = useRef(0);
  const browserFilePickerRef = useRef<HTMLInputElement | null>(null);

  const currentTab = tabs[currentIndex] ?? null;

  const persist = useCallback((nextTabs: ArchiveTab[], nextIndex: number) => {
    const restorablePaths = nextTabs
      .map((tab) => tab.inputPath)
      .filter(shouldPersistArchiveInputPath);
    localStorage.setItem(SESSION_KEY, serializeArchiveSession(restorablePaths, nextIndex));
  }, []);

  const applyTabs = useCallback((updater: (tabs: ArchiveTab[], currentIndex: number) => [ArchiveTab[], number]) => {
    setTabs((prevTabs) => {
      const [nextTabs, nextIndex] = updater(prevTabs, currentIndex);
      const clamped = nextTabs.length === 0 ? 0 : Math.max(0, Math.min(nextIndex, nextTabs.length - 1));
      setCurrentIndexState(clamped);
      persist(nextTabs, clamped);
      return nextTabs;
    });
  }, [currentIndex, persist]);

  const openPath = useCallback((inputPath: string) => {
    const requestId = archiveOpenRequestIdRef.current + 1;
    archiveOpenRequestIdRef.current = requestId;
    if (!window.electronAPI?.readArchiveInput) {
      setError(LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE);
      localStorage.removeItem(SESSION_KEY);
      return Promise.resolve();
    }
    return loadAndOpenPath(inputPath, applyTabs, setLoading, setError, () => requestId === archiveOpenRequestIdRef.current);
  }, [applyTabs]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    if (!window.electronAPI?.readArchiveInput) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const session = parseArchiveSession(raw);
    if (session.tabs.length === 0) return;
    const requestId = archiveOpenRequestIdRef.current + 1;
    archiveOpenRequestIdRef.current = requestId;
    void (async () => {
      setLoading(true);
      const restoredTabs = await Promise.all(session.tabs.filter(Boolean).map(loadArchiveTab));
      if (requestId !== archiveOpenRequestIdRef.current) return;
      setTabs(restoredTabs);
      const nextIndex = restoredTabs.length === 0 ? 0 : Math.max(0, Math.min(session.current ?? 0, restoredTabs.length - 1));
      setCurrentIndexState(nextIndex);
      persist(restoredTabs, nextIndex);
      setLoading(false);
    })();
  }, [persist]);

  const openBrowserArchiveFile = useCallback((file: File) => {
    const requestId = archiveOpenRequestIdRef.current + 1;
    archiveOpenRequestIdRef.current = requestId;
    const browserInputId = browserArchiveOpenIdRef.current + 1;
    browserArchiveOpenIdRef.current = browserInputId;
    return loadAndOpenBrowserFile(file, browserInputId, applyTabs, setLoading, setError, () => requestId === archiveOpenRequestIdRef.current);
  }, [applyTabs]);

  const openArchiveFile = useCallback(async () => {
    if (window.electronAPI?.openArchiveFileDialog) {
      const filePath = await window.electronAPI.openArchiveFileDialog();
      if (filePath) await openPath(filePath);
      return;
    }

    setError(null);
    const input = browserFilePickerRef.current ?? createBrowserArchiveFileInput(openBrowserArchiveFile);
    browserFilePickerRef.current = input;
    input.value = '';
    input.click();
  }, [openBrowserArchiveFile, openPath]);

  const openArchiveDirectory = useCallback(async () => {
    if (!window.electronAPI?.openArchiveDirectoryDialog) {
      setError(LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE);
      return;
    }
    const dirPath = await window.electronAPI.openArchiveDirectoryDialog();
    if (dirPath) await openPath(dirPath);
  }, [openPath]);

  const closeTab = useCallback((index: number) => {
    applyTabs((prevTabs, prevIndex) => {
      const nextTabs = prevTabs.filter((_, i) => i !== index);
      return [nextTabs, nextIndexAfterClose(prevTabs.length, prevIndex, index)];
    });
  }, [applyTabs]);

  const setCurrentIndex = useCallback((index: number) => {
    const clamped = tabs.length === 0 ? 0 : Math.max(0, Math.min(index, tabs.length - 1));
    setCurrentIndexState(clamped);
    persist(tabs, clamped);
  }, [persist, tabs]);

  const updateCurrentTab = useCallback((patch: Partial<ArchiveTab>) => {
    applyTabs((prevTabs, prevIndex) => {
      if (!prevTabs[prevIndex]) return [prevTabs, prevIndex];
      const nextTabs = prevTabs.map((tab, index) => index === prevIndex ? { ...tab, ...patch } : tab);
      return [nextTabs, prevIndex];
    });
  }, [applyTabs]);

  const players = useMemo(() => currentTab?.project ? getPlayers(currentTab.project) : [], [currentTab]);
  const slots = useMemo(() => {
    if (!currentTab?.project || !currentTab.selectedPlayer) return [];
    return getPlayerSlots(currentTab.project, currentTab.selectedPlayer);
  }, [currentTab]);
  const filteredSlots = useMemo(() => {
    const text = currentTab?.search.trim().toLowerCase() ?? '';
    if (!text) return slots;
    return slots.filter((slot) => `${slot.slotId} ${slot.name} ${slot.typeName} ${slot.summary}`.toLowerCase().includes(text));
  }, [currentTab?.search, slots]);
  const selectedSlotId = currentTab?.selectedSlotId;
  const selectedSlot = useMemo(() => {
    if (!selectedSlotId) return filteredSlots[0] ?? null;
    return filteredSlots.find((slot) => slot.slotId === selectedSlotId) ?? filteredSlots[0] ?? null;
  }, [selectedSlotId, filteredSlots]);

  return {
    tabs,
    currentIndex,
    currentTab,
    loading,
    error,
    openArchiveFile,
    openArchiveDirectory,
    openBrowserArchiveFile,
    openPath,
    closeTab,
    setCurrentIndex,
    setSelectedPlayer: (player) => updateCurrentTab({ selectedPlayer: player, selectedSlotId: null }),
    setSelectedSlotId: (slotId) => updateCurrentTab({ selectedSlotId: slotId }),
    setSearch: (search) => updateCurrentTab({ search }),
    players,
    slots,
    filteredSlots,
    selectedSlot,
  };
}

async function loadArchiveTab(inputPath: string): Promise<ArchiveTab> {
  try {
    if (!window.electronAPI?.readArchiveInput) {
      throw new ArchiveLoadError(LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE);
    }
    const result = await window.electronAPI.readArchiveInput(inputPath);
    if (!result.success) throw new ArchiveLoadError(result.error);
    const storageData = result.storageData;
    const archiveConfig = result.archiveConfig ?? undefined;
    const project = createArchiveProject({
      storageData,
      archiveConfig,
      paths: {
        inputPath: result.inputPath,
        projectPath: result.projectPath,
        archiveStoragePath: result.archiveStoragePath,
        archiveConfigPath: result.archiveConfigPath,
        title: result.title,
      },
    });
    const players = getPlayers(project);
    const firstPlayer = players[0] ?? null;
    const firstSlot = firstPlayer ? getPlayerSlots(project, firstPlayer)[0]?.slotId ?? null : null;
    return {
      key: normalizeKey(result.archiveStoragePath),
      inputPath,
      title: result.title,
      status: 'loaded',
      project,
      error: null,
      selectedPlayer: firstPlayer,
      selectedSlotId: firstSlot,
      search: '',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      key: normalizeKey(inputPath),
      inputPath,
      title: inputPath.split(/[\\/]/).pop() || inputPath,
      status: 'error',
      project: null,
      error: message,
      selectedPlayer: null,
      selectedSlotId: null,
      search: '',
    };
  }
}

async function loadBrowserArchiveTab(file: File, inputPath: string): Promise<ArchiveTab> {
  try {
    const storageData = JSON.parse(await readBrowserTextFile(file)) as unknown;
    const project = createArchiveProject({
      storageData,
      paths: {
        inputPath,
        title: file.name || '未命名 JSON',
      },
    });
    const players = getPlayers(project);
    const firstPlayer = players[0] ?? null;
    const firstSlot = firstPlayer ? getPlayerSlots(project, firstPlayer)[0]?.slotId ?? null : null;
    return {
      key: inputPath,
      inputPath,
      title: file.name || '未命名 JSON',
      status: 'loaded',
      project,
      error: null,
      selectedPlayer: firstPlayer,
      selectedSlotId: firstSlot,
      search: '',
    };
  } catch (err) {
    const message = err instanceof SyntaxError ? `${file.name || '未命名 JSON'} 不是有效 JSON` : err instanceof Error ? err.message : String(err);
    return {
      key: inputPath,
      inputPath,
      title: file.name || '未命名 JSON',
      status: 'error',
      project: null,
      error: message,
      selectedPlayer: null,
      selectedSlotId: null,
      search: '',
    };
  }
}

function normalizeKey(path: string): string {
  return path.toLowerCase();
}

async function loadAndOpenPath(
  inputPath: string,
  applyTabs: (updater: (tabs: ArchiveTab[], currentIndex: number) => [ArchiveTab[], number]) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string | null) => void,
  isCurrentRequest: () => boolean,
): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const tab = await loadArchiveTab(inputPath);
    if (!isCurrentRequest()) return;
    applyTabs((prevTabs) => {
      const existingIndex = prevTabs.findIndex((item) => item.key === tab.key || item.inputPath === tab.inputPath);
      if (existingIndex >= 0) return [prevTabs, existingIndex];
      return [[...prevTabs, tab], prevTabs.length];
    });
  } catch (err) {
    if (!isCurrentRequest()) return;
    const message = err instanceof Error ? err.message : String(err);
    setError(message);
  } finally {
    if (isCurrentRequest()) setLoading(false);
  }
}

async function loadAndOpenBrowserFile(
  file: File,
  browserInputId: number,
  applyTabs: (updater: (tabs: ArchiveTab[], currentIndex: number) => [ArchiveTab[], number]) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string | null) => void,
  isCurrentRequest: () => boolean,
): Promise<void> {
  const inputPath = browserArchiveInputPath(browserInputId, file.name);
  setLoading(true);
  setError(null);
  try {
    const tab = await loadBrowserArchiveTab(file, inputPath);
    if (!isCurrentRequest()) return;
    applyTabs((prevTabs) => [[...prevTabs, tab], prevTabs.length]);
  } catch (err) {
    if (!isCurrentRequest()) return;
    const message = err instanceof Error ? err.message : String(err);
    setError(message);
  } finally {
    if (isCurrentRequest()) setLoading(false);
  }
}

function createBrowserArchiveFileInput(openBrowserArchiveFile: (file: File) => Promise<void>): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  input.setAttribute('aria-hidden', 'true');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void openBrowserArchiveFile(file);
  });
  document.body.appendChild(input);
  return input;
}

export function browserArchiveInputPath(id: number, fileName: string): string {
  const safeName = (fileName || 'selected.json').replace(/[\\/]/g, '_');
  return `${WEB_ARCHIVE_INPUT_PREFIX}${id}:${safeName}`;
}

export function isBrowserArchiveInputPath(inputPath: string): boolean {
  return inputPath.startsWith(WEB_ARCHIVE_INPUT_PREFIX);
}

export function shouldPersistArchiveInputPath(inputPath: string): boolean {
  return Boolean(inputPath) && !isBrowserArchiveInputPath(inputPath);
}

async function readBrowserTextFile(file: File): Promise<string> {
  const text = await file.text();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
