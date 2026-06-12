import type { AgentSkillDefinition, AgentSkillId } from './types';

export const TRUSTED_RUNNER_WARNING = '共享任务服务：提交后会执行真实任务；任务按浏览器本地标识区分，服务可能限流、排队、维护或暂停提交。';

export const AGENT_SKILLS: AgentSkillDefinition[] = [
  {
    id: 'fetch-archive-changes',
    label: '拉取存档日志',
    description: '按玩家/aid、地图 id 和时间范围拉取 archive_diff 存档变动日志，最终仅提供 ZIP 下载包（内含 CSV 和摘要）。',
    fields: [
      { name: 'players', label: '玩家昵称或 aid', type: 'textarea', required: true, placeholder: '每行一个玩家名、昵称#后缀或 raw aid' },
      { name: 'mapId', label: '地图 ID', type: 'text', required: true, placeholder: '例如 204521', description: '对于 maptest、测试大厅的地图，地图 ID 需要多加一个 10 前缀。' },
      { name: 'from', label: '开始时间', type: 'datetime', required: true, placeholder: '可填 2026.06.09-10:00:00、昨天、今天 10 点等；agent 会归一化' },
      { name: 'to', label: '结束时间', type: 'datetime', required: true, placeholder: '可填 2026.06.09-12:00:00、现在、明天凌晨等；结束时间按 exclusive 处理' },
    ],
  },
  {
    id: 'fetch-mismatch-logs',
    label: '拉取不同步日志',
    description: '按地图 id 和天数拉取 Y3 mismatch/desync 日志，必要的运行环境由任务服务侧配置，最终仅提供 ZIP 下载包。',
    fields: [
      { name: 'mapId', label: '地图 ID', type: 'text', required: true, placeholder: '例如 10204416', description: '对于 maptest、测试大厅的地图，地图 ID 需要多加一个 10 前缀。' },
      { name: 'days', label: '最近天数', type: 'number', required: true, defaultValue: 7, description: '最近一周填 7，最近两周填 14。' },
    ],
  },
  {
    id: 'export-kkres-image',
    label: '导出 kkres 高分辨率图片',
    description: '使用已上传/暂存的图片标识导出 KKExport.kkres；图片上限为 4096*4096。',
    fields: [
      { name: 'images', label: '图片标识', type: 'textarea', required: true, placeholder: '每行一个 staging:xxx.png 或 public-input/xxx.png', description: '任务服务不接受任意本机路径；请使用上传/暂存后的图片标识。图片上限为 4096*4096。' },
    ],
  },
];

export function getAgentSkill(skillId: string): AgentSkillDefinition | undefined {
  return AGENT_SKILLS.find((skill) => skill.id === skillId);
}

export function isAgentSkillId(skillId: string): skillId is AgentSkillId {
  return getAgentSkill(skillId) !== undefined;
}


export function getAgentParamDefaults(skillId: AgentSkillId): Record<string, string | number> {
  const skill = getAgentSkill(skillId);
  if (!skill) return {};
  return Object.fromEntries(
    skill.fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.name, field.defaultValue as string | number]),
  );
}

export function applyAgentParamDefaults(skillId: AgentSkillId, params: Record<string, unknown>): Record<string, unknown> {
  return { ...getAgentParamDefaults(skillId), ...params };
}

export function validateAgentParams(skillId: AgentSkillId, params: Record<string, unknown>): string[] {
  const skill = getAgentSkill(skillId);
  if (!skill) return [`Unknown skill: ${skillId}`];

  const errors: string[] = [];
  for (const field of skill.fields) {
    const value = params[field.name];
    const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (field.required && missing) {
      errors.push(`${field.label} is required`);
      continue;
    }
    if (!missing && field.type === 'number' && Number.isNaN(Number(value))) {
      errors.push(`${field.label} must be a number`);
    }
  }
  if (errors.length > 0) return errors;

  if (skillId === 'fetch-archive-changes') return validateArchiveChangeParams(params);
  if (skillId === 'fetch-mismatch-logs') return validateMismatchParams(params);
  if (skillId === 'export-kkres-image') return validateKkresParams(params);
  return [];
}

function validateArchiveChangeParams(params: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const players = lines(params.players);
  if (players.length === 0) errors.push('玩家昵称或 aid is required');
  if (players.length > 50) errors.push('玩家昵称或 aid supports at most 50 lines');
  if (players.some((line) => line.length > 128)) errors.push('玩家昵称或 aid line is too long');
  validateMapId(params.mapId, errors);
  for (const name of ['from', 'to']) {
    const value = String(params[name] ?? '').trim();
    if (value.length > 80) errors.push(`${name} is too long`);
  }
  return errors;
}

function validateMismatchParams(params: Record<string, unknown>): string[] {
  const errors: string[] = [];
  validateMapId(params.mapId, errors);
  const days = Number(params.days);
  if (!Number.isInteger(days)) errors.push('最近天数 must be an integer');
  else if (days < 1 || days > 30) errors.push('最近天数 must be between 1 and 30');
  return errors;
}

function validateKkresParams(params: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const imageLines = lines(params.images);
  if (imageLines.length === 0) errors.push('图片标识 is required');
  if (imageLines.length > 50) errors.push('图片标识 supports at most 50 lines');
  if (imageLines.join('\n').length > 10_000) errors.push('图片标识 input is too large');
  for (const image of imageLines) {
    if (image.length > 260) errors.push('图片标识 line is too long');
    if (!isSafePublicImageIdentifier(image)) errors.push('图片标识 must be staging:*.png/jpg/webp or public-input/*.png/jpg/webp, not a local path');
  }
  return Array.from(new Set(errors));
}

function validateMapId(value: unknown, errors: string[]): void {
  const mapId = String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(mapId)) errors.push('地图 ID must be 1-20 digits');
}

function lines(value: unknown): string[] {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isSafePublicImageIdentifier(value: string): boolean {
  if (/^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value) || value.startsWith('/') || value.includes('..')) return false;
  if (/[;&|`$<>]/.test(value)) return false;
  if (!/\.(png|jpe?g|webp|bmp)$/i.test(value)) return false;
  return /^staging:[A-Za-z0-9._/-]+$/i.test(value) || /^public-input\/[A-Za-z0-9._/-]+$/i.test(value);
}
