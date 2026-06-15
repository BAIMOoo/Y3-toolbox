import fs from 'node:fs';
import net from 'node:net';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TRUSTED_RUNNER_WARNING } from '../../src/agentJobs/catalog';
import type { AgentSubmitRequest } from '../../src/agentJobs/types';
import { AgentJobStore } from './jobStore';
import type { RunnerConfig } from './contracts';

const CODEX_BIN_RELATIVE_PATH = ['node_modules', '@openai', 'codex', 'bin', 'codex.js'];
const DEFAULT_CODEX_ARGS_TEMPLATE = ['exec', '--cd', '{projectRoot}', '--dangerously-bypass-approvals-and-sandbox'];
const DEFAULT_AGENT_HEALTH_ARGS_TEMPLATE = ['--version'];
const KKRES_STAGING_MAX_BYTES = 64 * 1024 * 1024;
const KKRES_STAGING_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);

export function splitArgsTemplate(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) return fallback;
  const args: string[] = [];
  let current = '';
  let quote: '\'' | '"' | null = null;
  let escaped = false;
  for (const char of value.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '\'' || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  if (current) args.push(current);
  return args.length ? args : fallback;
}

function defaultAgentProcess(env: NodeJS.ProcessEnv): { command: string; argsTemplate: string[]; healthArgsTemplate: string[] } {
  const explicitCommand = env.AGENT_COMMAND?.trim();
  if (explicitCommand) {
    return {
      command: explicitCommand,
      argsTemplate: splitArgsTemplate(env.AGENT_ARGS_TEMPLATE, DEFAULT_CODEX_ARGS_TEMPLATE),
      healthArgsTemplate: splitArgsTemplate(env.AGENT_HEALTH_ARGS_TEMPLATE, DEFAULT_AGENT_HEALTH_ARGS_TEMPLATE),
    };
  }

  if (process.platform === 'win32') {
    const codexBin = path.join(path.dirname(process.execPath), ...CODEX_BIN_RELATIVE_PATH);
    if (fs.existsSync(codexBin)) {
      return {
        command: process.execPath,
        argsTemplate: [codexBin, ...splitArgsTemplate(env.AGENT_ARGS_TEMPLATE, DEFAULT_CODEX_ARGS_TEMPLATE)],
        healthArgsTemplate: [codexBin, ...splitArgsTemplate(env.AGENT_HEALTH_ARGS_TEMPLATE, DEFAULT_AGENT_HEALTH_ARGS_TEMPLATE)],
      };
    }
  }

  return {
    command: 'codex',
    argsTemplate: splitArgsTemplate(env.AGENT_ARGS_TEMPLATE, DEFAULT_CODEX_ARGS_TEMPLATE),
    healthArgsTemplate: splitArgsTemplate(env.AGENT_HEALTH_ARGS_TEMPLATE, DEFAULT_AGENT_HEALTH_ARGS_TEMPLATE),
  };
}

export function createDefaultConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const host = env.AGENT_RUNNER_HOST?.trim() || '127.0.0.1';
  const allowLan = host !== '127.0.0.1' && host !== 'localhost';
  const agentProcess = defaultAgentProcess(env);
  return {
    host,
    port: Number(env.AGENT_RUNNER_PORT || 8790),
    jobsRoot: path.resolve(env.AGENT_RUNNER_JOBS_ROOT || path.join(process.cwd(), '.omx', 'agent-jobs')),
    projectRoot: path.resolve(env.AGENT_RUNNER_PROJECT_ROOT || process.cwd()),
    maxConcurrentJobs: Math.max(1, Number(env.AGENT_RUNNER_MAX_CONCURRENT || 5)),
    maxQueuedJobs: Math.max(0, Number(env.AGENT_RUNNER_MAX_QUEUED || 10)),
    submissionsDisabled: env.AGENT_RUNNER_DISABLE_SUBMISSIONS === '1' || env.AGENT_RUNNER_MAINTENANCE === '1',
    jobTimeoutMs: Math.max(1000, Number(env.AGENT_RUNNER_TIMEOUT_MS || 1000 * 60 * 60)),
    maxCapturedOutputChars: Math.max(1000, Number(env.AGENT_RUNNER_MAX_OUTPUT_CHARS || 20_000)),
    trustProxy: env.AGENT_RUNNER_TRUST_PROXY === '1',
    maxActiveJobsPerSource: Math.max(1, Number(env.AGENT_RUNNER_MAX_ACTIVE_PER_SOURCE || 2)),
    allowLan,
    mockMode: env.AGENT_RUNNER_MOCK === '1',
    agentProviderName: env.AGENT_PROVIDER_NAME?.trim() || 'codex',
    agentCommand: agentProcess.command,
    agentArgsTemplate: agentProcess.argsTemplate,
    agentHealthArgsTemplate: agentProcess.healthArgsTemplate,
    archiveLogtailPath: env.AGENT_ARCHIVE_LOGTAIL_PATH,
    mismatchSourceRoot: env.AGENT_MISMATCH_SOURCE_ROOT || env.Y3_SOURCE_ROOT,
    kkresRuntimeRoot: env.AGENT_KKRES_RUNTIME_ROOT,
    kkresRepoRoot: env.AGENT_KKRES_REPO_ROOT,
    kkresProjectPath: env.AGENT_KKRES_PROJECT_PATH,
    kkresPublicInputRoot: env.AGENT_KKRES_PUBLIC_INPUT_ROOT,
    agentSkillRoot: env.AGENT_SKILL_ROOT,
  };
}

