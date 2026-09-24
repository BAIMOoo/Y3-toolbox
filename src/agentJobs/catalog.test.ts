import { describe, expect, it } from 'vitest';
import {
  AGENT_SKILLS,
  ARCHIVE_CHANGE_MAX_RANGE_DAYS,
  ARCHIVE_CHANGE_RETENTION_DAYS,
  applyAgentParamDefaults,
  getAgentParamDefaults,
  validateAgentParams,
} from './catalog';

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

    expect(mapFields.map(({ skillId }) => skillId).sort()).toEqual(['fetch-archive-changes', 'fetch-mismatch-logs', 'fetch-online-map-lua-errors']);
    for (const { field } of mapFields) {
      expect(field.description).toContain('maptest');
      expect(field.description).toContain('测试大厅');
      expect(field.description).toContain('10 前缀');
    }
  });

  it('defines the online Lua error form and validates optional player lines', () => {
    const skill = AGENT_SKILLS.find((candidate) => candidate.id === 'fetch-online-map-lua-errors');
    expect(skill?.label).toBe('拉取线上地图 Lua 报错');
    expect(skill?.fields.map((field) => field.name)).toEqual(['mapId', 'timeRange', 'players']);
    expect(validateAgentParams('fetch-online-map-lua-errors', { mapId: '204521', timeRange: '最近 7 天' })).toEqual([]);
    expect(validateAgentParams('fetch-online-map-lua-errors', {
      mapId: '204521', timeRange: '昨天', players: Array.from({ length: 21 }, (_, index) => `玩家${index}`).join('\n'),
    }).join('\n')).toContain('at most 20 unique lines');
  });

  it('keeps kkres export form limited to staged image identifiers and describes desktop staging', () => {
    const skill = AGENT_SKILLS.find((candidate) => candidate.id === 'export-kkres-image');

    expect(skill).toBeDefined();
    expect(skill?.fields.map((field) => field.name)).toEqual(['images']);
    expect(skill?.description).toContain('4096*4096');
    expect(skill?.description).toContain('自动暂存');
    expect(skill?.fields[0]?.description).toContain('桌面端会先把本机图片上传暂存');
    expect(skill?.fields[0]?.description).toContain('任务服务最终只接收');
    expect(skill?.fields[0]?.description).toContain('4096*4096');
    expect(skill?.description).not.toContain('最大尺寸');
    expect(skill?.fields[0]?.description).not.toContain('最大尺寸');
    expect(getAgentParamDefaults('export-kkres-image')).toEqual({});
    expect(validateAgentParams('export-kkres-image', { images: 'staging:a.png\npublic-input/folder/b.webp' })).toEqual([]);
    expect(validateAgentParams('export-kkres-image', { images: 'C:\\tmp\\a.png' }).join('\n')).toContain('not a local path');
    expect(validateAgentParams('export-kkres-image', { images: '..\\secret.png' }).join('\n')).toContain('not a local path');
    expect(validateAgentParams('export-kkres-image', { images: 'staging:a.exe' }).join('\n')).toContain('not a local path');
  });

  it('documents the 15-day archive range cap and the 30-day retention limit', () => {
    const skill = AGENT_SKILLS.find((candidate) => candidate.id === 'fetch-archive-changes');
    const from = skill?.fields.find((field) => field.name === 'from');
    const to = skill?.fields.find((field) => field.name === 'to');

    expect(skill?.description).toContain('15 天');
    expect(skill?.description).toContain('30 天');
    expect(from?.description).toContain('30 天');
    expect(to?.description).toContain('15 天');
  });

  it('caps absolute archive ranges at 15 days', () => {
    const base = { players: '30144230', mapId: '204521' };
    const oneDay = { ...base, from: '2026.09.10-00:00:00', to: '2026.09.11-00:00:00' };
    const exactly15Days = { ...base, from: '2026.09.10-00:00:00', to: '2026.09.25-00:00:00' };
    const sixteenDays = { ...base, from: '2026.09.10-00:00:00', to: '2026.09.26-00:00:00' };

    expect(ARCHIVE_CHANGE_MAX_RANGE_DAYS).toBe(15);
    expect(validateAgentParams('fetch-archive-changes', oneDay)).toEqual([]);
    expect(validateAgentParams('fetch-archive-changes', exactly15Days)).toEqual([]);
    expect(validateAgentParams('fetch-archive-changes', sixteenDays).join('\n')).toContain('must not exceed 15 days');
  });

  it('leaves the clock-dependent 30-day retention limit to the run-time skill helper', () => {
    const base = { players: '30144230', mapId: '204521' };
    const historicalRange = { ...base, from: '2026.06.09-00:00:00', to: '2026.06.16-00:00:00' };

    expect(ARCHIVE_CHANGE_RETENTION_DAYS).toBe(30);
    expect(validateAgentParams('fetch-archive-changes', historicalRange)).toEqual([]);
  });

  it('rejects reversed or invalid absolute archive ranges and accepts relative ranges for service-side normalization', () => {
    const base = { players: '30144230', mapId: '204521' };

    expect(validateAgentParams('fetch-archive-changes', { ...base, from: '2026.09.20-00:00:00', to: '2026.09.10-00:00:00' }).join('\n'))
      .toContain('must be after');
    expect(validateAgentParams('fetch-archive-changes', { ...base, from: '2026.02.31-00:00:00', to: '2026.03.01-00:00:00' }).join('\n'))
      .toContain('must be a valid date');
    expect(validateAgentParams('fetch-archive-changes', { ...base, from: '昨天', to: '现在' })).toEqual([]);
  });
});
