import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const BUILD_AGENT_RUNNER_URL = typeof __AGENT_RUNNER_URL__ === 'string' ? __AGENT_RUNNER_URL__ : '';

function getConfiguredAgentRunnerUrl(): string {
  const configuredUrl = process.env.AGENT_RUNNER_URL || process.env.VITE_AGENT_RUNNER_URL || BUILD_AGENT_RUNNER_URL;
  if (configuredUrl) return configuredUrl;
  return process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8791' : 'http://127.0.0.1:8790';
}

contextBridge.exposeInMainWorld('electronAPI', {
  // 打开原生文件对话框
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),

  // 读取文件内容
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),

  // 本地 Archive 只读打开/读取 API
  openArchiveFileDialog: () => ipcRenderer.invoke('dialog:openArchiveFile'),
  openArchiveDirectoryDialog: () => ipcRenderer.invoke('dialog:openArchiveDirectory'),
  readArchiveInput: (inputPath: string) => ipcRenderer.invoke('archive:readInput', inputPath),

  // kkres 图片输入辅助
  openKkresImageDirectoryDialog: () => ipcRenderer.invoke('dialog:openKkresImageDirectory'),
  openKkresImageFilesDialog: () => ipcRenderer.invoke('dialog:openKkresImageFiles'),
  stageKkresImageInputs: (request: { inputs: string[]; ownerToken: string; requestId?: string }) => ipcRenderer.invoke('kkres:stageImageInputs', request),
  onKkresImageStageProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on('kkres:stageImageProgress', handler);
    return () => ipcRenderer.removeListener('kkres:stageImageProgress', handler);
  },

  // Task service proxy for packaged file:// renderer builds
  getAgentServiceBaseUrl: getConfiguredAgentRunnerUrl,
  agentServiceRequest: (request: { path: string; method?: string; body?: unknown; ownerToken?: string }) => ipcRenderer.invoke('agent-service:request', request),
  downloadAgentArtifact: (request: { url: string }) => ipcRenderer.invoke('agent-artifact:download', request),

  // 自绘窗口控制
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // 监听文件关联打开事件
  onFileOpen: (callback: (filePath: string) => void) => {
    const handler = (_event: IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('file:open', handler);
    // 返回清理函数，防止内存泄漏
    return () => ipcRenderer.removeListener('file:open', handler);
  },
});
