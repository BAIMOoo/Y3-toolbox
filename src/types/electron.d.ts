export interface ElectronAPI {
  openFileDialog: () => Promise<string | null>;
  readFile: (filePath: string) => Promise<
    | { success: true; content: string; fileName: string; filePath?: string }
    | { success: false; error: string }
  >;
  openArchiveFileDialog: () => Promise<string | null>;
  openArchiveDirectoryDialog: () => Promise<string | null>;
  readArchiveInput: (inputPath: string) => Promise<
    | {
      success: true;
      inputPath: string;
      projectPath: string;
      archiveStoragePath: string;
      archiveConfigPath: string;
      storageData: unknown;
      archiveConfig: unknown | null;
      title: string;
    }
    | { success: false; error: string }
  >;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  onFileOpen: (callback: (filePath: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
