import { describe, expect, it } from 'vitest';
import {
  WEB_ARCHIVE_SESSION_INPUT_PREFIX,
  browserArchiveInputPath,
  isBrowserArchiveInputPath,
  shouldPersistArchiveInputPath,
} from '../useLocalArchiveViewer';
import { createArchiveProject, getPlayerSlots, getPlayers } from '../archiveModel';

describe('web archive input contract', () => {
  it('uses synthetic non-path identifiers for Web-selected JSON files', () => {
    expect(WEB_ARCHIVE_SESSION_INPUT_PREFIX).toBe('web-json:');
    expect(browserArchiveInputPath(1, 'archive_storage.json')).toBe('web-json:1:archive_storage.json');
    expect(browserArchiveInputPath(2, 'same/name.json')).toBe('web-json:2:same_name.json');
    expect(isBrowserArchiveInputPath('web-json:1:archive_storage.json')).toBe(true);
    expect(isBrowserArchiveInputPath('C:/tmp/archive_storage.json')).toBe(false);
  });

  it('does not persist Web-selected JSON identifiers as restorable filesystem paths', () => {
    expect(shouldPersistArchiveInputPath('web-json:1:archive_storage.json')).toBe(false);
    expect(shouldPersistArchiveInputPath('')).toBe(false);
    expect(shouldPersistArchiveInputPath('C:/Y3/Project/archive/archive_storage.json')).toBe(true);
  });

  it('keeps Web-selected standalone player archive JSON compatible with the archive model', () => {
    const project = createArchiveProject({
      storageData: {
        1: { data_value: 'hello', data_type: 0 },
      },
      paths: {
        inputPath: browserArchiveInputPath(1, 'archive_storage.json'),
        title: 'archive_storage.json',
      },
    });

    expect(project.paths.inputPath).toBe('web-json:1:archive_storage.json');
    expect(project.paths.title).toBe('archive_storage.json');
    expect(getPlayers(project)).toEqual(['当前 JSON']);
    expect(getPlayerSlots(project, '当前 JSON').map((slot) => `${slot.slotId}:${slot.summary}`)).toEqual(['1:hello']);
  });

  it('surfaces invalid Web-selected archive shapes through the shared archive model validation', () => {
    expect(() => createArchiveProject({ storageData: { nope: true }, paths: { inputPath: browserArchiveInputPath(1, 'bad.json'), title: 'bad.json' } })).toThrow('请选择有效的 Archive JSON 文件');
  });
});
