export type JsonObject = Record<string, unknown>;

export interface MatchSection extends JsonObject {
  max_score: number;
  min_player_num: number;
}

export interface MatchRule extends JsonObject {
  game_mode: number | string;
  level_id: string;
  teams: number[];
  diffuse_time: number[];
  bot_fill_time?: number;
  sections: MatchSection[];
}

export interface DungeonModeConfig extends JsonObject {
  enable_public: 0 | 1;
  enable_private: 0 | 1;
  max_player_num: number;
  can_add_in_time: number;
}

export interface DungeonLevelConfig extends JsonObject {
  game_modes: Record<string, DungeonModeConfig>;
}

export type DungeonConfig = Record<string, DungeonLevelConfig>;

export interface LobbyDocument {
  matchRules: MatchRule[];
  dungeonConfig: DungeonConfig;
}

export interface LobbyDocumentInput {
  matchConfig: unknown;
  dungeonConfig: unknown;
}

export type LobbyIssueSeverity = 'error' | 'warning';

export interface LobbyIssue {
  severity: LobbyIssueSeverity;
  code: string;
  path: string;
  message: string;
}

export interface LobbyProjectMetadata {
  modeIds: string[];
  levelIds: string[];
}

export type MatchPreset = 'full-human' | 'timed-bots' | 'score-tiers';

export function createLobbyDocument(input: LobbyDocumentInput): LobbyDocument {
  if (!Array.isArray(input.matchConfig)) {
    throw new Error('match.json 根节点必须是数组');
  }
  if (!isPlainObject(input.dungeonConfig)) {
    throw new Error('dungeon.json 根节点必须是对象');
  }

  return {
    matchRules: structuredClone(input.matchConfig) as MatchRule[],
    dungeonConfig: structuredClone(input.dungeonConfig) as DungeonConfig,
  };
}

export function serializeLobbyDocument(document: LobbyDocument): { matchJson: string; dungeonJson: string } {
  return {
    matchJson: `${JSON.stringify(document.matchRules, null, 4)}\n`,
    dungeonJson: `${JSON.stringify(document.dungeonConfig, null, 4)}\n`,
  };
}

export function createDungeonEntry(document: LobbyDocument, levelId: string, modeId: string): LobbyDocument {
  const next = cloneDocument(document);
  const level = next.dungeonConfig[levelId];
  if (level?.game_modes?.[modeId]) return next;
  if (level) {
    level.game_modes = isPlainObject(level.game_modes) ? level.game_modes : {};
  } else {
    next.dungeonConfig[levelId] = { game_modes: {} };
  }
  next.dungeonConfig[levelId].game_modes[modeId] = {
    enable_public: 0,
    enable_private: 1,
    max_player_num: 8,
    can_add_in_time: 120,
  };
  return next;
}

export function setMatchEnabled(
  document: LobbyDocument,
  levelId: string,
  modeId: string,
  enabled: boolean,
): LobbyDocument {
  const next = cloneDocument(document);
  const matchingIndexes = indexesForPair(next, levelId, modeId);
  if (!enabled) {
    next.matchRules = next.matchRules.filter((_, index) => !matchingIndexes.includes(index));
    return next;
  }
  if (matchingIndexes.length > 0) return next;

  const capacity = next.dungeonConfig[levelId]?.game_modes?.[modeId]?.max_player_num ?? 8;
  next.matchRules.push({
    game_mode: Number(modeId),
    level_id: levelId,
    teams: [capacity],
    diffuse_time: [10],
    bot_fill_time: 60,
    sections: [{ max_score: 2147483647, min_player_num: capacity }],
  });
  return next;
}

export function applyMatchPreset(
  document: LobbyDocument,
  levelId: string,
  modeId: string,
  pairRuleIndex: number,
  preset: MatchPreset,
): LobbyDocument {
  const next = cloneDocument(document);
  const index = indexesForPair(next, levelId, modeId)[pairRuleIndex];
  if (index === undefined) return next;
  const rule = next.matchRules[index];
  const capacity = sum(rule.teams);
  if (preset === 'full-human') {
    Object.assign(rule, {
      diffuse_time: [2147483647],
      bot_fill_time: 0,
      sections: mergePresetSections(rule.sections, [
        { max_score: 2147483647, min_player_num: capacity },
      ]),
    });
  } else if (preset === 'timed-bots') {
    Object.assign(rule, {
      diffuse_time: [10],
      bot_fill_time: 60,
      sections: mergePresetSections(rule.sections, [
        { max_score: 2147483647, min_player_num: capacity },
      ]),
    });
  } else {
    Object.assign(rule, {
      diffuse_time: [10, 30, 60],
      bot_fill_time: 60,
      sections: mergePresetSections(rule.sections, [
        { max_score: 1000, min_player_num: Math.max(1, Math.ceil(capacity / 2)) },
        { max_score: 3000, min_player_num: Math.max(1, Math.ceil(capacity * 0.75)) },
        { max_score: 6900, min_player_num: capacity },
      ]),
    });
  }
  return next;
}

