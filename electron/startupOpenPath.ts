import path from 'path';
import {
  ARCHIVE_FOLDER_NAME,
  ARCHIVE_STORAGE_FILE_NAME,
} from '../src/archiveViewer/archiveFileContract';
import { isCsvPath, isJsonPath } from '../src/utils/localInputContract';

export type StartupOpenPathKind = 'file' | 'directory' | 'missing';

export interface StartupOpenPathProbe {
  statPath: (candidatePath: string) => Promise<StartupOpenPathKind>;
}

export async function findStartupOpenPath(
  argv: readonly string[],
  platform: NodeJS.Platform,
  probe: StartupOpenPathProbe,
): Promise<string | null> {
  if (platform !== 'win32') return null;

  for (let index = argv.length - 1; index >= 1; index -= 1) {
    const candidate = normalizeStartupArg(argv[index]);
    if (!candidate) continue;
    if (shouldIgnoreStartupArg(candidate)) continue;

    if (await isSupportedStartupOpenPath(candidate, probe)) return candidate;

    // File association/open-with paths are passed as the trailing positional argument.
    // Once we have inspected the first real positional candidate, do not scan further
    // into Electron/Vite/script args where project directories may appear.
    return null;
  }

  return null;
}

export async function isSupportedStartupOpenPath(
  candidatePath: string,
  probe: StartupOpenPathProbe,
): Promise<boolean> {
  const kind = await probe.statPath(candidatePath);
  if (kind === 'file') return isCsvPath(candidatePath) || isJsonPath(candidatePath);
  if (kind === 'directory') return await isLikelyY3ProjectDirectory(candidatePath, probe);
  return false;
}

async function isLikelyY3ProjectDirectory(
  candidatePath: string,
  probe: StartupOpenPathProbe,
): Promise<boolean> {
  const projectPath = path.basename(candidatePath) === ARCHIVE_FOLDER_NAME
    ? path.dirname(candidatePath)
    : candidatePath;
  const archiveStoragePath = path.join(projectPath, ARCHIVE_FOLDER_NAME, ARCHIVE_STORAGE_FILE_NAME);
  return await probe.statPath(archiveStoragePath) === 'file';
}

function normalizeStartupArg(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  return trimmed;
}

function shouldIgnoreStartupArg(value: string): boolean {
  if (value.startsWith('-')) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return true;
  return false;
}
