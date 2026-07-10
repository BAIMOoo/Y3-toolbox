import { describe, expect, it } from 'vitest';
import { splitReadableMessage, summarizeReadableMessage } from './readableMessage';

describe('splitReadableMessage', () => {
  it('splits dense Chinese task summaries into scannable segments', () => {
    expect(splitReadableMessage('已拉取地图 10204416 最近 14 天不同步日志：37 条记录，14 个场景目录，30 个 digest JSON；decoded_digest=true，digest_source=[local-path] 1 个附件 验证：PowerShell helper exited with code 0')).toEqual([
      '已拉取地图 10204416 最近 14 天不同步日志：37 条记录，',
      '14 个场景目录，',
      '30 个 digest JSON；',
      'decoded_digest=true，',
      'digest_source=[local-path] 1 个附件',
      '验证：PowerShell helper exited with code 0',
    ]);
  });

  it('keeps short messages unchanged', () => {
    expect(splitReadableMessage('完成：已生成并校验不同步日志 ZIP 包。')).toEqual(['完成：已生成并校验不同步日志 ZIP 包。']);
  });
});

describe('summarizeReadableMessage', () => {
  it('keeps only core mismatch log result information for the task summary', () => {
    expect(summarizeReadableMessage(`地图 10204416 最近 1 天不同步日志拉取完成；
记录数 0；
decoded_digest=True；
digest_source=[local-path]
生成 1 个下载包。
验证：fetch_mismatch_logs.ps1 退出码为 0；
helper 摘要已解析：record_count=0,
scene_directory_count=0,
digest_json_count=0。`)).toEqual([
      '地图 10204416 · 最近 1 天不同步日志拉取完成',
      '0 条不同步记录',
      '1 个下载包已生成',
    ]);
  });

  it('drops diagnostic fields from generic summaries', () => {
    expect(summarizeReadableMessage('完成：已生成下载包；decoded_digest=true；验证：PowerShell helper exited with code 0')).toEqual(['完成：已生成下载包；']);
  });
});
