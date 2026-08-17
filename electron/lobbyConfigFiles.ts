import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  LobbyConfigRevisions,
  LobbyProjectFile,
  LobbyProjectSnapshot,
  SaveLobbyConfigRequest,
} from '../src/lobbyConfig/contracts';
import { createLobbyDocument, validateLobbyDocument } from '../src/lobbyConfig/model';

const MATCH_FILE_NAME = 'match.json';
const DUNGEON_FILE_NAME = 'dungeon.json';

export class LobbyProjectUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LobbyProjectUserError';
  }
}

export class LobbyProjectConflictError extends LobbyProjectUserError {
  constructor() {
    super('配置文件已被其他程序修改，请重新载入项目后再保存');
    this.name = 'LobbyProjectConflictError';
  }
}

export function lobbyProjectErrorMessage(error: unknown, fallback: string): string {
  return error instanceof LobbyProjectUserError ? error.message : fallback;
}

export async function readLobbyProject(projectInput: string): Promise<LobbyProjectSnapshot> {
  const projectPath = path.resolve(projectInput);
  await assertSourceProject(projectPath);

  const [match, dungeon, modes, maps] = await Promise.all([
    readConfigFile<unknown[]>(path.join(projectPath, MATCH_FILE_NAME), []),
    readConfigFile<Record<string, unknown>>(path.join(projectPath, DUNGEON_FILE_NAME), {}),
    readModes(path.join(projectPath, 'gamemode.json')),
    readMaps(path.join(projectPath, 'maps')),
  ]);

  if (!Array.isArray(match.config)) throw new LobbyProjectUserError('match.json 根节点必须是数组');
  if (!isPlainObject(dungeon.config)) throw new LobbyProjectUserError('dungeon.json 根节点必须是对象');

  return {
    projectPath,
    projectName: path.basename(projectPath),
    match,
    dungeon,
    modes,
    maps,
  };
}

export async function saveLobbyProject(request: SaveLobbyConfigRequest): Promise<LobbyConfigRevisions> {
  const projectPath = path.resolve(request.projectPath);
  await assertSourceProject(projectPath);
  const matchPath = path.join(projectPath, MATCH_FILE_NAME);
  const dungeonPath = path.join(projectPath, DUNGEON_FILE_NAME);
  const [matchRevision, dungeonRevision] = await Promise.all([
    currentRevision(matchPath),
    currentRevision(dungeonPath),
  ]);
  if (matchRevision !== request.matchRevision || dungeonRevision !== request.dungeonRevision) {
    throw new LobbyProjectConflictError();
  }

  const matchConfig = parseJson(request.matchJson, MATCH_FILE_NAME);
  const dungeonConfig = parseJson(request.dungeonJson, DUNGEON_FILE_NAME);
  if (!Array.isArray(matchConfig)) throw new LobbyProjectUserError('match.json 根节点必须是数组');
  if (!isPlainObject(dungeonConfig)) throw new LobbyProjectUserError('dungeon.json 根节点必须是对象');

  const [modes, maps] = await Promise.all([
    readModes(path.join(projectPath, 'gamemode.json')),
    readMaps(path.join(projectPath, 'maps')),
  ]);
  const issues = validateLobbyDocument(createLobbyDocument({ matchConfig, dungeonConfig }), {
    modeIds: modes.map((mode) => mode.id),
    levelIds: maps.map((map) => map.id),
  });
  const firstError = issues.find((issue) => issue.severity === 'error');
  if (firstError) {
    throw new LobbyProjectUserError(`配置校验失败：${firstError.message}（${firstError.path}）`);
  }

  await replaceConfigPair(
    matchPath,
    request.matchJson,
    request.matchRevision,
    dungeonPath,
    request.dungeonJson,
    request.dungeonRevision,
  );
  return {
    matchRevision: hashText(request.matchJson),
    dungeonRevision: hashText(request.dungeonJson),
  };
}

async function assertSourceProject(projectPath: string): Promise<void> {
  const [header, gamemode, maps] = await Promise.all([
    isFile(path.join(projectPath, 'header.project')),
    isFile(path.join(projectPath, 'gamemode.json')),
    isDirectory(path.join(projectPath, 'maps')),
  ]);
  if (!header || !gamemode || !maps) {
    throw new LobbyProjectUserError('请选择包含 header.project、gamemode.json 和 maps 文件夹的 Y3 源码项目');
  }
}