export function removeDungeonEntry(document: LobbyDocument, levelId: string, modeId: string): LobbyDocument {
  const next = setMatchEnabled(document, levelId, modeId, false);
  const level = next.dungeonConfig[levelId];
  if (!level || !isPlainObject(level.game_modes)) return next;
  delete level.game_modes[modeId];
  if (Object.keys(level.game_modes).length === 0 && Object.keys(level).every((key) => key === 'game_modes')) {
    delete next.dungeonConfig[levelId];
  }
  return next;
}

export function updateDungeonMode(
  document: LobbyDocument,
  levelId: string,
  modeId: string,
  patch: Partial<DungeonModeConfig>,
): LobbyDocument {
  const next = cloneDocument(document);
  const mode = next.dungeonConfig[levelId]?.game_modes?.[modeId];
  if (mode) Object.assign(mode, patch);
  return next;
}

export function updateMatchRule(
  document: LobbyDocument,
  levelId: string,
  modeId: string,
  pairRuleIndex: number,
  patch: Partial<MatchRule>,
): LobbyDocument {
  const next = cloneDocument(document);
  const index = indexesForPair(next, levelId, modeId)[pairRuleIndex];
  if (index !== undefined) Object.assign(next.matchRules[index], patch);
  return next;
}

export function syncDungeonCapacity(
  document: LobbyDocument,
  levelId: string,
  modeId: string,
  pairRuleIndex: number,
): LobbyDocument {
  const next = cloneDocument(document);
  const index = indexesForPair(next, levelId, modeId)[pairRuleIndex];
  const mode = next.dungeonConfig[levelId]?.game_modes?.[modeId];
  if (index !== undefined && mode) mode.max_player_num = sum(next.matchRules[index].teams);
  return next;
}

export function removeMatchRule(
  document: LobbyDocument,
  levelId: string,
  modeId: string,
  pairRuleIndex: number,
): LobbyDocument {
  const next = cloneDocument(document);
  const index = indexesForPair(next, levelId, modeId)[pairRuleIndex];
  if (index !== undefined) next.matchRules.splice(index, 1);
  return next;
}

export function validateLobbyDocument(document: LobbyDocument, metadata: LobbyProjectMetadata): LobbyIssue[] {
  const issues: LobbyIssue[] = [];
  const seenPairs = new Set<string>();
  const referencedLevels = new Set<string>();
  const referencedModes = new Set<string>();
  const modeIds = new Set(metadata.modeIds);
  const levelIds = new Set(metadata.levelIds);

  document.matchRules.forEach((candidate, index) => {
    const basePath = `match[${index}]`;
    if (!isPlainObject(candidate)) {
      issues.push(issue('error', 'match-rule-shape', basePath, '匹配规则必须是对象'));
      return;
    }

    const rule = candidate as Partial<MatchRule>;
    const modeId = normalizeIntegerId(rule.game_mode);
    const levelId = typeof rule.level_id === 'string' ? rule.level_id.trim() : '';
    const teams = validPositiveIntegerArray(rule.teams) ? rule.teams : null;
    const diffuseTimes = validNonNegativeIntegerArray(rule.diffuse_time) ? rule.diffuse_time : null;
    const sections = Array.isArray(rule.sections) ? rule.sections : null;

    if (!modeId) {
      issues.push(issue('error', 'game-mode-shape', `${basePath}.game_mode`, '模式 ID 必须是整数或整数字符串'));
    } else if (!modeIds.has(modeId)) {
      issues.push(issue('error', 'unknown-mode', `${basePath}.game_mode`, `模式 ${modeId} 不存在于 gamemode.json`));
    }
    if (modeId) referencedModes.add(modeId);

    if (!levelId) {
      issues.push(issue('error', 'level-id-shape', `${basePath}.level_id`, '关卡 ID 必须是非空字符串'));
    } else if (!levelIds.has(levelId)) {
      issues.push(issue('warning', 'unknown-local-level', `${basePath}.level_id`, `未在 maps/*/header.map 中找到关卡 ${levelId}`));
    }
    if (levelId) referencedLevels.add(levelId);

    if (!teams) {
      issues.push(issue('error', 'teams-shape', `${basePath}.teams`, '阵营必须是由正整数组成的非空数组'));
    }

    if (!diffuseTimes) {
      issues.push(issue('error', 'diffuse-shape', `${basePath}.diffuse_time`, '扩散时间必须是由非负整数组成的非空数组'));
    } else if (!isStrictlyIncreasing(diffuseTimes)) {
      issues.push(issue('error', 'diffuse-order', `${basePath}.diffuse_time`, '扩散时间必须严格递增'));
    }

    if (!sections || sections.length === 0 || sections.some((section) => !validMatchSection(section))) {
      issues.push(issue('error', 'sections-shape', `${basePath}.sections`, '分数段必须包含整数上限和正整数最低真人数'));
    } else {
      const maxScores = sections.map((section) => section.max_score);
      if (!isStrictlyIncreasing(maxScores)) {
        issues.push(issue('error', 'section-order', `${basePath}.sections`, '分数段上限必须严格递增'));
      }
      if (teams) {
        const capacity = sum(teams);
        if (sections.some((section) => section.min_player_num > capacity)) {
          issues.push(issue('error', 'minimum-player-capacity', `${basePath}.sections`, '最低真人数不能超过阵营总人数'));
        }
      }
    }

    if (rule.bot_fill_time !== undefined && !isNonNegativeInteger(rule.bot_fill_time)) {
      issues.push(issue('error', 'bot-fill-shape', `${basePath}.bot_fill_time`, '机器人补位时间必须是非负整数'));
    }

    if (!modeId || !levelId) return;
    const pairKey = `${levelId}:${modeId}`;
    if (seenPairs.has(pairKey)) {
      issues.push(issue('error', 'duplicate-match-rule', basePath, '同一副本最多只能有一条匹配规则'));
    }
    seenPairs.add(pairKey);

    const level = document.dungeonConfig[levelId];
    if (!level || !isPlainObject(level)) {
      issues.push(issue('error', 'missing-dungeon-level', `${basePath}.level_id`, 'dungeon.json 缺少对应关卡'));
      return;
    }
    const dungeonMode = isPlainObject(level.game_modes) ? level.game_modes[modeId] : undefined;
    if (!dungeonMode || !isPlainObject(dungeonMode)) {
      issues.push(issue('error', 'missing-dungeon-mode', `${basePath}.game_mode`, 'dungeon.json 缺少对应关卡和模式'));
      return;
    }
    if (teams && isPositiveInteger(dungeonMode.max_player_num) && sum(teams) > dungeonMode.max_player_num) {
      issues.push(issue('error', 'dungeon-capacity', `${basePath}.teams`, '阵营总人数超过 dungeon 房间容量'));
    }
  });

  validateDungeonConfig(document.dungeonConfig, modeIds, levelIds, referencedLevels, referencedModes, issues);
  return issues;
}

