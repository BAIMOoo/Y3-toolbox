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


  it('keeps queue status informational while compatibility gates submit explicitly', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');

    expect(source).toContain('getAgentQueueStatus');
    expect(source).toContain('submitAgentJob');
    expect(source).toContain('submitDisabledReason');
    expect(source).toContain('compatibility.submitBlocked');
    expect(source).toContain('showCompatibilityAlert');
    expect(source).toContain('maintenanceSubmitBlocked');
    expect(source).toContain('任务服务维护中，暂不接受新任务');
    expect(source).toContain('disabled={Boolean(submitDisabledReason)}');
  });

  it('shows a first-load connection state before rendering true empty task data', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');

    expect(source).toContain('bootstrapLoading');
    expect(source).toContain('正在加载任务能力');
    expect(source).toContain('正在同步任务列表');
    expect(source).toContain('正在连接任务服务，连接成功后会显示任务详情');
    expect(source).toContain('AgentJobLoadingState');
    expect(source).toContain('aria-label="正在连接任务服务"');
    expect(source).toContain('const submitDisabledReason = bootstrapLoading');
    expect(source).toContain("? '正在连接任务服务'");
  });

  it('shows compatibility update guidance without forced background replacement', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');
    const compatibility = readFileSync(new URL('./agentCompatibility.ts', import.meta.url), 'utf8');

    expect(source).toContain('agent-job-compatibility-alert');
    expect(source).toContain('const showCompatibilityAlert = !bootstrapLoading && compatibility.submitBlocked');
    expect(source).toContain('{showCompatibilityAlert && (');
    expect(source).toContain('打开 GitHub Releases 下载最新版本');
    expect(source).toContain('已有任务列表和结果仍可查看');
    expect(compatibility).toContain('https://github.com/BAIMOoo/Y3-toolbox/releases/latest');
    expect(compatibility).not.toContain('https://github.com/BAIM/y3-toolbox/releases/latest');
    expect(source).not.toContain('autoUpdater');
    expect(source).not.toContain('electron-updater');
  });


  it('uses owner-scoped artifact download URLs with a desktop-safe click handoff', () => {
    const source = readFileSync(new URL('./AgentJobCenter.tsx', import.meta.url), 'utf8');

    expect(source).toContain('getAgentArtifactDownloadUrl(artifact.downloadUrl)');
    expect(source).toContain('handleAgentArtifactDownloadClick');
    expect(source).toContain('window.electronAPI');
    expect(source).toContain('href={getAgentArtifactDownloadUrl(artifact.downloadUrl)}');
    expect(source).not.toContain('target="_blank" rel="noopener"');
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
    expect(source).toContain('选择本机图片并自动暂存');
    expect(source).toContain('stageKkresImageInputs');
    expect(source).toContain('prepareAgentSubmitParams');
    expect(source).toContain('mergeLineValues');
    expect(source).toContain('getDroppedKkresImagePaths');
    expect(source).toContain('kkres-image-textarea-drop-target');
    expect(source).toContain('subscribeToActiveStageProgress');
    expect(source).toContain('KkresStageProgressPanel');
    expect(source).toContain('导入前安全提醒');
    expect(source).toContain('不要直接把生成的 KKRes 导入正式项目');
    expect(source).toContain('导入正式项目前请先做好项目备份');
  });
});
