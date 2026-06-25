// src/App.tsx
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { ConfigProvider, theme, Alert, Segmented } from 'antd';
import type { ThemeConfig } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import './App.css';
import { useArchiveData } from './hooks/useArchiveData';
import { FilterBar } from './components/FilterBar';
import { Timeline } from './components/Timeline';
import { ChangeList } from './components/ChangeList';
import { SnapshotView } from './components/SnapshotView';
import { ResizableSplit } from './components/ResizableSplit';
import { StatusBar } from './components/StatusBar';
import { EmptyState } from './components/EmptyState';
import { filterSnapshot } from './utils/filterSnapshot';
import { LocalArchiveViewer, type LocalArchiveInitialOpen } from './archiveViewer/LocalArchiveViewer';
import { AgentJobCenter } from './agentJobs/AgentJobCenter';
import { classifyOpenFilePath, classifyLocalInput, getDroppedLocalInputs, routeRequiresLocalArchive, shouldSkipRootDropRoute, type OpenFileRoute } from './utils/openFileRouting';
import { shouldShowDiffContextToolbar } from './utils/diffUiState';
import { RecoveryPanel } from './recovery/RecoveryPanel';
import type { Snapshot, SnapshotValue } from './types';

// Error Boundary to catch render crashes
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; errorKey: number }
> {
  state = { error: null as Error | null, errorKey: 0 };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Render crash:', error);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: 'var(--color-delete)', background: 'var(--bg-primary)', minHeight: '100vh', fontFamily: 'var(--font-mono)' }}>
          <h2 style={{ marginBottom: 16 }}>渲染错误</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', marginTop: 12, padding: 16, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text-muted)', marginTop: 8, fontSize: 12, padding: 16, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState((s) => ({ error: null, errorKey: s.errorKey + 1 }))}
            style={{ marginTop: 16, padding: '8px 20px', background: 'var(--accent-blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 500 }}
          >
            重试
          </button>
        </div>
      );
    }
    return <React.Fragment key={this.state.errorKey}>{this.props.children}</React.Fragment>;
  }
}

type AppMode = 'diff' | 'local-archive' | 'agent-jobs';
type DiffWorkspaceMode = 'compare' | 'recovery';
type UiTone = 'graphite' | 'paper';

const UI_TONE_STORAGE_KEY = 'archive-diff-ui-tone';
const UI_TONE_RENDER_VERSION = 'icon-tone-switch-v3';


const EMPTY_SNAPSHOT: Snapshot = Object.freeze({});

function countSnapshotKeys(obj: Record<string, SnapshotValue>): number {
  let count = 0;
  for (const key of Object.keys(obj)) {
    count++;
    const val = obj[key];
    if (typeof val === 'object' && val !== null) {
      count += countSnapshotKeys(val);
    }
  }
  return count;
}

const uiToneOptions: Array<{ label: React.ReactNode; value: UiTone; title: string }> = [
  { label: <MoonOutlined aria-hidden="true" />, value: 'graphite', title: '深灰模式' },
  { label: <SunOutlined aria-hidden="true" />, value: 'paper', title: '纸面模式' },
];

