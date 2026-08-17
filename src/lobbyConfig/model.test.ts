import { describe, expect, it } from 'vitest';
import {
  applyMatchPreset,
  createDungeonEntry,
  createLobbyDocument,
  removeDungeonEntry,
  serializeLobbyDocument,
  setMatchEnabled,
  syncDungeonCapacity,
  updateDungeonMode,
  updateMatchRule,
  validateLobbyDocument,
} from './model';

describe('lobby configuration model', () => {
  it('preserves existing unknown fields while producing readable JSON previews', () => {
    const document = createLobbyDocument({
      matchConfig: [{
        game_mode: 1002,
        level_id: '50377054694119407947881484918402159964',
        teams: [2],
        diffuse_time: [10],
        sections: [{ max_score: 6900, min_player_num: 2, future_section_option: 'kept' }],
        future_match_option: { enabled: true },
      }],
      dungeonConfig: {
        '50377054694119407947881484918402159964': {
          game_modes: {
            '1002': {
              enable_public: 0,
              enable_private: 1,
              max_player_num: 8,
              can_add_in_time: 120,
              future_dungeon_option: 'kept',
            },
          },
        },
      },
    });

    const serialized = serializeLobbyDocument(document);

    expect(JSON.parse(serialized.matchJson)[0].future_match_option).toEqual({ enabled: true });
    expect(JSON.parse(serialized.dungeonJson)['50377054694119407947881484918402159964']
      .game_modes['1002'].future_dungeon_option).toBe('kept');
    expect(serialized.matchJson).toContain('\n        "game_mode": 1002');

    const presetDocument = applyMatchPreset(
      document,
      '50377054694119407947881484918402159964',
      '1002',
      0,
      'full-human',
    );
    expect(presetDocument.matchRules[0].sections[0].future_section_option).toBe('kept');
  });

  it('reports schema and cross-file errors without hiding independent problems', () => {
    const document = createLobbyDocument({
      matchConfig: [{
        game_mode: 1002,
        level_id: 'level-a',
        teams: [4, 4],
        diffuse_time: [30, 10],
        sections: [
          { max_score: 1000, min_player_num: 9 },
          { max_score: 500, min_player_num: 4 },
        ],
      }],
      dungeonConfig: {
        'level-a': {
          game_modes: {
            '1002': {
              enable_public: 0,
              enable_private: 1,
              max_player_num: 6,
              can_add_in_time: 120,
            },
          },
        },
      },
    });

    const issues = validateLobbyDocument(document, {
      modeIds: ['1001'],
      levelIds: ['level-b'],
    });

    expect(issues.map((issue) => [issue.severity, issue.code])).toEqual([
      ['error', 'unknown-mode'],
      ['warning', 'unknown-local-level'],
      ['error', 'diffuse-order'],
      ['error', 'section-order'],
      ['error', 'minimum-player-capacity'],
      ['error', 'dungeon-capacity'],
    ]);
  });

  it('manages a combined dungeon entry and its optional matching rule', () => {
    let document = createLobbyDocument({ matchConfig: [], dungeonConfig: {} });

    document = createDungeonEntry(document, 'level-a', '1002');
    expect(document.dungeonConfig['level-a'].game_modes['1002']).toMatchObject({
      enable_public: 0,
      enable_private: 1,
      max_player_num: 8,
      can_add_in_time: 120,
    });

    document = setMatchEnabled(document, 'level-a', '1002', true);
    document = applyMatchPreset(document, 'level-a', '1002', 0, 'full-human');
    expect(document.matchRules[0]).toMatchObject({
      game_mode: 1002,
      level_id: 'level-a',
      teams: [8],
      diffuse_time: [2147483647],
      bot_fill_time: 0,
      sections: [{ max_score: 2147483647, min_player_num: 8 }],
    });

    document = setMatchEnabled(document, 'level-a', '1002', false);
    expect(document.matchRules).toHaveLength(0);
    expect(document.dungeonConfig['level-a'].game_modes['1002']).toBeDefined();

    document = removeDungeonEntry(document, 'level-a', '1002');
    expect(document.dungeonConfig).toEqual({});
  });

  it('updates one entry and one matching rule without replacing unrelated data', () => {
    let document = createLobbyDocument({
      matchConfig: [{
        game_mode: 1002,
        level_id: 'level-a',
        teams: [4, 4],
        diffuse_time: [10],
        sections: [{ max_score: 6900, min_player_num: 8 }],
        unknown: 'keep',
      }],
      dungeonConfig: {
        'level-a': {
          game_modes: {
            '1002': {
              enable_public: 0,
              enable_private: 1,
              max_player_num: 8,
              can_add_in_time: 120,
              unknown: 'keep',
            },
          },
        },
      },
    });

    document = updateDungeonMode(document, 'level-a', '1002', { can_add_in_time: 300 });
    document = updateMatchRule(document, 'level-a', '1002', 0, { teams: [6, 6] });
    document = syncDungeonCapacity(document, 'level-a', '1002', 0);
    expect(document.dungeonConfig['level-a'].game_modes['1002']).toMatchObject({
      max_player_num: 12,
      can_add_in_time: 300,
      unknown: 'keep',
    });
    expect(document.matchRules[0]).toMatchObject({ teams: [6, 6], unknown: 'keep' });
    expect(document.matchRules).toHaveLength(1);
    expect(document.matchRules[0].unknown).toBe('keep');
  });

  it('rejects more than one matching rule for the same dungeon', () => {
    const rule = {
      game_mode: 1002,
      level_id: 'level-a',
      teams: [8],
      diffuse_time: [10],
      sections: [{ max_score: 6900, min_player_num: 8 }],
    };
    const document = createLobbyDocument({
      matchConfig: [rule, structuredClone(rule)],
      dungeonConfig: {
        'level-a': {
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
    });

    const issues = validateLobbyDocument(document, {
      modeIds: ['1002'],
      levelIds: ['level-a'],
    });

    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'duplicate-match-rule',
      path: 'match[1]',
    }));
  });
});
