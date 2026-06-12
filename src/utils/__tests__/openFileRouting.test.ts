import { describe, expect, it } from 'vitest';
import { classifyLocalInput, classifyOpenFilePath, getDroppedLocalInputs, routeRequiresLocalArchive, shouldSkipRootDropRoute } from '../openFileRouting';

describe('classifyOpenFilePath', () => {
  it('routes csv to the diff flow', () => {
    expect(classifyOpenFilePath('C:/tmp/log.CSV')).toEqual({ kind: 'diff-csv', path: 'C:/tmp/log.CSV' });
  });

  it('routes json to the local archive flow', () => {
    const route = classifyOpenFilePath('C:/tmp/archive_storage.JSON');
    expect(route).toEqual({ kind: 'local-archive-json', path: 'C:/tmp/archive_storage.JSON' });
    expect(routeRequiresLocalArchive(route)).toBe(true);
  });

  it('routes a real dropped directory path to the local archive project flow', () => {
    const route = classifyLocalInput({ path: 'C:/Y3/MyProject', isDirectory: true });
    expect(route).toEqual({ kind: 'local-archive-directory', path: 'C:/Y3/MyProject' });
    expect(routeRequiresLocalArchive(route)).toBe(true);
  });

  it('rejects a directory drop without a real Electron local path', () => {
    expect(classifyLocalInput({ name: 'MyProject', isDirectory: true })).toEqual({
      kind: 'unsupported',
      path: 'MyProject',
      error: '拖拽文件夹需要桌面应用读取本地路径；也可以点击“打开项目文件夹”',
    });
  });

  it('rejects a file drop without a real Electron local path without claiming local restore support', () => {
    expect(classifyLocalInput({ name: 'archive_storage.json' })).toEqual({
      kind: 'unsupported',
      path: 'archive_storage.json',
      error: '拖拽本地文件需要桌面应用读取路径；也可以点击页面内的打开或选择按钮',
    });
  });

  it('returns a typed unsupported-file error', () => {
    expect(classifyOpenFilePath('C:/tmp/readme.txt')).toEqual({
      kind: 'unsupported',
      path: 'C:/tmp/readme.txt',
      error: '不支持的文件类型：请选择 .csv 变动日志、.json Archive 文件或 Y3 项目文件夹',
    });
  });
});

describe('getDroppedLocalInputs', () => {
  it('extracts Electron file paths from dataTransfer items', () => {
    const inputs = getDroppedLocalInputs({
      items: [
        {
          kind: 'file',
          getAsFile: () => ({ name: 'log.csv', path: 'C:/tmp/log.csv', type: 'text/csv' }),
          webkitGetAsEntry: () => ({ name: 'log.csv', isDirectory: false }),
        },
      ] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
    });

    expect(inputs).toEqual([{ path: 'C:/tmp/log.csv', name: 'log.csv', isDirectory: false }]);
  });

  it('marks dropped directories but does not invent a path for browser-only drops', () => {
    const inputs = getDroppedLocalInputs({
      items: [
        {
          kind: 'file',
          getAsFile: () => ({ name: 'MyProject', type: '' }),
          webkitGetAsEntry: () => ({ name: 'MyProject', isDirectory: true }),
        },
      ] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
    });

    expect(inputs).toEqual([{ path: undefined, name: 'MyProject', isDirectory: true }]);
    expect(classifyLocalInput(inputs[0])).toMatchObject({ kind: 'unsupported' });
  });

  it('falls back to files when dataTransfer items are unavailable', () => {
    const inputs = getDroppedLocalInputs({
      items: [] as unknown as DataTransferItemList,
      files: [
        { name: 'archive_storage.json', path: 'C:/tmp/archive_storage.json', type: 'application/json' },
      ] as unknown as FileList,
    });

    expect(inputs).toEqual([{ path: 'C:/tmp/archive_storage.json', name: 'archive_storage.json', isDirectory: false }]);
  });
});


describe('shouldSkipRootDropRoute', () => {
  it('keeps CSV drops scoped to page-level upload controls instead of the app shell', () => {
    expect(shouldSkipRootDropRoute({ name: 'log.csv', isDirectory: false }, true)).toBe(true);
    expect(shouldSkipRootDropRoute({ name: 'log.csv', isDirectory: false }, false)).toBe(true);
    expect(shouldSkipRootDropRoute({ path: 'C:/tmp/log.csv', name: 'log.csv', isDirectory: false }, true)).toBe(true);
    expect(shouldSkipRootDropRoute({ path: 'C:/tmp/log.csv', name: 'log.csv', isDirectory: false }, false)).toBe(true);
  });

  it('preserves root routing for local archive inputs unless a child already handled them', () => {
    expect(shouldSkipRootDropRoute({ name: 'archive_storage.json', isDirectory: false }, false)).toBe(false);
    expect(shouldSkipRootDropRoute({ name: 'archive_storage.json', isDirectory: false }, true)).toBe(true);
    expect(shouldSkipRootDropRoute({ name: 'MyProject', isDirectory: true }, false)).toBe(false);
    expect(shouldSkipRootDropRoute({ name: 'MyProject', isDirectory: true }, true)).toBe(true);
  });
});
