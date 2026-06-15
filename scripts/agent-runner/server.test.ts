import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createAgentRunnerServer, createDefaultConfig, splitArgsTemplate } from './server';
import type { AgentJobSummary, AgentSkillDefinition } from '../../src/agentJobs/types';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const OWNER_A = 'owner-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER_B = 'owner-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function ownerHeaders(ownerToken = OWNER_A) {
  return { 'Content-Type': 'application/json', 'X-Owner-Token': ownerToken };
}

async function start(root: string, env: NodeJS.ProcessEnv = {}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = createAgentRunnerServer(createDefaultConfig({
      AGENT_RUNNER_HOST: '127.0.0.1',
      AGENT_RUNNER_PORT: '0',
      AGENT_RUNNER_JOBS_ROOT: path.join(root, 'jobs'),
      AGENT_RUNNER_PROJECT_ROOT: process.cwd(),
      AGENT_RUNNER_MOCK: '1',
      AGENT_PROVIDER_NAME: 'mock-agent',
      ...env,
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    if (!isFetchForbiddenPort(address.port)) {
      servers.push(server);
      return `http://127.0.0.1:${address.port}`;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  throw new Error('could not allocate fetch-allowed test server port');
}

function isFetchForbiddenPort(port: number): boolean {
  return FETCH_FORBIDDEN_PORTS.has(port) || (port >= 6665 && port <= 6669);
}

const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587,
  601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6697, 10080,
]);

describe('agent runner HTTP API', () => {
  it('serves catalog, submits job, polls status, and downloads artifact by id', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-server-'));
    const base = await start(root);
    const health = await fetch(`${base}/api/health`).then((res) => res.json()) as { agentProvider?: unknown; queue: { maxRunning: number; maxQueued: number } };
    expect(health.agentProvider).toBeUndefined();
    expect(health.queue).toMatchObject({ maxRunning: 5, maxQueued: 10 });
    const diagnostics = await fetch(`${base}/api/diagnostics`).then((res) => res.json()) as { agentProvider: { name: string; ready: boolean } };
    expect(diagnostics.agentProvider).toEqual({ name: 'mock-agent', ready: true, details: ['mock agent provider enabled'] });
    const skills = await fetch(`${base}/api/skills`).then((res) => res.json()) as { skills: AgentSkillDefinition[] };
    expect(skills.skills.map((skill) => skill.id)).toEqual(['fetch-archive-changes', 'fetch-mismatch-logs', 'export-kkres-image']);

    const rejected = await fetch(`${base}/api/jobs`, { method: 'POST', headers: ownerHeaders(), body: JSON.stringify({ skillId: 'bad', params: {} }) });
    expect(rejected.status).toBe(400);

    const created = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({ skillId: 'fetch-mismatch-logs', params: { mapId: '10204416', days: 7 } }),
    }).then((res) => res.json()) as { job: AgentJobSummary };
    const id = created.job.id;
    let job = created.job;
    for (let i = 0; i < 50 && job.status !== 'succeeded' && job.status !== 'failed'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await fetch(`${base}/api/jobs/${id}`, { headers: ownerHeaders() }).then((res) => res.json()).then((payload) => (payload as { job: AgentJobSummary }).job);
    }
    expect(job.status).toBe('succeeded');
    expect(job.artifacts.length).toBeGreaterThan(0);
    const artifactRes = await fetch(`${base}${job.artifacts[0].downloadUrl}`, { headers: ownerHeaders() });
    expect(artifactRes.status).toBe(200);
    await expect(fetch(`${base}/api/jobs/${id}/artifacts/..%2Fbad`).then((res) => res.status)).resolves.toBe(404);
  }, 15_000);


  it('serves bounded job events and treats invalid after cursors as zero', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-server-'));
    const base = await start(root);
    const created = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({ skillId: 'fetch-mismatch-logs', params: { mapId: '10204416', days: 7 } }),
    }).then((res) => res.json()) as { job: AgentJobSummary };
    const id = created.job.id;
    let job = created.job;
    for (let i = 0; i < 50 && job.status !== 'succeeded' && job.status !== 'failed'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await fetch(`${base}/api/jobs/${id}`, { headers: ownerHeaders() }).then((res) => res.json()).then((payload) => (payload as { job: AgentJobSummary }).job);
    }
    expect(job.status).toBe('succeeded');

    const events = await fetch(`${base}/api/jobs/${id}/events?after=0`, { headers: ownerHeaders() }).then((res) => res.json()) as { events: Array<{ id: number; type: string }>; latestEventId: number; truncatedBefore?: number };
    expect(events.events.length).toBeGreaterThan(0);
    expect(events.latestEventId).toBeGreaterThan(0);
    const afterEvents = await fetch(`${base}/api/jobs/${id}/events?after=${events.latestEventId}`, { headers: ownerHeaders() }).then((res) => res.json()) as { events: unknown[]; latestEventId: number };
    expect(afterEvents.events).toEqual([]);
    expect(afterEvents.latestEventId).toBe(events.latestEventId);
    const invalidAfter = await fetch(`${base}/api/jobs/${id}/events?after=bad`, { headers: ownerHeaders() }).then((res) => res.json()) as { events: Array<{ id: number }>; latestEventId: number };
    expect(invalidAfter.events[0]?.id).toBe(events.events[0]?.id);
    await expect(fetch(`${base}/api/jobs/missing/events?after=0`, { headers: ownerHeaders() }).then((res) => res.status)).resolves.toBe(404);
  });

  it('uses restricted localhost CORS instead of wildcard CORS', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-server-'));
    const base = await start(root);
    const allowed = await fetch(`${base}/api/skills`, { headers: { Origin: 'http://127.0.0.1:5173' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
    expect(allowed.headers.get('access-control-allow-headers')).toContain('X-Owner-Token');
    expect(allowed.headers.get('access-control-allow-headers')).toContain('X-Filename');
    const denied = await fetch(`${base}/api/skills`, { headers: { Origin: 'http://evil.example' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('stages kkres image uploads under the configured public input root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-server-staging-'));
    const publicRoot = path.join(root, 'public-images');
    const base = await start(root, { AGENT_KKRES_PUBLIC_INPUT_ROOT: publicRoot });

    const response = await fetch(`${base}/api/kkres/staging`, {
      method: 'POST',
      headers: { ...ownerHeaders(), 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent('sample image.png') },
      body: Buffer.from('png-bytes'),
    });

    expect(response.status).toBe(201);
    const payload = await response.json() as { identifier: string };
    expect(payload.identifier).toMatch(/^staging:\d+-[-0-9a-f]+-sample_image\.png$/);
    const stagedPath = path.join(publicRoot, 'staging', payload.identifier.slice('staging:'.length));
    await expect(fs.readFile(stagedPath, 'utf8')).resolves.toBe('png-bytes');

    const rejected = await fetch(`${base}/api/kkres/staging`, {
      method: 'POST',
      headers: { ...ownerHeaders(), 'Content-Type': 'application/octet-stream', 'X-Filename': 'bad.exe' },
      body: Buffer.from('nope'),
    });
    expect(rejected.status).toBe(400);
  });

  it('defaults to loopback and flags LAN bind only by explicit config', () => {
    expect(createDefaultConfig({}).host).toBe('127.0.0.1');
    expect(createDefaultConfig({}).allowLan).toBe(false);
    expect(createDefaultConfig({ AGENT_RUNNER_HOST: '0.0.0.0' }).allowLan).toBe(true);
  });

  it('parses quoted agent argument templates for provider portability', () => {
    expect(splitArgsTemplate('run --prompt-file {promptFile} --label "Y3 agent mode"', [])).toEqual([
      'run',
      '--prompt-file',
      '{promptFile}',
      '--label',
      'Y3 agent mode',
    ]);
    expect(createDefaultConfig({
      AGENT_COMMAND: 'other-agent',
      AGENT_ARGS_TEMPLATE: 'run --file {promptFile}',
      AGENT_HEALTH_ARGS_TEMPLATE: 'doctor --project "{projectRoot}"',
    })).toMatchObject({
      agentCommand: 'other-agent',
      agentArgsTemplate: ['run', '--file', '{promptFile}'],
      agentHealthArgsTemplate: ['doctor', '--project', '{projectRoot}'],
    });
  });

  it('uses a direct node command for the default Windows Codex provider when available', async () => {
    const config = createDefaultConfig({});
    const codexBin = path.join(path.dirname(process.execPath), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const directCodexAvailable = process.platform === 'win32'
      && await fs.stat(codexBin).then((stat) => stat.isFile()).catch(() => false);

    if (directCodexAvailable) {
      expect(config.agentCommand).toBe(process.execPath);
      expect(config.agentArgsTemplate[0]).toBe(codexBin);
      expect(config.agentArgsTemplate.slice(1, 4)).toEqual(['exec', '--cd', '{projectRoot}']);
      expect(config.agentHealthArgsTemplate[0]).toBe(codexBin);
      expect(config.agentHealthArgsTemplate[1]).toBe('--version');
    } else {
      expect(config.agentCommand).toBe('codex');
      expect(config.agentArgsTemplate[0]).toBe('exec');
    }
  });

  it('serves job events with numeric after filtering and no path parameters', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-server-events-'));
    const base = await start(root);
    const created = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({ skillId: 'fetch-mismatch-logs', params: { mapId: '10204416', days: 7 } }),
    }).then((res) => res.json()) as { job: AgentJobSummary };
    const id = created.job.id;

    let eventsPayload = { events: [] as Array<{ id: number; type: string }>, latestEventId: 0, truncatedBefore: undefined as number | undefined };
    for (let i = 0; i < 50 && !eventsPayload.events.some((event) => event.type === 'succeeded' || event.type === 'failed'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      eventsPayload = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}/events`, { headers: ownerHeaders() }).then((res) => res.json()) as typeof eventsPayload;
    }

    expect(eventsPayload.latestEventId).toBeGreaterThan(0);
    expect(eventsPayload.events.map((event) => event.type)).toEqual(expect.arrayContaining(['queued', 'agent-started', 'progress', 'succeeded']));
    const filtered = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}/events?after=1`, { headers: ownerHeaders() }).then((res) => res.json()) as typeof eventsPayload;
    expect(filtered.events.every((event) => event.id > 1)).toBe(true);
    const invalid = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}/events?after=..%2Fsecret`, { headers: ownerHeaders() }).then((res) => res.json()) as typeof eventsPayload;
    expect(invalid.events[0]?.id).toBe(eventsPayload.events[0]?.id);
    await expect(fetch(`${base}/api/jobs/${encodeURIComponent(id)}/events?path=..%2Fsecret`, { headers: ownerHeaders() }).then((res) => res.status)).resolves.toBe(200);
    await expect(fetch(`${base}/api/jobs/..%2Fbad/events`, { headers: ownerHeaders() }).then((res) => res.status)).resolves.toBe(404);
  });


  it('scopes job lists and job detail reads by owner token', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-server-owner-'));
    const base = await start(root);
    const created = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: ownerHeaders(OWNER_A),
      body: JSON.stringify({ skillId: 'fetch-mismatch-logs', params: { mapId: '10204416', days: 7 } }),
    }).then((res) => res.json()) as { job: AgentJobSummary };

    const ownerAJobs = await fetch(`${base}/api/jobs`, { headers: ownerHeaders(OWNER_A) }).then((res) => res.json()) as { jobs: AgentJobSummary[] };
    const ownerBJobs = await fetch(`${base}/api/jobs`, { headers: ownerHeaders(OWNER_B) }).then((res) => res.json()) as { jobs: AgentJobSummary[] };

    expect(ownerAJobs.jobs.map((job) => job.id)).toContain(created.job.id);
    expect(ownerBJobs.jobs).toEqual([]);
    await expect(fetch(`${base}/api/jobs/${created.job.id}`, { headers: ownerHeaders(OWNER_B) }).then((res) => res.status)).resolves.toBe(404);
  });

  it('rejects new submissions in maintenance mode before creating jobs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-server-maint-'));
    const server = createAgentRunnerServer(createDefaultConfig({
      AGENT_RUNNER_HOST: '127.0.0.1',
      AGENT_RUNNER_PORT: '0',
      AGENT_RUNNER_JOBS_ROOT: path.join(root, 'jobs'),
      AGENT_RUNNER_PROJECT_ROOT: process.cwd(),
      AGENT_RUNNER_MOCK: '1',
      AGENT_RUNNER_DISABLE_SUBMISSIONS: '1',
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;

    const rejected = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({ skillId: 'fetch-mismatch-logs', params: { mapId: '10204416', days: 7 } }),
    });

    expect(rejected.status).toBe(429);
    await expect(fs.readdir(path.join(root, 'jobs')).catch(() => [])).resolves.toEqual([]);
  });

});

describe('trusted public ingress source identity', () => {
  it('derives trusted proxy source only when trust proxy is enabled and strips spoof fallback otherwise', async () => {
    const req = { headers: { 'x-omx-client-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as http.IncomingMessage;
    expect((await import('./server')).getSourceKey(req, { trustProxy: true })).toBe('trusted:203.0.113.9');
    expect((await import('./server')).getSourceKey(req, { trustProxy: false })).toBe('socket:127.0.0.1');
    const malformed = { headers: { 'x-omx-client-ip': '999.999.999.999' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as http.IncomingMessage;
    expect((await import('./server')).getSourceKey(malformed, { trustProxy: true })).toBe('socket:127.0.0.1');
  });
});
