export interface ElectronAPI {
  openFileDialog: () => Promise<string | null>;
  readFile: (filePath: string) => Promise<
    | { success: true; content: string; fileName: string; filePath?: string }
    | { success: false; error: string }
  >;
  openArchiveFileDialog: () => Promise<string | null>;
  openArchiveDirectoryDialog: () => Promise<string | null>;
  openKkresImageDirectoryDialog?: () => Promise<string | null>;
  openKkresImageFilesDialog?: () => Promise<string[]>;
  getAgentServiceBaseUrl?: () => string;
  agentServiceRequest: (request: { path: string; method?: string; body?: unknown; ownerToken?: string }) => Promise<
    | { success: true; status: number; payload: unknown }
    | { success: false; status: number; error: string }
  >;
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
