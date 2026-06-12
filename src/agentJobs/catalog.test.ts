import { describe, expect, it } from 'vitest';
import { AGENT_SKILLS, applyAgentParamDefaults, getAgentParamDefaults, validateAgentParams } from './catalog';

describe('agent skill catalog form contract', () => {
  it('keeps mismatch log form limited to map and days while runtime details stay service-owned', () => {
    const skill = AGENT_SKILLS.find((candidate) => candidate.id === 'fetch-mismatch-logs');

    expect(skill).toBeDefined();
    expect(skill?.fields.map((field) => field.name)).toEqual(['mapId', 'days']);
    expect(skill?.description).toContain('运行环境由任务服务侧配置');
    expect(getAgentParamDefaults('fetch-mismatch-logs')).toEqual({ days: 7 });
    expect(validateAgentParams('fetch-mismatch-logs', applyAgentParamDefaults('fetch-mismatch-logs', { mapId: '10204416' }))).toEqual([]);
  });


  it('shows the maptest/test lobby prefix hint on every map id form field', () => {
    const mapFields = AGENT_SKILLS.flatMap((skill) =>
      skill.fields
        .filter((field) => field.name === 'mapId' || field.label.toLowerCase().includes('地图 id'))
        .map((field) => ({ skillId: skill.id, field })),
    );

    expect(mapFields.map(({ skillId }) => skillId).sort()).toEqual(['fetch-archive-changes', 'fetch-mismatch-logs']);
    for (const { field } of mapFields) {
      expect(field.description).toContain('maptest');
      expect(field.description).toContain('测试大厅');
      expect(field.description).toContain('10 前缀');
    }
  });

  it('keeps kkres export form limited to image paths and describes server-owned limits', () => {
    const skill = AGENT_SKILLS.find((candidate) => candidate.id === 'export-kkres-image');

    expect(skill).toBeDefined();
    expect(skill?.fields.map((field) => field.name)).toEqual(['images']);
    expect(skill?.description).toContain('4096*4096');
    expect(skill?.description).toContain('已上传/暂存');
    expect(skill?.fields[0]?.description).toContain('任务服务不接受任意本机路径');
    expect(skill?.fields[0]?.description).toContain('4096*4096');
    expect(skill?.description).not.toContain('最大尺寸');
    expect(skill?.fields[0]?.description).not.toContain('最大尺寸');
    expect(getAgentParamDefaults('export-kkres-image')).toEqual({});
    expect(validateAgentParams('export-kkres-image', { images: 'staging:a.png\npublic-input/folder/b.webp' })).toEqual([]);
    expect(validateAgentParams('export-kkres-image', { images: 'C:\\tmp\\a.png' }).join('\n')).toContain('not a local path');
    expect(validateAgentParams('export-kkres-image', { images: '..\\secret.png' }).join('\n')).toContain('not a local path');
    expect(validateAgentParams('export-kkres-image', { images: 'staging:a.exe' }).join('\n')).toContain('not a local path');
  });
});
