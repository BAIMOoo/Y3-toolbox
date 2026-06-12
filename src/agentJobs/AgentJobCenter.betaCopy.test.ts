import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AgentJobCenter beta warning copy contract', () => {
  it('shows concise shared task service warnings without claiming account-level security', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');

    expect(source).toContain('共享任务服务：真实任务会执行');
    expect(source).toContain('提交后会触发真实任务');
    expect(source).toContain('任务按当前浏览器本地标识区分');
    expect(source).toContain('服务可能随时限流、排队、维护或暂停提交');
    expect(source).not.toContain('账号级安全');
    expect(source).not.toContain('强身份认证');
  });


  it('keeps queue status in the sticky topbar and removes the visible runtime card', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');

    expect(source).toContain('agent-job-topbar');
    expect(source).toContain('getAgentQueueStatus');
    expect(source).toContain('任务服务和队列状态');
    expect(source).not.toContain('title="运行环境"');
    expect(source).not.toContain('<strong>队列</strong>');
  });


  it('keeps queue status informational instead of disabling submit from cached health', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');

    expect(source).toContain('getAgentQueueStatus');
    expect(source).toContain('submitAgentJob');
    expect(source).not.toContain('submitDisabledReason');
    expect(source).not.toContain('disabled={Boolean(submitDisabledReason)}');
  });

  it('uses owner-scoped artifact download URLs', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');

    expect(source).toContain('getAgentArtifactDownloadUrl(artifact.downloadUrl)');
  });

  it('shows only kkres downloads for kkres export jobs', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');

    expect(source).toContain("job.skillId === 'export-kkres-image'");
    expect(source).toContain(".endsWith('.kkres')");
  });

  it('offers kkres image path picker and drag/drop helpers without adding extra submitted fields', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');

    expect(source).toContain('KkresImagePathField');
    expect(source).toContain('选择图片文件夹');
    expect(source).toContain('选择图片文件');
    expect(source).toContain('填写上传/暂存图片标识');
    expect(source).toContain('mergeLineValues');
    expect(source).toContain('getDroppedKkresImagePaths');
    expect(source).toContain('kkres-image-textarea-drop-target');
  });
});
