import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../components/DiffView.tsx', import.meta.url), 'utf8');
const changeListSource = readFileSync(new URL('../components/ChangeList.tsx', import.meta.url), 'utf8');
const statusBarSource = readFileSync(new URL('../components/StatusBar.tsx', import.meta.url), 'utf8');

describe('DiffView status color contract', () => {
  it('renders Snapshot Compare row markers with StatusBar color tokens and original marker width', () => {
    expect(source).toContain('snapshot-compare-status-v10-themed-paper-contrast');
    expect(source).toContain("type === 'created' ? '2px solid var(--snapshot-compare-color-create)'");
    expect(source).toContain("type === 'deleted' ? '2px solid var(--snapshot-compare-color-delete)'");
    expect(source).toContain("type === 'updated' ? '2px solid var(--snapshot-compare-color-update)'");
  });

  it('uses themed Snapshot Compare headers instead of hard-coded dark bars', () => {
    expect(source).not.toContain("background: 'rgba(17, 23, 33, 0.96)'");
    expect(source).toContain("background: 'var(--bg-tertiary)'");
  });

  it('renders parsed dv/max archive limit metadata in snapshot compare and change list', () => {
    expect(source).toContain('limitMetadataByKey');
    expect(source).toContain('用量 {metadata.dayValueOld}→{metadata.dayValueNew} / 上限 {metadata.maxValue}');
    expect(source).toContain('当前存档本周期内累计获得值已经从 ${metadata.dayValueOld} 变成了 ${metadata.dayValueNew}；本周期允许累计的上限是 ${metadata.maxValue}');
    expect(changeListSource).toContain("title: '限制'");
    expect(changeListSource).toContain('用量: {metadata.dayValueOld} → {metadata.dayValueNew} / 上限: {metadata.maxValue}');
    expect(changeListSource).toContain('当前存档本周期内累计获得值已经从 ${metadata.dayValueOld} 变成了 ${metadata.dayValueNew}；本周期允许累计的上限是 ${metadata.maxValue}');
  });

  it('keeps StatusBar badges on the same status token family', () => {
    expect(statusBarSource).toContain("background: 'var(--status-bg-create)', color: 'var(--status-color-create)'");
    expect(statusBarSource).toContain("background: 'var(--status-bg-update)', color: 'var(--status-color-update)'");
    expect(statusBarSource).toContain("background: 'var(--status-bg-delete)', color: 'var(--status-color-delete)'");
  });

  it('keeps placeholder rows visually neutral like the old Snapshot Compare', () => {
    expect(source).toContain('// 占位空行');
    expect(source).toContain("borderLeft: '2px solid transparent'");
  });
});
