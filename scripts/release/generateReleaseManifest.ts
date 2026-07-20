import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReleaseManifestInput {
  projectRoot: string;
  releaseTrainId: string;
  clientVersion: string;
  backendVersion: string;
  minimumClientVersion: string;
  supportedClientRange: string;
  commit: string;
  builtAt: string;
  releaseTag: string;
  latestClientUrl: string;
  releaseNotesUrl: string;
  publicRuntimeTarget: string;
  portableArtifactName: string;
}

export interface ReleaseManifest {
  schemaVersion: 1;
  releaseTrainId: string;
  clientVersion: string;
  backendVersion: string;
  minimumClientVersion: string;
  supportedClientRange: string;
  commit: string;
  builtAt: string;
  releaseTag: string;
  latestClientUrl: string;
  releaseNotesUrl: string;
  publicRuntimeTarget: string;
  portableArtifactName: string;
  verification: {
    requiredCommands: string[];
    workflowEvidence: Record<string, string>;
  };
  promotion: {
    canonicalScript: 'scripts/windows/sync-public-runtime.ps1';
    status: 'candidate';
    dryRunDefault: true;
    restartRequiresExplicitFlag: true;
    rollbackSupported: true;
  };
}

interface PackageJson {
  version?: unknown;
}

const DEFAULT_PUBLIC_RUNTIME_TARGET = 'configured-public-runtime';
const DEFAULT_RELEASE_URL = 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest';
const REQUIRED_COMMANDS = ['npx tsc -b --pretty false', 'npm run lint', 'npm run test'];

export function buildReleaseManifest(input: ReleaseManifestInput): ReleaseManifest {
  assertSemver(input.clientVersion, 'clientVersion');
  assertSemver(input.backendVersion, 'backendVersion');
  assertSemver(input.minimumClientVersion, 'minimumClientVersion');
  assertSupportedClientRange(input.supportedClientRange, input.minimumClientVersion);
  assertVersionInSupportedRange(input.clientVersion, input.supportedClientRange, 'clientVersion');
  if (input.releaseTag !== `v${input.clientVersion}`) throw new Error('releaseTag must equal v<clientVersion>');
  if (input.releaseTrainId !== input.releaseTag) throw new Error('releaseTrainId must equal releaseTag');
  for (const field of ['releaseTrainId', 'commit', 'builtAt', 'releaseTag', 'latestClientUrl', 'releaseNotesUrl', 'publicRuntimeTarget', 'portableArtifactName'] as const) {
    if (!input[field].trim()) throw new Error(`${field} is required`);
  }

  return {
    schemaVersion: 1,
    releaseTrainId: input.releaseTrainId,
    clientVersion: input.clientVersion,
    backendVersion: input.backendVersion,
    minimumClientVersion: input.minimumClientVersion,
    supportedClientRange: input.supportedClientRange,
    commit: input.commit,
    builtAt: input.builtAt,
    releaseTag: input.releaseTag,
    latestClientUrl: input.latestClientUrl,
    releaseNotesUrl: input.releaseNotesUrl,
    publicRuntimeTarget: input.publicRuntimeTarget,
    portableArtifactName: input.portableArtifactName,
    verification: {
      requiredCommands: REQUIRED_COMMANDS,
      workflowEvidence: {
        typecheck: 'GitHub Actions Typecheck step must pass before this manifest is published.',
        lint: 'GitHub Actions Lint step must pass before this manifest is published.',
        test: 'GitHub Actions Test step must pass before this manifest is published.',
        portablePackaging: 'GitHub Actions Build Electron package step keeps the existing portable Windows target.',
      },
    },
    promotion: {
      canonicalScript: 'scripts/windows/sync-public-runtime.ps1',
      status: 'candidate',
      dryRunDefault: true,
      restartRequiresExplicitFlag: true,
      rollbackSupported: true,
    },
  };
}