async function readConfigFile<T>(filePath: string, missingValue: T): Promise<LobbyProjectFile<T>> {
  try {
    const content = await readUtf8(filePath);
    return {
      path: filePath,
      exists: true,
      revision: hashText(content),
      config: parseJson(content, path.basename(filePath)) as T,
    };
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return { path: filePath, exists: false, revision: null, config: structuredClone(missingValue) };
  }
}

async function readModes(filePath: string): Promise<Array<{ id: string; name: string }>> {
  const parsed = parseJson(await readUtf8(filePath), 'gamemode.json');
  if (!isPlainObject(parsed) || !isPlainObject(parsed.game_modes)) {
    throw new LobbyProjectUserError('gamemode.json 缺少 game_modes 对象');
  }
  return Object.entries(parsed.game_modes).map(([id, candidate]) => ({
    id,
    name: isPlainObject(candidate) && typeof candidate.desc === 'string' ? candidate.desc : `模式 ${id}`,
  }));
}

async function readMaps(mapsPath: string): Promise<Array<{ id: string; directory: string }>> {
  const entries = await fs.readdir(mapsPath, { withFileTypes: true });
  const maps = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const headerPath = path.join(mapsPath, entry.name, 'header.map');
    try {
      const headerText = await readUtf8(headerPath);
      const match = /"id"\s*:\s*(?:"(\d+)"|(\d+))/.exec(headerText);
      return match ? { id: match[1] ?? match[2], directory: entry.name } : null;
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }
  }));
  return maps.filter((map): map is { id: string; directory: string } => map !== null)
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

async function replaceConfigPair(
  matchPath: string,
  matchJson: string,
  expectedMatchRevision: string | null,
  dungeonPath: string,
  dungeonJson: string,
  expectedDungeonRevision: string | null,
): Promise<void> {
  const suffix = `.y3-toolbox-${randomUUID()}.tmp`;
  const matchTemp = `${matchPath}${suffix}`;
  const dungeonTemp = `${dungeonPath}${suffix}`;
  const [oldMatch, oldDungeon] = await Promise.all([readOptional(matchPath), readOptional(dungeonPath)]);
  let replacementStarted = false;
  try {
    if (revisionForOptional(oldMatch) !== expectedMatchRevision || revisionForOptional(oldDungeon) !== expectedDungeonRevision) {
      throw new LobbyProjectConflictError();
    }
    await Promise.all([fs.writeFile(matchTemp, matchJson, 'utf8'), fs.writeFile(dungeonTemp, dungeonJson, 'utf8')]);
    const [latestMatchRevision, latestDungeonRevision] = await Promise.all([
      currentRevision(matchPath),
      currentRevision(dungeonPath),
    ]);
    if (latestMatchRevision !== expectedMatchRevision || latestDungeonRevision !== expectedDungeonRevision) {
      throw new LobbyProjectConflictError();
    }
    replacementStarted = true;
    await fs.rename(matchTemp, matchPath);
    await fs.rename(dungeonTemp, dungeonPath);
  } catch (error) {
    if (replacementStarted) {
      await restoreOptional(matchPath, oldMatch);
      await restoreOptional(dungeonPath, oldDungeon);
    }
    throw error;
  } finally {
    await Promise.all([fs.rm(matchTemp, { force: true }), fs.rm(dungeonTemp, { force: true })]);
  }
}

function revisionForOptional(content: string | null): string | null {
  if (content === null) return null;
  return hashText(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);
}

async function currentRevision(filePath: string): Promise<string | null> {
  try {
    return hashText(await readUtf8(filePath));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function restoreOptional(filePath: string, content: string | null): Promise<void> {
  if (content === null) {
    await fs.rm(filePath, { force: true });
  } else {
    await fs.writeFile(filePath, content, 'utf8');
  }
}

async function readUtf8(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf8');
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function parseJson(content: string, fileName: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new LobbyProjectUserError(`${fileName} 不是有效 JSON`);
  }
}

function hashText(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isPlainObject(error) && error.code === 'ENOENT';
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}
