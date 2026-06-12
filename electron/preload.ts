import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 打开原生文件对话框
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),

  // 读取文件内容
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),

  // 本地 Archive 只读打开/读取 API
  openArchiveFileDialog: () => ipcRenderer.invoke('dialog:openArchiveFile'),
  openArchiveDirectoryDialog: () => ipcRenderer.invoke('dialog:openArchiveDirectory'),
  readArchiveInput: (inputPath: string) => ipcRenderer.invoke('archive:readInput', inputPath),

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