export function createAgentRunnerServer(config: RunnerConfig = createDefaultConfig()): http.Server {
  const store = new AgentJobStore(config);
  return http.createServer((req, res) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    void handleRequest(req, res, store, config).catch((err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }));
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, store: AgentJobStore, config: RunnerConfig): Promise<void> {
  const url = new URL(req.url || '/', `http://${config.host}:${config.port}`);
  if (req.method === 'GET' && url.pathname === '/api/skills') return sendJson(res, 200, { skills: store.listSkills(), warning: TRUSTED_RUNNER_WARNING });
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, await store.health());
  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    if (!isLocalRequest(req)) return sendJson(res, 404, { error: 'Not found' });
    return sendJson(res, 200, await store.diagnostics());
  }
  if (req.method === 'POST' && url.pathname === '/api/kkres/staging') {
    if (!isLocalRequest(req)) return sendJson(res, 404, { error: 'Not found' });
    try {
      const payload = await stageKkresUpload(req, config, readOwnerToken(req, url));
      return sendJson(res, 201, payload);
    } catch (err) {
      return sendJson(res, 400, { error: publicError(err instanceof Error ? err.message : String(err)) });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    await store.ready();
    return sendJson(res, 200, { jobs: store.listJobs(readOwnerToken(req, url)) });
  }
  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    const body = await readJson(req) as Partial<AgentSubmitRequest>;
    try {
      const ownerToken = readOwnerToken(req, url, body.ownerToken);
      if (!ownerToken) throw new Error('Owner token is required');
      const job = await store.submit(String(body.skillId || ''), asParams(body.params), ownerToken, getSourceKey(req, config));
      return sendJson(res, 201, { job });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /busy|maintenance|Owner token|throttled/i.test(message) ? 429 : 400;
      return sendJson(res, status, { error: publicError(message) });
    }
  }

  const eventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
  if (req.method === 'GET' && eventsMatch) {
    const afterValue = url.searchParams.get('after') ?? '0';
    const after = /^\d+$/.test(afterValue) ? Number(afterValue) : 0;
    const payload = await store.getJobEvents(decodeURIComponent(eventsMatch[1]), readOwnerToken(req, url), after);
    return payload ? sendJson(res, 200, payload) : sendJson(res, 404, { error: 'Job not found' });
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && jobMatch) {
    await store.ready();
    const job = store.getJob(decodeURIComponent(jobMatch[1]), readOwnerToken(req, url));
    return job ? sendJson(res, 200, { job }) : sendJson(res, 404, { error: 'Job not found' });
  }

  const artifactMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/artifacts\/([^/]+)$/);
  if (req.method === 'GET' && artifactMatch) {
    const artifact = await store.getArtifact(decodeURIComponent(artifactMatch[1]), decodeURIComponent(artifactMatch[2]), readOwnerToken(req, url));
    if (!artifact) return sendJson(res, 404, { error: 'Artifact not found' });
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename=${JSON.stringify(artifact.name)}`,
    });
    fs.createReadStream(artifact.path).pipe(res);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function asParams(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function readOwnerToken(req: IncomingMessage, url: URL, bodyValue?: unknown): string {
  const header = req.headers['x-owner-token'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const value = typeof bodyValue === 'string' ? bodyValue : headerValue || url.searchParams.get('ownerToken') || '';
  return value;
}

async function stageKkresUpload(req: IncomingMessage, config: RunnerConfig, ownerToken: string): Promise<{ identifier: string }> {
  if (!config.kkresPublicInputRoot?.trim()) throw new Error('KKRes public image input root is not configured');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(ownerToken)) throw new Error('Owner token is required');
  const contentLength = Number(firstHeader(req.headers['content-length']));
  if (Number.isFinite(contentLength) && contentLength > KKRES_STAGING_MAX_BYTES) throw new Error('KKRes staging image is too large');

  const originalName = decodeHeaderFilename(firstHeader(req.headers['x-filename'])) || 'image';
  const extension = path.extname(originalName).toLowerCase();
  if (!KKRES_STAGING_EXTENSIONS.has(extension)) throw new Error('KKRes staging image must be png/jpg/webp/bmp');

  const stagingDir = path.join(config.kkresPublicInputRoot, 'staging');
  await fs.promises.mkdir(stagingDir, { recursive: true });
  const safeStem = path.basename(originalName, extension).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64) || 'image';
  const safeName = `${Date.now()}-${randomUUID()}-${safeStem}${extension}`;
  const targetPath = path.join(stagingDir, safeName);
  await writeRequestBodyToFile(req, targetPath, KKRES_STAGING_MAX_BYTES);
  return { identifier: `staging:${safeName}` };
}

function decodeHeaderFilename(value: string): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function writeRequestBodyToFile(req: IncomingMessage, targetPath: string, maxBytes: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    const output = fs.createWriteStream(targetPath, { flags: 'wx' });
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      output.destroy();
      fs.promises.rm(targetPath, { force: true }).finally(() => reject(err));
    };
    output.on('error', fail);
    req.on('error', fail);
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) return fail(new Error('KKRes staging image is too large'));
      if (!output.write(chunk)) req.pause();
    });
    output.on('drain', () => req.resume());
    req.on('end', () => {
      if (settled) return;
      output.end(() => {
        if (settled) return;
        settled = true;
        if (bytes <= 0) {
          fs.promises.rm(targetPath, { force: true }).finally(() => reject(new Error('KKRes staging image is empty')));
          return;
        }
        resolve();
      });
    });
  });
}

function publicError(message: string): string {
  const sanitized = redactPublicText(message);
  if (/Unknown skill|Owner token|required|Invalid|must|Service busy|maintenance|not ready|too long|too many|between|throttled|local path/i.test(sanitized)) return sanitized;
  return 'Request rejected';
}

function redactPublicText(value: string): string {
  return value
    .replace(/[A-Za-z]:\\[^\s;,)]+/g, '[local-path]')
    .replace(/\\\\[^\s;,)]+/g, '[local-path]')
    .replace(/\/mnt\/[a-z]\/[^\s;,)]+/g, '[local-path]')
    .replace(/\b(?:AGENT|Y3|VITE)_[A-Z0-9_]+=[^\s;,)]+/g, '[env]');
}

function isLocalRequest(req: IncomingMessage): boolean {
  return isLoopbackAddress(req.socket.remoteAddress || '');
}

export function getSourceKey(req: IncomingMessage, config: Pick<RunnerConfig, 'trustProxy'>): string {
  const remoteAddress = req.socket.remoteAddress || 'unknown';
  const trustedPeer = isLoopbackAddress(remoteAddress);
  const proxyValue = firstHeader(req.headers['x-omx-client-ip']);
  if (config.trustProxy && trustedPeer && proxyValue && isPublicClientAddress(proxyValue)) return `trusted:${proxyValue}`;
  return `socket:${remoteAddress || 'unknown'}`;
}

function firstHeader(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function isLoopbackAddress(address: string): boolean {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, '');
  return /^10\./.test(normalized) || /^192\.168\./.test(normalized) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
}

function isPublicClientAddress(address: string): boolean {
  if (!net.isIP(address)) return false;
  return !isLoopbackAddress(address) && !isPrivateAddress(address) && !isLinkLocalAddress(address);
}

function isLinkLocalAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, '').toLowerCase();
  return /^169\.254\./.test(normalized) || normalized.startsWith('fe80:');
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (!origin || !isAllowedLocalOrigin(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Owner-Token, X-Filename');
}

function isAllowedLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ['127.0.0.1', 'localhost'].includes(url.hostname);
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export function startAgentRunner(config: RunnerConfig = createDefaultConfig()): http.Server {
  const server = createAgentRunnerServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`[agent-runner] listening on http://${config.host}:${config.port}`);
    console.log(`[agent-runner] ${TRUSTED_RUNNER_WARNING}`);
    if (config.allowLan) console.warn('[agent-runner] WARNING: non-loopback bind enabled by explicit config. Keep this off public networks.');
  });
  return server;
}
