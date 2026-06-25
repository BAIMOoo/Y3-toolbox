import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public backend release docs', () => {
  const docs = readFileSync('docs/public-backend-release.md', 'utf8');
  const readme = readFileSync('README.md', 'utf8');

  it('documents release train compatibility and no silent forced client update', () => {
    expect(docs).toContain('Release train 与客户端兼容策略');
    expect(docs).toContain('/api/health.release');
    expect(docs).toContain('minimumClientVersion');
    expect(docs).toContain('supportedClientRange');
    expect(docs).toContain('不做静默强制更新');
    expect(docs).toContain('不引入 NSIS/MSIX/Squirrel/electron-updater');
  });

  it('documents generated manifest and canonical promotion boundaries', () => {
    expect(docs).toContain('scripts/release/generateReleaseManifest.ts');
    expect(docs).toContain('release/release-manifest.json');
    expect(docs).toContain('非本机路径的 public runtime 目标标识');
    expect(docs).toContain('不进入公开 release artifact');
    expect(docs).toContain('scripts/windows/sync-public-runtime.ps1');
    expect(docs).toContain('sync-public-runtime-status.json');
    expect(docs).toContain('-RestartPublic');
    expect(docs).toContain('-Rollback');
    expect(docs).toContain('-ManifestPath release\\release-manifest.json');
    expect(docs).toContain('must not infer public compatibility metadata from `package.json`');
    expect(docs).toContain('Public Vite/proxy must not forward `/api/diagnostics`');
    expect(docs).toContain('正常开发验证不得执行真实 public restart/cutover');
  });

  it('keeps user-facing update copy prompt-based and local workflows unaffected', () => {
    expect(readme).toContain('提示式更新');
    expect(readme).toContain('Releases 下载入口');
    expect(readme).toContain('本地 CSV / Archive 查看功能不受影响');
    expect(readme).toContain('已有任务列表和结果仍可查看');
  });
});
