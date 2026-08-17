import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LobbyProjectConflictError,
  LobbyProjectUserError,
  lobbyProjectErrorMessage,
  readLobbyProject,
  saveLobbyProject,
} from './electron/lobbyConfigFiles';

const temporaryDirectories: string[] = [];
const MAP_ID = '50377054694119407947881484918402159964';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('lobby configuration project files', () => {
  it('does not expose filesystem details from unexpected errors', () => {
    expect(lobbyProjectErrorMessage(
      new Error('EACCES: permission denied, open C:\\Users\\secret\\match.json'),
      '保存大厅配置失败',
    )).toBe('保存大厅配置失败');
    expect(lobbyProjectErrorMessage(
      new LobbyProjectUserError('match.json 不是有效 JSON'),
      '保存大厅配置失败',
    )).toBe('match.json 不是有效 JSON');
  });

  it('opens a source project with missing configs and preserves long map ids exactly', async () => {
    const projectPath = await createSourceProject();

    const snapshot = await readLobbyProject(projectPath);

    expect(snapshot.projectPath).toBe(projectPath);
    expect(snapshot.match.exists).toBe(false);
    expect(snapshot.match.config).toEqual([]);
    expect(snapshot.dungeon.exists).toBe(false);
    expect(snapshot.dungeon.config).toEqual({});
    expect(snapshot.maps).toEqual([{
      directory: 'BattleMap',
      id: MAP_ID,
    }]);
    expect(snapshot.modes).toEqual([{ id: '1002', name: '匹配模式' }]);
  });

  it('creates missing config files and rejects stale saves before changing either file', async () => {
    const projectPath = await createSourceProject();
    const initial = await readLobbyProject(projectPath);
    const matchJson = `${JSON.stringify([{
      game_mode: 1002,
      level_id: MAP_ID,
      teams: [8],
      diffuse_time: [10],
      sections: [{ max_score: 6900, min_player_num: 8 }],
    }], null, 4)}\n`;
    const dungeonJson = `${JSON.stringify({
      [MAP_ID]: {
        game_modes: {
          '1002': {
            enable_public: 0,
            enable_private: 1,
            max_player_num: 8,
            can_add_in_time: 120,
          },
        },
      },
    }, null, 4)}\n`;

    await saveLobbyProject({
      projectPath,
      matchRevision: initial.match.revision,
      dungeonRevision: initial.dungeon.revision,
      matchJson,
      dungeonJson,
    });
    expect(await fs.readFile(path.join(projectPath, 'match.json'), 'utf8')).toBe(matchJson);
    expect(await fs.readFile(path.join(projectPath, 'dungeon.json'), 'utf8')).toBe(dungeonJson);

    const loaded = await readLobbyProject(projectPath);
    await fs.writeFile(path.join(projectPath, 'match.json'), '[]\n', 'utf8');
    const attemptedDungeonJson = '{"changed":true}\n';

    await expect(saveLobbyProject({
      projectPath,
      matchRevision: loaded.match.revision,
      dungeonRevision: loaded.dungeon.revision,
      matchJson,
      dungeonJson: attemptedDungeonJson,
    })).rejects.toBeInstanceOf(LobbyProjectConflictError);
    expect(await fs.readFile(path.join(projectPath, 'dungeon.json'), 'utf8')).toBe(dungeonJson);
  });

  it('rejects renderer requests that bypass domain validation', async () => {
    const projectPath = await createSourceProject();
    const initial = await readLobbyProject(projectPath);
    const invalidMatchJson = `${JSON.stringify([{
      game_mode: 1002,
      level_id: MAP_ID,
      teams: [],
      diffuse_time: [10],
      sections: [{ max_score: 6900, min_player_num: 8 }],
    }], null, 4)}\n`;
    const dungeonJson = `${JSON.stringify({
      [MAP_ID]: {
        game_modes: {
          '1002': {
            enable_public: 0,
            enable_private: 1,
            max_player_num: 8,
            can_add_in_time: 120,
          },
        },
      },
    }, null, 4)}\n`;

    await expect(saveLobbyProject({
      projectPath,
      matchRevision: initial.match.revision,
      dungeonRevision: initial.dungeon.revision,
      matchJson: invalidMatchJson,
      dungeonJson,
    })).rejects.toThrow('配置校验失败');
    await expect(fs.stat(path.join(projectPath, 'match.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(projectPath, 'dungeon.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createSourceProject(): Promise<string> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'y3-toolbox-lobby-'));
  temporaryDirectories.push(projectPath);
  await fs.mkdir(path.join(projectPath, 'maps', 'BattleMap'), { recursive: true });
  await fs.writeFile(path.join(projectPath, 'header.project'), '{"name":"fixture"}\n', 'utf8');
  await fs.writeFile(path.join(projectPath, 'gamemode.json'), JSON.stringify({
    game_modes: { '1002': { desc: '匹配模式' } },
  }), 'utf8');
  await fs.writeFile(path.join(projectPath, 'maps', 'BattleMap', 'header.map'), [
    '{',
    '  "id": 50377054694119407947881484918402159964,',
    '  "version": 73',
    '}',
  ].join('\n'), 'utf8');
  return projectPath;
}
