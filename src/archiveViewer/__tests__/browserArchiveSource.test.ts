import { describe, expect, it } from 'vitest';
import { LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE } from '../useLocalArchiveViewer';

describe('local archive browser boundary', () => {
  it('documents that web mode cannot directly read local archive paths', () => {
    expect(LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE).toContain('当前环境无法直接读取本地路径');
    expect(LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE).toContain('桌面版');
  });
});
