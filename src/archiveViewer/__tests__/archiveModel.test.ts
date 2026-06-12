import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_TYPE_TABLE,
  ArchiveLoadError,
  buildSlotTree,
  createArchiveProject,
  getPlayerSlots,
  getPlayers,
  parseTableValue,
  slotSortCompare,
  treeRowText,
} from '../archiveModel';

function makeStorage() {
  return {
    test_account: {
      role_id: 1,
      archive: {
        '1': { data_type: 2, data_value: 42 },
        '2': { data_type: 4, data_value: { '1001': { level: 5, name: 'hero' } } },
      },
      platform_prop: {},
    },
  };
}

function makeConfig() {
  return {
    archive_slots: {
      '1': { name: '金币', type: 2, value: 0 },
      '2': { name: '英雄表', type: 4, value: {} },
      '3': { name: '默认槽', type: 1, value: true },
    },
  };
}

describe('archiveModel', () => {
  it('loads players and configured slot names', () => {
    const project = createArchiveProject({ storageData: makeStorage(), archiveConfig: makeConfig() });
    expect(getPlayers(project)).toEqual(['test_account']);
    const slots = getPlayerSlots(project, 'test_account');
    expect(slots.map((slot) => slot.name)).toEqual(['金币', '英雄表', '默认槽']);
    expect(slots[0].value).toBe(42);
    expect(slots[0].valueSource).toBe('player');
    expect(slots[2].value).toBe(true);
    expect(slots[2].valueSource).toBe('default');
  });

  it('loads standalone player archive json as selected_json', () => {
    const project = createArchiveProject({
      storageData: {
        '1': { data_type: 2, data_value: 99 },
        '2': { data_type: 4, data_value: { '1001': { level: 5 } } },
      },
    });
    expect(getPlayers(project)).toEqual(['当前 JSON']);
    const slots = getPlayerSlots(project, '当前 JSON');
    expect(slots[0].slotId).toBe('1');
    expect(slots[0].value).toBe(99);
  });

  it('rejects non archive json', () => {
    expect(() => createArchiveProject({ storageData: { hello: 'world' } })).toThrow(ArchiveLoadError);
  });

  it('builds table slot tree', () => {
    const project = createArchiveProject({ storageData: makeStorage(), archiveConfig: makeConfig() });
    const tableSlot = getPlayerSlots(project, 'test_account').find((slot) => slot.slotType === ARCHIVE_TYPE_TABLE);
    expect(tableSlot).toBeDefined();
    const tree = buildSlotTree(tableSlot!);
    expect(tree.label).toBe('2 英雄表');
    expect(tree.children[0].label).toBe('1001');
    expect(tree.children[0].children.map((child) => child.label)).toEqual(['level', 'name']);
  });

  it('parses lua-like table strings', () => {
    const parsed = parseTableValue('{["1001"]={["level"]=5,["name"]="hero",["中文"]=7,},}') as Record<string, Record<string, unknown>>;
    expect(parsed['1001'].level).toBe(5);
    expect(parsed['1001'].name).toBe('hero');
    expect(parsed['1001']['中文']).toBe(7);
  });

  it('parses Fix32 booleans nil and arrays in lua-like strings', () => {
    const parsed = parseTableValue('{["x"]=Fix32(12.5),["ok"]=true,["no"]=false,["none"]=nil,["arr"]={1,2,3,},}') as Record<string, unknown>;
    expect(parsed.x).toBe(12.5);
    expect(parsed.ok).toBe(true);
    expect(parsed.no).toBe(false);
    expect(parsed.none).toBeNull();
    expect(parsed.arr).toEqual([1, 2, 3]);
  });

  it('falls back to raw value on unparseable table strings', () => {
    expect(parseTableValue('{bad')).toBe('{bad');
  });

  it('sorts numeric slot ids before text ids', () => {
    expect(['x', '10', '2', 'a'].sort(slotSortCompare)).toEqual(['2', '10', 'a', 'x']);
  });

  it('formats copy row text as Field Type Value', () => {
    expect(treeRowText({ label: 'level', typeName: 'number', value: 5, children: [] })).toBe('level\tnumber\t5');
  });
});