function validateDungeonConfig(
  config: DungeonConfig,
  modeIds: Set<string>,
  levelIds: Set<string>,
  referencedLevels: Set<string>,
  referencedModes: Set<string>,
  issues: LobbyIssue[],
): void {
  for (const [levelId, candidate] of Object.entries(config)) {
    const basePath = `dungeon.${levelId}`;
    if (!levelIds.has(levelId) && !referencedLevels.has(levelId)) {
      issues.push(issue('warning', 'unknown-dungeon-level', basePath, `未在 maps/*/header.map 中找到关卡 ${levelId}`));
    }
    if (!isPlainObject(candidate) || !isPlainObject(candidate.game_modes)) {
      issues.push(issue('error', 'dungeon-level-shape', basePath, '关卡配置必须包含 game_modes 对象'));
      continue;
    }
    for (const [modeId, mode] of Object.entries(candidate.game_modes)) {
      const modePath = `${basePath}.game_modes.${modeId}`;
      if (!modeIds.has(modeId) && !referencedModes.has(modeId)) {
        issues.push(issue('error', 'unknown-dungeon-mode', modePath, `模式 ${modeId} 不存在于 gamemode.json`));
      }
      if (!isPlainObject(mode)) {
        issues.push(issue('error', 'dungeon-mode-shape', modePath, '模式配置必须是对象'));
        continue;
      }
      if (!isBinary(mode.enable_public) || !isBinary(mode.enable_private)) {
        issues.push(issue('error', 'dungeon-entry-switches', modePath, '公开和私人入口开关必须是 0 或 1'));
      }
      if (!isPositiveInteger(mode.max_player_num)) {
        issues.push(issue('error', 'dungeon-max-player', `${modePath}.max_player_num`, '房间容量必须是正整数'));
      }
      if (!isNonNegativeInteger(mode.can_add_in_time)) {
        issues.push(issue('error', 'dungeon-join-time', `${modePath}.can_add_in_time`, '中途加入时间必须是非负整数'));
      }
    }
  }
}

function issue(severity: LobbyIssueSeverity, code: string, path: string, message: string): LobbyIssue {
  return { severity, code, path, message };
}

function normalizeIntegerId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim()).toString();
  return null;
}

function validPositiveIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPositiveInteger);
}

function validNonNegativeIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonNegativeInteger);
}

function validMatchSection(value: unknown): value is MatchSection {
  return isPlainObject(value) && Number.isInteger(value.max_score) && isPositiveInteger(value.min_player_num);
}

function isStrictlyIncreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isBinary(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function cloneDocument(document: LobbyDocument): LobbyDocument {
  return structuredClone(document);
}

function mergePresetSections(current: MatchSection[], replacements: MatchSection[]): MatchSection[] {
  return replacements.map((replacement, index) => ({
    ...(isPlainObject(current[index]) ? current[index] : {}),
    ...replacement,
  })) as MatchSection[];
}

function indexesForPair(document: LobbyDocument, levelId: string, modeId: string): number[] {
  const indexes: number[] = [];
  document.matchRules.forEach((rule, index) => {
    if (isPlainObject(rule)
      && rule.level_id === levelId
      && normalizeIntegerId(rule.game_mode) === modeId) indexes.push(index);
  });
  return indexes;
}

export function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
