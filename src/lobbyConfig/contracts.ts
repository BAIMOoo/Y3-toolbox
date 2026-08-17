export interface LobbyProjectFile<T> {
  path: string;
  exists: boolean;
  revision: string | null;
  config: T;
}

export interface LobbyProjectSnapshot {
  projectPath: string;
  projectName: string;
  match: LobbyProjectFile<unknown[]>;
  dungeon: LobbyProjectFile<Record<string, unknown>>;
  modes: Array<{ id: string; name: string }>;
  maps: Array<{ id: string; directory: string }>;
}

export interface SaveLobbyConfigRequest {
  projectPath: string;
  matchRevision: string | null;
  dungeonRevision: string | null;
  matchJson: string;
  dungeonJson: string;
}

export interface LobbyConfigRevisions {
  matchRevision: string;
  dungeonRevision: string;
}