export function createReleaseManifestInputFromEnv(projectRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): ReleaseManifestInput {
  const clientVersion = env.RELEASE_CLIENT_VERSION?.trim() || readPackageVersion(projectRoot);
  const backendVersion = requiredEnv(env, 'RELEASE_BACKEND_VERSION');
  const releaseTag = env.RELEASE_TAG?.trim() || `v${clientVersion}`;
  const releaseTrainId = env.RELEASE_TRAIN_ID?.trim() || releaseTag;
  const minimumClientVersion = requiredEnv(env, 'RELEASE_MINIMUM_CLIENT_VERSION');
  return {
    projectRoot,
    releaseTrainId,
    clientVersion,
    backendVersion,
    minimumClientVersion,
    supportedClientRange: requiredEnv(env, 'RELEASE_SUPPORTED_CLIENT_RANGE'),
    commit: env.RELEASE_COMMIT?.trim() || readGitCommit(projectRoot),
    builtAt: requiredEnv(env, 'RELEASE_BUILT_AT'),
    releaseTag,
    latestClientUrl: env.RELEASE_LATEST_CLIENT_URL?.trim() || DEFAULT_RELEASE_URL,
    releaseNotesUrl: env.RELEASE_NOTES_URL?.trim() || DEFAULT_RELEASE_URL,
    publicRuntimeTarget: env.RELEASE_PUBLIC_RUNTIME_TARGET?.trim() || DEFAULT_PUBLIC_RUNTIME_TARGET,
    portableArtifactName: env.RELEASE_PORTABLE_ARTIFACT_NAME?.trim() || `Y3-Toolbox-${releaseTag.replace(/^v/, '')}.exe`,
  };
}

export function writeReleaseManifest(manifest: ReleaseManifest, outputPath: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function readPackageVersion(projectRoot: string): string {
  const packagePath = path.join(projectRoot, 'package.json');
  const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as PackageJson;
  if (typeof parsed.version !== 'string' || !parsed.version.trim()) throw new Error('package.json version is required');
  return parsed.version.trim();
}

function readGitCommit(projectRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string, fallback = ''): string {
  const value = env[name]?.trim() || fallback.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertSemver(value: string, label: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`${label} must be semver-like x.y.z`);
}

function assertSupportedClientRange(range: string, minimumClientVersion: string): void {
  const parsedMinimum = parseVersion(minimumClientVersion);
  if (!parsedMinimum) throw new Error('minimumClientVersion must be semver-like x.y.z');
  const gte = range.match(/^>=(\d+\.\d+\.\d+)$/);
  if (gte) {
    const lower = parseVersion(gte[1]);
    if (!lower || compareVersions(parsedMinimum, lower) < 0) throw new Error('supportedClientRange must include minimumClientVersion');
    return;
  }
  const between = range.match(/^(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)$/);
  if (between) {
    const lower = parseVersion(between[1]);
    const upper = parseVersion(between[2]);
    if (!lower || !upper || compareVersions(lower, upper) > 0) throw new Error('supportedClientRange bounds are invalid');
    if (compareVersions(parsedMinimum, lower) < 0 || compareVersions(parsedMinimum, upper) > 0) throw new Error('supportedClientRange must include minimumClientVersion');
    return;
  }
  throw new Error('supportedClientRange must be >=x.y.z or x.y.z - a.b.c');
}

function assertVersionInSupportedRange(version: string, range: string, label: string): void {
  const parsedVersion = parseVersion(version);
  if (!parsedVersion) throw new Error(`${label} must be semver-like x.y.z`);
  const gte = range.match(/^>=(\d+\.\d+\.\d+)$/);
  if (gte) {
    const lower = parseVersion(gte[1]);
    if (lower && compareVersions(parsedVersion, lower) >= 0) return;
  }
  const between = range.match(/^(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)$/);
  if (between) {
    const lower = parseVersion(between[1]);
    const upper = parseVersion(between[2]);
    if (lower && upper && compareVersions(parsedVersion, lower) >= 0 && compareVersions(parsedVersion, upper) <= 0) return;
  }
  throw new Error(`supportedClientRange must include ${label}`);
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function main(): void {
  const projectRoot = process.cwd();
  const outputArgIndex = process.argv.findIndex((arg) => arg === '--output');
  const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : 'release/release-manifest.json';
  if (!outputPath) throw new Error('--output requires a path');
  const manifest = buildReleaseManifest(createReleaseManifestInputFromEnv(projectRoot));
  writeReleaseManifest(manifest, outputPath);
  console.log(`Wrote release manifest: ${outputPath}`);
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (executedPath === modulePath) main();