const uiToneThemes: Record<UiTone, ThemeConfig> = {
  graphite: {
    algorithm: theme.darkAlgorithm,
    token: {
      colorPrimary: '#9a9a9a',
      colorBgBase: '#0f1011',
      colorBgContainer: '#111213',
      colorBgElevated: '#151617',
      colorBorder: '#2a2b2c',
      colorBorderSecondary: '#242526',
      colorText: '#e6e6e6',
      colorTextSecondary: '#858585',
      colorTextTertiary: '#666666',
      borderRadius: 0,
      fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
  },
  paper: {
    algorithm: theme.defaultAlgorithm,
    token: {
      colorPrimary: '#1f1f1d',
      colorBgBase: '#fbfaf6',
      colorBgContainer: '#fbfaf6',
      colorBgElevated: '#ffffff',
      colorBorder: '#d8d3c8',
      colorBorderSecondary: '#e8e4da',
      colorText: '#1f1f1d',
      colorTextSecondary: '#6f6b62',
      colorTextTertiary: '#8d887d',
      borderRadius: 0,
      fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
  },
};

function readInitialUiTone(): UiTone {
  if (typeof window === 'undefined') return 'graphite';
  const stored = window.localStorage.getItem(UI_TONE_STORAGE_KEY);
  return stored === 'paper' || stored === 'graphite' ? stored : 'graphite';
}

function App() {
  const [mode, setMode] = useState<AppMode>('diff');
  const [uiTone, setUiTone] = useState<UiTone>(readInitialUiTone);
  const [pendingArchiveOpen, setPendingArchiveOpen] = useState<LocalArchiveInitialOpen | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);
  const openEventIdRef = useRef(0);
  const diffOpenRequestIdRef = useRef(0);
  const {
    timePoints,
    filteredTimePoints,
    filteredIndexMap,
    selectedIndex,
    filter,
    fileName,
    recoveryAid,
    recoveryAidConflict,
    loading,
    error,
    availableRootKeys,
    snapshotEngine,
    loadFile,
    loadFromText,
    setFilter,
    setSelectedIndex,
    goToPrev,
    goToNext,
    goToFirst,
    goToLast,
    downloadCleanCsv,
  } = useArchiveData();

  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [diffWorkspaceMode, setDiffWorkspaceMode] = useState<DiffWorkspaceMode>('compare');

  const currentTimePoint = useMemo(() => {
    return timePoints[selectedIndex] ?? null;
  }, [timePoints, selectedIndex]);

  // O(1) 查找替代原来的 .find()
  const filteredCurrentTP = useMemo(() => {
    return filteredIndexMap.get(selectedIndex) ?? null;
  }, [filteredIndexMap, selectedIndex]);

  const isRecoveryWorkspace = diffWorkspaceMode === 'recovery';

  const prevSnapshot = useMemo(() => {
    if (isRecoveryWorkspace) return EMPTY_SNAPSHOT;
    return snapshotEngine.getSnapshotAt(selectedIndex - 1);
  }, [snapshotEngine, selectedIndex, isRecoveryWorkspace]);

  const currentSnapshot = useMemo(() => {
    if (isRecoveryWorkspace) return EMPTY_SNAPSHOT;
    return snapshotEngine.getSnapshotAt(selectedIndex);
  }, [snapshotEngine, selectedIndex, isRecoveryWorkspace]);

  // Filtered snapshots — trim to selected rootKeys for SnapshotView. Recovery view does not render SnapshotView.
  const filteredPrevSnapshot = useMemo(
    () => (isRecoveryWorkspace ? EMPTY_SNAPSHOT : filterSnapshot(prevSnapshot, filter.rootKeys)),
    [prevSnapshot, filter.rootKeys, isRecoveryWorkspace],
  );

  const filteredCurrentSnapshot = useMemo(
    () => (isRecoveryWorkspace ? EMPTY_SNAPSHOT : filterSnapshot(currentSnapshot, filter.rootKeys)),
    [currentSnapshot, filter.rootKeys, isRecoveryWorkspace],
  );

  const statusBarKeyCount = useMemo(
    () => (isRecoveryWorkspace ? undefined : countSnapshotKeys(currentSnapshot)),
    [currentSnapshot, isRecoveryWorkspace],
  );

  const changeCounts = useMemo(() => {
    if (!currentTimePoint) return { creates: 0, updates: 0, deletes: 0, noops: 0 };
    let creates = 0, updates = 0, deletes = 0, noops = 0;
    for (const c of currentTimePoint.changes) {
      if (c.changeType === 'create') creates++;
      else if (c.changeType === 'update') updates++;
      else if (c.changeType === 'delete') deletes++;
      else if (c.changeType === 'noop') noops++;
    }
    return { creates, updates, deletes, noops };
  }, [currentTimePoint]);

  // 键盘快捷键支持
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (timePoints.length === 0) return;
    // 如果焦点在输入框内则不拦截
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        setSelectedIndex(Math.max(0, selectedIndex - 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        setSelectedIndex(Math.min(timePoints.length - 1, selectedIndex + 1));
        break;
      case 'Home':
        e.preventDefault();
        setSelectedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setSelectedIndex(timePoints.length - 1);
        break;
    }
  }, [timePoints.length, selectedIndex, setSelectedIndex]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    window.localStorage.setItem(UI_TONE_STORAGE_KEY, uiTone);
  }, [uiTone]);

  const hasData = timePoints.length > 0;
  const showDiffContextToolbar = shouldShowDiffContextToolbar(hasData);

  const handleDiffFileSelected = useCallback((file: File) => {
    setDiffWorkspaceMode('compare');
    loadFile(file);
  }, [loadFile]);

  const openLocalArchiveRoute = useCallback((route: Extract<OpenFileRoute, { kind: 'local-archive-json' | 'local-archive-directory' }>) => {
    diffOpenRequestIdRef.current += 1;
    setShellError(null);
    openEventIdRef.current += 1;
    setPendingArchiveOpen({ path: route.path, id: openEventIdRef.current });
    setMode('local-archive');
  }, []);

  const openDiffCsvRoute = useCallback((route: Extract<OpenFileRoute, { kind: 'diff-csv' }>) => {
    if (!window.electronAPI?.readFile) {
      setShellError('Electron 桌面端才能通过本地路径拖拽读取 CSV；Web 模式请使用页面内上传按钮');
      return;
    }

    const requestId = diffOpenRequestIdRef.current + 1;
    diffOpenRequestIdRef.current = requestId;
    setShellError(null);
    setPendingArchiveOpen(null);
    setMode('diff');
    void window.electronAPI.readFile(route.path).then((result) => {
      if (requestId !== diffOpenRequestIdRef.current) return;
      if (result.success) {
        setDiffWorkspaceMode('compare');
        loadFromText(result.content, result.fileName);
      } else {
        setShellError(`无法打开文件: ${result.error}`);
      }
    }).catch((err: unknown) => {
      if (requestId !== diffOpenRequestIdRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setShellError(`无法打开文件: ${message}`);
    });
  }, [loadFromText]);

  const handleLocalInputRoute = useCallback((route: OpenFileRoute) => {
    if (routeRequiresLocalArchive(route)) {
      openLocalArchiveRoute(route);
      return;
    }
    if (route.kind === 'diff-csv') {
      openDiffCsvRoute(route);
      return;
    }
    diffOpenRequestIdRef.current += 1;
    setShellError(route.error);
  }, [openDiffCsvRoute, openLocalArchiveRoute]);

  useEffect(() => {
    if (!window.electronAPI?.onFileOpen) return;
    return window.electronAPI.onFileOpen((filePath: string) => {
      handleLocalInputRoute(classifyOpenFilePath(filePath));
    });
  }, [handleLocalInputRoute]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const childAlreadyHandled = event.defaultPrevented;
    event.preventDefault();
    event.stopPropagation();
    const [firstInput] = getDroppedLocalInputs(event.dataTransfer);
    if (shouldSkipRootDropRoute(firstInput, childAlreadyHandled)) return;
    if (!firstInput) {
      setShellError('未检测到可打开的本地文件或文件夹');
      return;
    }

    const route = classifyLocalInput(firstInput);
    // CSV import is scoped to the Change Log page controls (empty-state card or loaded toolbar),
    // not the global app shell. Keep the shell drop router for Local Archive JSON/folder inputs.
    if (route.kind === 'diff-csv') return;
    handleLocalInputRoute(route);
  }, [handleLocalInputRoute]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <ConfigProvider theme={uiToneThemes[uiTone]}>
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`app-shell app-shell--${mode} app-shell--tone-${uiTone}`}
        data-ui-tone={uiTone}
      >
        <header className="app-shell-header">
          <div className="app-brand" aria-label="Y3工具箱">
            <div className="app-brand-mark" aria-hidden="true">Y3</div>
            <div>
              <div className="app-brand-title">Y3工具箱</div>
              <div className="app-brand-subtitle">Y3 toolbox</div>
            </div>
          </div>
          <div data-testid="mode-switch" className="app-mode-nav">
            <Segmented
              size="small"
              value={mode}
              onChange={(value) => setMode(value as AppMode)}
              options={[
                { label: '变动日志', value: 'diff' },
                { label: '本地 Archive', value: 'local-archive' },
                { label: 'Agent 任务', value: 'agent-jobs' },
              ]}
            />
          </div>
          <div data-testid="tone-switch" className="app-tone-nav" aria-label={`界面主题切换 ${UI_TONE_RENDER_VERSION}`} title={uiTone === 'graphite' ? '当前：深灰模式' : '当前：纸面模式'}>
            <Segmented
              size="small"
              value={uiTone}
              onChange={(value) => setUiTone(value as UiTone)}
              options={uiToneOptions}
            />
          </div>
          <div className="app-window-controls" aria-label="窗口控制" title={window.electronAPI ? 'Electron window controls' : 'Electron API 未注入'}>
            <button type="button" className="app-window-button" aria-label="最小化" disabled={!window.electronAPI} onClick={() => void window.electronAPI?.minimizeWindow()}>—</button>
            <button type="button" className="app-window-button" aria-label="最大化或还原" disabled={!window.electronAPI} onClick={() => void window.electronAPI?.toggleMaximizeWindow()}>□</button>
            <button type="button" className="app-window-button app-window-button--close" aria-label="关闭" disabled={!window.electronAPI} onClick={() => void window.electronAPI?.closeWindow()}>×</button>
          </div>
        </header>
        {shellError && <Alert message={shellError} type="error" closable onClose={() => setShellError(null)} style={{ margin: '8px 16px 0' }} />}
        <main className={`app-content app-content--${mode}`}>
        {mode === 'local-archive' ? (
          <LocalArchiveViewer initialOpen={pendingArchiveOpen} onInitialPathConsumed={() => setPendingArchiveOpen(null)} />
        ) : mode === 'agent-jobs' ? (
          <AgentJobCenter />
        ) : (
          <>
        {error && (
          <Alert message={error} type="error" closable style={{ margin: '8px 16px 0' }} />
        )}

        {!showDiffContextToolbar ? (
          <EmptyState onFileSelected={handleDiffFileSelected} loading={loading} />
        ) : (
          <>
            <FilterBar
              filter={filter}
              onFilterChange={setFilter}
              availableRootKeys={availableRootKeys}
              onFileSelected={handleDiffFileSelected}
              loading={loading}
              fileName={fileName}
              onDownloadClean={downloadCleanCsv}
              onOpenRecovery={() => setDiffWorkspaceMode('recovery')}
            />

            <Timeline
              timePoints={timePoints}
              filteredTimePoints={filteredTimePoints}
              filteredIndexMap={filteredIndexMap}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
              onPrev={goToPrev}
              onNext={goToNext}
              onFirst={goToFirst}
              onLast={goToLast}
            />

            {isRecoveryWorkspace ? (
              <RecoveryPanel
                fileName={fileName}
                aid={recoveryAid}
                aidConflict={recoveryAidConflict}
                timePoints={timePoints}
                selectedIndex={selectedIndex}
                view="workspace"
                onClose={() => setDiffWorkspaceMode('compare')}
              />
            ) : (
              <ResizableSplit
                defaultRatio={0.4}
                left={
                  <ChangeList
                    timePoint={filteredCurrentTP}
                    selectedKey={highlightKey}
                    onSelectKey={setHighlightKey}
                  />
                }
                right={
                  <SnapshotView
                    prevSnapshot={filteredPrevSnapshot}
                    currentSnapshot={filteredCurrentSnapshot}
                    changes={filteredCurrentTP?.changes ?? []}
                    highlightKey={highlightKey}
                  />
                }
              />
            )}

            <StatusBar
              fileName={fileName}
              timePointCount={timePoints.length}
              selectedIndex={selectedIndex}
              currentChanges={changeCounts}
              keyCount={statusBarKeyCount}
              showSnapshotStats={!isRecoveryWorkspace}
            />
          </>
        )}
          </>
        )}
        </main>
      </div>
    </ConfigProvider>
  );
}

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
