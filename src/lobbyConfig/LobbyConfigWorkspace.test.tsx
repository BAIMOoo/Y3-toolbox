/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LobbyConfigWorkspace } from './LobbyConfigWorkspace';

beforeEach(() => {
  if (globalThis.ResizeObserver) return;
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.electronAPI;
});

describe('LobbyConfigWorkspace', () => {
  it('opens a source project and presents its unified level and mode entries', async () => {
    const openLobbyConfigDirectory = vi.fn().mockResolvedValue('C:/Y3/MyProject');
    const readLobbyConfigProject = vi.fn().mockResolvedValue({
      success: true,
      snapshot: fixtureSnapshot(),
    });
    window.electronAPI = {
      openLobbyConfigDirectory,
      readLobbyConfigProject,
    } as unknown as Window['electronAPI'];

    render(<LobbyConfigWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: '选择 Y3 项目' }));

    await waitFor(() => expect(readLobbyConfigProject).toHaveBeenCalledWith('C:/Y3/MyProject'));
    expect(screen.getByText('MyProject')).toBeTruthy();
    expect(screen.getByText('副本')).toBeTruthy();
    expect(screen.getAllByText('BattleMap').length).toBeGreaterThan(0);
    expect(screen.getByText('排位模式（1002）')).toBeTruthy();
    expect(screen.getByText('支持私人副本 + 匹配')).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: '时间点 1' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: '允许公开进入' })).toHaveClass('ant-switch-small');
    expect(screen.getByRole('switch', { name: '允许私人进入' })).toHaveClass('ant-switch-small');
    expect(screen.getByText('match.json 已加载')).toBeTruthy();
    expect(screen.getByText('dungeon.json 已加载')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '新增匹配规则' })).not.toBeInTheDocument();

    const sidebarSeparator = screen.getByRole('separator', { name: '调整副本列表宽度' });
    const inspectorSeparator = screen.getByRole('separator', { name: '调整检查面板宽度' });
    expect(sidebarSeparator).toHaveAttribute('aria-valuenow', '22');
    expect(inspectorSeparator).toHaveAttribute('aria-valuenow', '64');
    fireEvent.keyDown(sidebarSeparator, { key: 'ArrowRight' });
    expect(sidebarSeparator).toHaveAttribute('aria-valuenow', '27');
  });

  it('requires an explicit capacity sync and editor-closed confirmation before saving', async () => {
    const saveLobbyConfigProject = vi.fn().mockResolvedValue({
      success: true,
      revisions: { matchRevision: 'match-r2', dungeonRevision: 'dungeon-r2' },
    });
    window.electronAPI = {
      openLobbyConfigDirectory: vi.fn().mockResolvedValue('C:/Y3/MyProject'),
      readLobbyConfigProject: vi.fn().mockResolvedValue({ success: true, snapshot: fixtureSnapshot() }),
      saveLobbyConfigProject,
    } as unknown as Window['electronAPI'];

    render(<LobbyConfigWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: '选择 Y3 项目' }));
    await screen.findByText('match.json 已加载');

    fireEvent.change(screen.getByRole('spinbutton', { name: '阵营 1 人数' }), { target: { value: '12' } });
    const syncButton = await screen.findByRole('button', { name: '同步房间容量至 12' });
    fireEvent.click(syncButton);
    expect(screen.getByText('"max_player_num": 12', { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    const confirmSave = await screen.findByRole('button', { name: '确认写入' });
    expect(confirmSave).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '已完全关闭 Y3 编辑器' }));
    fireEvent.click(confirmSave);

    await waitFor(() => expect(saveLobbyConfigProject).toHaveBeenCalledTimes(1));
    expect(saveLobbyConfigProject).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'C:/Y3/MyProject',
      matchRevision: 'match-r1',
      dungeonRevision: 'dungeon-r1',
      matchJson: expect.stringContaining('"teams": [\n            12'),
      dungeonJson: expect.stringContaining('"max_player_num": 12'),
    }));
  }, 15_000);

  it('shows validation for malformed existing rules instead of crashing the editor', async () => {
    const snapshot = fixtureSnapshot();
    snapshot.match.config = [{
      game_mode: 1002,
      level_id: '50377054694119407947881484918402159964',
      teams: null,
      diffuse_time: [10],
      sections: [{ max_score: 6900, min_player_num: 8 }],
    }] as unknown as typeof snapshot.match.config;
    window.electronAPI = {
      openLobbyConfigDirectory: vi.fn().mockResolvedValue('C:/Y3/MyProject'),
      readLobbyConfigProject: vi.fn().mockResolvedValue({ success: true, snapshot }),
    } as unknown as Window['electronAPI'];

    render(<LobbyConfigWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: '选择 Y3 项目' }));

    expect(await screen.findByText('当前匹配规则结构无效')).toBeTruthy();
    expect(await screen.findByText('match[0].teams')).toBeTruthy();
  }, 15_000);

  it('blocks duplicate rules for one dungeon while allowing the duplicate to be removed', async () => {
    const snapshot = fixtureSnapshot();
    snapshot.match.config.push(structuredClone(snapshot.match.config[0]));
    window.electronAPI = {
      openLobbyConfigDirectory: vi.fn().mockResolvedValue('C:/Y3/MyProject'),
      readLobbyConfigProject: vi.fn().mockResolvedValue({ success: true, snapshot }),
    } as unknown as Window['electronAPI'];

    render(<LobbyConfigWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: '选择 Y3 项目' }));

    expect(await screen.findByText('同一副本最多只能有一条匹配规则')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除当前匹配规则' }));
    await waitFor(() => expect(screen.queryByText('同一副本最多只能有一条匹配规则')).not.toBeInTheDocument());
  }, 15_000);
});

function fixtureSnapshot() {
  return {
    projectPath: 'C:/Y3/MyProject',
    projectName: 'MyProject',
    match: {
      path: 'C:/Y3/MyProject/match.json',
      exists: true,
      revision: 'match-r1',
      config: [{
        game_mode: 1002,
        level_id: '50377054694119407947881484918402159964',
        teams: [8],
        diffuse_time: [10],
        sections: [{ max_score: 6900, min_player_num: 8 }],
      }],
    },
    dungeon: {
      path: 'C:/Y3/MyProject/dungeon.json',
      exists: true,
      revision: 'dungeon-r1',
      config: {
        '50377054694119407947881484918402159964': {
          game_modes: {
            '1002': {
              enable_public: 0,
              enable_private: 1,
              max_player_num: 8,
              can_add_in_time: 120,
            },
          },
        },
      },
    },
    maps: [{ id: '50377054694119407947881484918402159964', directory: 'BattleMap' }],
    modes: [{ id: '1002', name: '排位模式' }],
  };
}
