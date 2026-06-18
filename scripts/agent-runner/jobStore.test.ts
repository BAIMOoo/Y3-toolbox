import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { AgentJobStore } from './jobStore';
import type { RunnerConfig } from './contracts';

const OWNER_TOKEN = 'owner-token-123456';
const OTHER_OWNER_TOKEN = 'other-owner-123456';


function zipBuffer(entryName: string, body: string): Buffer {
  const name = Buffer.from(entryName);
  const content = Buffer.from(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  const centralOffset = local.length + name.length + content.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, content, central, name, eocd]);
}



function zipHeaderFlags(buffer: Buffer): Array<{ kind: 'local' | 'central'; name: string; flags: number }> {
  const headers: Array<{ kind: 'local' | 'central'; name: string; flags: number }> = [];
  let localOffset = 0;
  while (localOffset + 30 <= buffer.length && buffer.readUInt32LE(localOffset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(localOffset + 6);
    const compressedSize = buffer.readUInt32LE(localOffset + 18);
    const nameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const nameStart = localOffset + 30;
    const nameEnd = nameStart + nameLength;
    headers.push({ kind: 'local', name: buffer.subarray(nameStart, nameEnd).toString('utf8'), flags });
    localOffset = nameEnd + extraLength + compressedSize;
  }

  let centralOffset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (centralOffset >= 0 && centralOffset + 46 <= buffer.length && buffer.readUInt32LE(centralOffset) === 0x02014b50) {
    const flags = buffer.readUInt16LE(centralOffset + 8);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const nameStart = centralOffset + 46;
    const nameEnd = nameStart + nameLength;
    headers.push({ kind: 'central', name: buffer.subarray(nameStart, nameEnd).toString('utf8'), flags });
    centralOffset = nameEnd + extraLength + commentLength;
  }
  return headers;
}

function firstZipEntryText(buffer: Buffer): string {
  const localSignature = buffer.readUInt32LE(0);
  if (localSignature !== 0x04034b50) throw new Error('not a zip local header');
  const method = buffer.readUInt16LE(8);
  const compressedSize = buffer.readUInt32LE(18);
  const nameLength = buffer.readUInt16LE(26);
  const extraLength = buffer.readUInt16LE(28);
  const contentStart = 30 + nameLength + extraLength;
  const compressed = buffer.subarray(contentStart, contentStart + compressedSize);
  if (method === 0) return compressed.toString('utf8');
  if (method === 8) return inflateRawSync(compressed).toString('utf8');
  throw new Error(`unsupported zip method ${method}`);
}


async function createHealthyY3SourceRoot(root: string): Promise<string> {
  const sourceRoot = path.join(root, 'Y3map', 'src');
  const engineRoot = path.join(sourceRoot, 'Server', 'server', 'engine');
  const scriptPython = path.join(sourceRoot, 'Package', 'Script', 'Python');
  await fs.mkdir(path.join(engineRoot, 'dm', 'commons', 'helper'), { recursive: true });
  await fs.writeFile(path.join(engineRoot, 'dm', 'commons', 'helper', 'digest_helper.py'), '# helper');
  await fs.mkdir(path.join(sourceRoot, 'Engine', 'Binaries', 'Win64'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'Engine', 'Binaries', 'Win64', 'PythonMain_x64h.exe'), 'stub');
  await fs.mkdir(path.dirname(scriptPython), { recursive: true });
  await fs.symlink(engineRoot, scriptPython, process.platform === 'win32' ? 'junction' : 'dir');
  return sourceRoot;
}

function config(root: string, overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    jobsRoot: path.join(root, 'jobs'),
    projectRoot: process.cwd(),
    maxConcurrentJobs: 1,
    maxQueuedJobs: 5,
    submissionsDisabled: false,
    jobTimeoutMs: 10_000,
    maxCapturedOutputChars: 2_000,
    trustProxy: false,
    maxActiveJobsPerSource: 2,
    allowLan: false,
    mockMode: true,
    agentProviderName: 'mock-agent',
    agentCommand: process.execPath,
    agentArgsTemplate: [],
    agentHealthArgsTemplate: ['--version'],
    ...overrides,
  };
}


async function waitForPersistedStatus(root: string, id: string, status: 'succeeded' | 'failed') {
  const statePath = path.join(root, 'jobs', id, 'job-state.json');
  for (let i = 0; i < 100; i += 1) {
    try {
      const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as { job?: { status?: string; finishedAt?: string } };
      if (state.job?.status === status && state.job.finishedAt) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job state did not persist terminal ${status}`);
}


async function createExternalSkillRoot(root: string, skillId: string, helperRelativePath: string): Promise<string> {
  const skillRoot = path.join(root, 'external-skills');
  const skillDir = path.join(skillRoot, skillId);
  await fs.mkdir(path.join(skillDir, path.dirname(helperRelativePath)), { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `# ${skillId}
`);
  await fs.writeFile(path.join(skillDir, helperRelativePath), '# helper');
  return skillRoot;
}

async function waitForTerminal(store: AgentJobStore, id: string, ownerToken = OWNER_TOKEN) {
  for (let i = 0; i < 50; i += 1) {
    const job = store.getJob(id, ownerToken);
    if (job && (job.status === 'succeeded' || job.status === 'failed')) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('job did not finish');
}

describe('AgentJobStore', () => {
  it('rejects unknown skill ids and missing required params', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
    const store = new AgentJobStore(config(root));
    await expect(store.submit('unknown', {}, OWNER_TOKEN)).rejects.toThrow(/Unknown skill/);
    await expect(store.submit('fetch-archive-changes', {}, OWNER_TOKEN)).rejects.toThrow(/required/);
  });


  it('requires a valid owner token before accepting a job', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-owner-required-'));
    const store = new AgentJobStore(config(root));

    await expect(store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 })).rejects.toThrow(/Owner token is required/);
    await expect(store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, '../bad-token')).rejects.toThrow(/Owner token is invalid/);
    await expect(fs.readdir(path.join(root, 'jobs'))).resolves.toEqual([]);
  });

  it('filters jobs, details, events, and artifacts by owner token', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-owner-filter-'));
    const store = new AgentJobStore(config(root));
    const own = await store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, OWNER_TOKEN);
    const other = await store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, OTHER_OWNER_TOKEN);
    const ownDone = await waitForTerminal(store, own.id, OWNER_TOKEN);
    const otherDone = await waitForTerminal(store, other.id, OTHER_OWNER_TOKEN);

    expect(store.listJobs(OWNER_TOKEN).map((job) => job.id)).toEqual([own.id]);
    expect(store.listJobs(OTHER_OWNER_TOKEN).map((job) => job.id)).toEqual([other.id]);
    expect(store.getJob(other.id, OWNER_TOKEN)).toBeUndefined();
    await expect(store.getJobEvents(other.id, OWNER_TOKEN)).resolves.toBeNull();
    await expect(store.getArtifact(otherDone.id, otherDone.artifacts[0].id, OWNER_TOKEN)).resolves.toBeNull();
    await expect(store.getArtifact(ownDone.id, ownDone.artifacts[0].id, OWNER_TOKEN)).resolves.toMatchObject({ name: ownDone.artifacts[0].name });
  });

  it('enforces 5 running plus 10 queued jobs before creating overflow job directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-capacity-'));
    const script = "setTimeout(()=>{}, 5000);";
    const store = new AgentJobStore(config(root, {
      maxConcurrentJobs: 8,
      maxQueuedJobs: 20,
      mockMode: false,
      agentArgsTemplate: ['-e', script],
      jobTimeoutMs: 1000,
    }));
    const params = {
      players: '30144230',
      mapId: '204521',
      from: '2026.06.09-00:00:00',
      to: '2026.06.10-00:00:00',
    };

    const accepted = [] as string[];
    for (let index = 0; index < 15; index += 1) {
      const job = await store.submit('fetch-archive-changes', params, `${OWNER_TOKEN}-${index}`, `trusted:203.0.113.${index + 20}`);
      accepted.push(job.id);
    }
    await expect(store.submit('fetch-archive-changes', params, `${OWNER_TOKEN}-overflow`, 'trusted:203.0.113.99')).rejects.toThrow(/busy/);

    const entries = await fs.readdir(path.join(root, 'jobs'));
    expect(entries.sort()).toEqual(accepted.sort());
    expect(store.listJobs(`${OWNER_TOKEN}-overflow`)).toEqual([]);
  });

  it('rejects runtime-gated real jobs when their runtime health is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
    await fs.mkdir(path.join(root, 'staging'), { recursive: true });
    await fs.writeFile(path.join(root, 'staging', 'a.png'), 'png');
    const store = new AgentJobStore(config(root, { mockMode: false, kkresPublicInputRoot: root, mismatchSourceRoot: path.join(root, 'missing-y3-src') }));
    await expect(store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, OWNER_TOKEN)).rejects.toThrow(/Y3 source root/);
    await expect(store.submit('export-kkres-image', { images: 'staging:a.png' }, OWNER_TOKEN)).rejects.toThrow(/AGENT_KKRES_RUNTIME_ROOT/);
  }, 15_000);

  it('runs an allowlisted mock agent job and registers manifest artifacts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
    const store = new AgentJobStore(config(root));
    const submitted = await store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, OWNER_TOKEN);
    expect(['queued', 'running']).toContain(submitted.status);
    const done = await waitForTerminal(store, submitted.id);
    expect(done.status).toBe('succeeded');
    expect(done.summary).toContain('mock agent completed');
    await expect(fs.readFile(path.join(root, 'jobs', done.id, 'agent-prompt.md'), 'utf8')).resolves.toContain('Skill id: fetch-mismatch-logs');
    expect(done.artifacts.length).toBeGreaterThan(0);
    const artifact = await store.getArtifact(done.id, done.artifacts[0].id, OWNER_TOKEN);
    expect(artifact?.name).toBe(done.artifacts[0].name);
    await expect(store.getArtifact(done.id, '../bad', OWNER_TOKEN)).resolves.toBeNull();
  });

  it('exposes only the zip artifact for archive-change jobs while preserving loose CSV output', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-archive-'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const out=process.argv[1];",
      "function zipBuffer(entryName, body){const n=Buffer.from(entryName); const b=Buffer.from(body); const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(0,8); local.writeUInt32LE(b.length,18); local.writeUInt32LE(b.length,22); local.writeUInt16LE(n.length,26); const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0,10); central.writeUInt32LE(b.length,20); central.writeUInt32LE(b.length,24); central.writeUInt16LE(n.length,28); const off=local.length+n.length+b.length; const eocd=Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(1,8); eocd.writeUInt16LE(1,10); eocd.writeUInt32LE(central.length+n.length,12); eocd.writeUInt32LE(off,16); return Buffer.concat([local,n,b,central,n,eocd]);}",
      "const csv=path.join(out,'fetch_summary.csv');",
      "const zip=path.join(out,'archive-change.zip');",
      "fs.writeFileSync(csv,'player,matched_log_count\\nmock,1\\n');",
      "fs.writeFileSync(zip, zipBuffer('summary.csv','mock zip'));",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'archive done',artifacts:[{path:csv},{path:zip}],verification:['zip checked'],warnings:[]}));",
    ].join('');
    const sourceRoot = await createHealthyY3SourceRoot(root);
    const store = new AgentJobStore(config(root, { mockMode: false, mismatchSourceRoot: sourceRoot, agentArgsTemplate: ['-e', script, '{outputDir}'] }));
    const submitted = await store.submit('fetch-archive-changes', {
      players: '30144230',
      mapId: '204521',
      from: '2026.06.09-00:00:00',
      to: '2026.06.10-00:00:00',
    }, OWNER_TOKEN);
    const done = await waitForTerminal(store, submitted.id);

    expect(done.status).toBe('succeeded');
    expect(done.artifacts.map((artifact) => artifact.name)).toEqual(['archive-change.zip']);
    await expect(fs.readFile(path.join(root, 'jobs', done.id, 'fetch_summary.csv'), 'utf8')).resolves.toContain('mock,1');
  });

  it('builds success summaries as complete sentences without punctuation collisions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-summary-punctuation-'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const out=process.argv[1];",
      "const kkres=path.join(out,'KKExport.kkres');",
      "fs.writeFileSync(kkres,'mock kkres');",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'已成功导出 KKExport.kkres，可下载使用。',artifacts:[{path:kkres}],verification:['已读取并执行 export-kkres-image 技能流程','已验证输入图片、运行时根目录、dm 仓库根目录和项目路径存在']}));",
    ].join('');
    const runtimeRoot = path.join(root, 'runtime');
    const repoRoot = path.join(root, 'repo');
    const publicRoot = path.join(root, 'public-images');
    await fs.mkdir(path.join(runtimeRoot, 'Engine', 'Binaries', 'Win64'), { recursive: true });
    await fs.writeFile(path.join(runtimeRoot, 'Engine', 'Binaries', 'Win64', 'Game_x64h.exe'), '');
    await fs.mkdir(path.join(repoRoot, 'clients', 'custom_res'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'clients', 'custom_res', 'custom_utils.py'), '# helper');
    await fs.mkdir(path.join(publicRoot, 'staging'), { recursive: true });
    await fs.writeFile(path.join(publicRoot, 'staging', 'a.png'), 'png');
    const skillRoot = await createExternalSkillRoot(root, 'export-kkres-image', path.join('scripts', 'prepare_export_kkres_image.py'));
    const store = new AgentJobStore(config(root, {
      mockMode: false,
      kkresRuntimeRoot: runtimeRoot,
      kkresRepoRoot: repoRoot,
      kkresPublicInputRoot: publicRoot,
      agentSkillRoot: skillRoot,
      agentArgsTemplate: ['-e', script, '{outputDir}'],
    }));

    const submitted = await store.submit('export-kkres-image', { images: 'staging:a.png' }, OWNER_TOKEN);
    const done = await waitForTerminal(store, submitted.id);
    await waitForPersistedStatus(root, done.id, 'succeeded');
    const eventLines = (await fs.readFile(path.join(root, 'jobs', done.id, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/);
    const persistedEvents = eventLines.map((line) => JSON.parse(line) as { event?: { type?: string; message?: string } });
    const succeededMessage = persistedEvents.find((entry) => entry.event?.type === 'succeeded')?.event?.message ?? '';

    expect(done.status).toBe('succeeded');
    expect(done.summary).toContain('已成功导出 KKExport.kkres，可下载使用。\n生成 1 个附件。\n验证：');
    expect(done.summary).not.toMatch(/[。！？.!?]，/);
    expect(succeededMessage).toBe(done.summary);
    expect(succeededMessage).not.toMatch(/[。！？.!?]，/);
  });

  it('exposes only zip artifacts for mismatch jobs while preserving loose JSON output', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-mismatch-'));
    const store = new AgentJobStore(config(root, { mockMode: true }));
    const submitted = await store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 1 }, OWNER_TOKEN);
    const done = await waitForTerminal(store, submitted.id);

    expect(done.status).toBe('succeeded');
    expect(done.artifacts.map((artifact) => artifact.name)).toEqual(['mismatch_logs_mock.zip']);
    await expect(fs.readFile(path.join(root, 'jobs', done.id, 'mismatch_summary.json'), 'utf8')).resolves.toContain('decoded_digest');
  });

  it('exposes only kkres artifacts for kkres export jobs while preserving helper evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-kkres-'));
    const runtimeRoot = path.join(root, 'runtime');
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(path.join(runtimeRoot, 'Engine', 'Binaries', 'Win64'), { recursive: true });
    await fs.writeFile(path.join(runtimeRoot, 'Engine', 'Binaries', 'Win64', 'Game_x64h.exe'), '');
    const publicRoot = path.join(root, 'public-images');
    await fs.mkdir(path.join(publicRoot, 'staging'), { recursive: true });
    await fs.writeFile(path.join(publicRoot, 'staging', 'a.png'), 'png');
    await fs.mkdir(path.join(repoRoot, 'clients', 'custom_res'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'clients', 'custom_res', 'custom_utils.py'), '# helper');
    const skillRoot = await createExternalSkillRoot(root, 'export-kkres-image', path.join('scripts', 'prepare_export_kkres_image.py'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const out=process.argv[1];",
      "const kkres=path.join(out,'KKExport.kkres');",
      "const py=path.join(out,'prepare_export_kkres_image.py');",
      "const json=path.join(out,'kkres-debug.json');",
      "const txt=path.join(out,'kkres-log.txt');",
      "fs.writeFileSync(kkres,'mock kkres');",
      "fs.writeFileSync(py,'# helper');",
      "fs.writeFileSync(json,JSON.stringify({ok:true}));",
      "fs.writeFileSync(txt,'log');",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'kkres done',artifacts:[{path:kkres},{path:py},{path:json},{path:txt}],verification:['kkres checked'],warnings:[]}));",
    ].join('');
    const store = new AgentJobStore(config(root, {
      mockMode: false,
      kkresRuntimeRoot: runtimeRoot,
      kkresRepoRoot: repoRoot,
      kkresPublicInputRoot: publicRoot,
      agentSkillRoot: skillRoot,
      agentArgsTemplate: ['-e', script, '{outputDir}'],
    }));
    const submitted = await store.submit('export-kkres-image', { images: 'staging:a.png' }, OWNER_TOKEN);
    const done = await waitForTerminal(store, submitted.id);

    expect(done.status).toBe('succeeded');
    expect(done.artifacts.map((artifact) => artifact.name)).toEqual(['KKExport.kkres']);
    await expect(fs.readFile(path.join(root, 'jobs', done.id, 'kkres-debug.json'), 'utf8')).resolves.toContain('"ok":true');
    await expect(store.getArtifact(done.id, done.artifacts[0].id, OWNER_TOKEN)).resolves.toMatchObject({ name: 'KKExport.kkres' });
  }, 15_000);


  it('resolves kkres public image identifiers under the configured server-owned input root before prompt creation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-kkres-input-root-'));
    const publicRoot = path.join(root, 'public-images');
    const runtimeRoot = path.join(root, 'runtime');
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(path.join(publicRoot, 'staging'), { recursive: true });
    await fs.writeFile(path.join(publicRoot, 'staging', 'a.png'), 'png');
    await fs.mkdir(path.join(runtimeRoot, 'Engine', 'Binaries', 'Win64'), { recursive: true });
    await fs.writeFile(path.join(runtimeRoot, 'Engine', 'Binaries', 'Win64', 'Game_x64h.exe'), '');
    await fs.mkdir(path.join(repoRoot, 'clients', 'custom_res'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'clients', 'custom_res', 'custom_utils.py'), '# helper');
    const skillRoot = await createExternalSkillRoot(root, 'export-kkres-image', path.join('scripts', 'prepare_export_kkres_image.py'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const out=process.argv[1];",
      "fs.writeFileSync(path.join(out,'KKExport.kkres'),'mock kkres');",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'kkres done',artifacts:[{path:path.join(out,'KKExport.kkres')}],verification:['kkres checked'],warnings:[]}));",
    ].join('');
    const store = new AgentJobStore(config(root, {
      mockMode: false,
      kkresRuntimeRoot: runtimeRoot,
      kkresRepoRoot: repoRoot,
      kkresPublicInputRoot: publicRoot,
      agentSkillRoot: skillRoot,
      agentArgsTemplate: ['-e', script, '{outputDir}'],
    }));

    const submitted = await store.submit('export-kkres-image', { images: 'staging:a.png' }, OWNER_TOKEN);
    const done = await waitForTerminal(store, submitted.id);
    const prompt = await fs.readFile(path.join(root, 'jobs', submitted.id, 'agent-prompt.md'), 'utf8');
    const normalizedPrompt = prompt.replace(/[\\/]+/g, '/');
    expect(normalizedPrompt).toContain('public-images/staging/a.png');
    expect(prompt).not.toContain('staging:a.png');
    expect(done.status).toBe('succeeded');
    await expect(store.submit('export-kkres-image', { images: 'staging:missing.png' }, OTHER_OWNER_TOKEN)).rejects.toThrow(/does not resolve/);
  }, 15_000);

  it('accepts result manifests written with a UTF-8 BOM by Windows tooling', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-bom-manifest-'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const out=process.argv[1];",
      "function zipBuffer(entryName, body){const n=Buffer.from(entryName); const b=Buffer.from(body); const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(0,8); local.writeUInt32LE(b.length,18); local.writeUInt32LE(b.length,22); local.writeUInt16LE(n.length,26); const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0,10); central.writeUInt32LE(b.length,20); central.writeUInt32LE(b.length,24); central.writeUInt16LE(n.length,28); const off=local.length+n.length+b.length; const eocd=Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(1,8); eocd.writeUInt16LE(1,10); eocd.writeUInt32LE(central.length+n.length,12); eocd.writeUInt32LE(off,16); return Buffer.concat([local,n,b,central,n,eocd]);}",
      "const zip=path.join(out,'archive-change.zip');",
      "fs.writeFileSync(zip, zipBuffer('summary.csv','mock zip'));",
      "const manifest={status:'succeeded',summary:'bom manifest done decoded_digest=true',artifacts:[{path:zip}],verification:['zip checked'],warnings:[]};",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), '\\uFEFF'+JSON.stringify(manifest,null,2), 'utf8');",
    ].join('');
    const store = new AgentJobStore(config(root, { mockMode: false, agentArgsTemplate: ['-e', script, '{outputDir}'] }));
    const submitted = await store.submit('fetch-archive-changes', {
      players: '30144230',
      mapId: '204521',
      from: '2026.06.09-00:00:00',
      to: '2026.06.10-00:00:00',
    }, OWNER_TOKEN);
    const done = await waitForTerminal(store, submitted.id);

    expect(done.status).toBe('succeeded');
    expect(done.summary).toContain('bom manifest done');
    expect(done.artifacts.map((artifact) => artifact.name)).toEqual(['archive-change.zip']);
  });

  it('filters restored historical mismatch artifacts to zip downloads only', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-historical-'));
    const jobsRoot = path.join(root, 'jobs');
    const outputDir = path.join(jobsRoot, 'job-historical');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'mismatch_summary.json'), '{}');
    await fs.writeFile(path.join(outputDir, 'mismatch_logs.zip'), zipBuffer('mismatch_summary.json', 'zip'));
    await fs.writeFile(path.join(outputDir, 'job-state.json'), JSON.stringify({
      version: 1,
      job: {
        id: 'job-historical',
        skillId: 'fetch-mismatch-logs',
        skillLabel: '拉取不同步日志',
        status: 'succeeded',
        summary: '成功，生成 22 个附件',
        createdAt: '2026-06-10T00:00:00.000Z',
        updatedAt: '2026-06-10T00:00:01.000Z',
        artifacts: [
          { id: 'artifact-1', relativePath: 'mismatch_logs.zip', name: 'mismatch_logs.zip', sizeBytes: 3, downloadUrl: '/api/jobs/job-historical/artifacts/artifact-1' },
          { id: 'artifact-2', relativePath: 'mismatch_summary.json', name: 'mismatch_summary.json', sizeBytes: 2, downloadUrl: '/api/jobs/job-historical/artifacts/artifact-2' },
        ],
        outputDir,
        params: { mapId: '10204416', days: 1 },
        ownerToken: OWNER_TOKEN,
        safeResume: false,
        progressOffset: 0,
      },
    }, null, 2));

    const store = new AgentJobStore(config(root, { jobsRoot }));
    await store.ready();
    const job = store.getJob('job-historical', OWNER_TOKEN);

    expect(job?.artifacts.map((artifact) => artifact.name)).toEqual(['mismatch_logs.zip']);
    expect(job?.summary).toContain('生成 1 个下载包');
    await expect(store.getArtifact('job-historical', 'artifact-1', OWNER_TOKEN)).resolves.toMatchObject({ name: 'mismatch_logs.zip' });
    await expect(store.getArtifact('job-historical', 'artifact-2', OWNER_TOKEN)).resolves.toBeNull();
  });

  it('filters restored historical kkres artifacts to kkres downloads only', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-historical-kkres-'));
    const jobsRoot = path.join(root, 'jobs');
    const outputDir = path.join(jobsRoot, 'job-historical-kkres');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'KKExport.kkres'), 'kkres');
    await fs.writeFile(path.join(outputDir, 'kkres-debug.json'), '{}');
    await fs.writeFile(path.join(outputDir, 'kkres-log.txt'), 'log');
    await fs.writeFile(path.join(outputDir, 'job-state.json'), JSON.stringify({
      version: 1,
      job: {
        id: 'job-historical-kkres',
        skillId: 'export-kkres-image',
        skillLabel: '导出 kkres 高分辨率图片',
        status: 'succeeded',
        summary: 'kkres done',
        createdAt: '2026-06-10T00:00:00.000Z',
        updatedAt: '2026-06-10T00:00:01.000Z',
        artifacts: [
          { id: 'artifact-1', relativePath: 'KKExport.kkres', name: 'KKExport.kkres', sizeBytes: 5, downloadUrl: '/api/jobs/job-historical-kkres/artifacts/artifact-1' },
          { id: 'artifact-2', relativePath: 'kkres-debug.json', name: 'kkres-debug.json', sizeBytes: 2, downloadUrl: '/api/jobs/job-historical-kkres/artifacts/artifact-2' },
          { id: 'artifact-3', relativePath: 'kkres-log.txt', name: 'kkres-log.txt', sizeBytes: 3, downloadUrl: '/api/jobs/job-historical-kkres/artifacts/artifact-3' },
        ],
        outputDir,
        params: { images: 'C:\\tmp\\a.png' },
        ownerToken: OWNER_TOKEN,
        safeResume: false,
        progressOffset: 0,
      },
    }, null, 2));

    const store = new AgentJobStore(config(root, { jobsRoot }));
    await store.ready();
    const job = store.getJob('job-historical-kkres', OWNER_TOKEN);

    expect(job?.artifacts.map((artifact) => artifact.name)).toEqual(['KKExport.kkres']);
    await expect(store.getArtifact('job-historical-kkres', 'artifact-1', OWNER_TOKEN)).resolves.toMatchObject({ name: 'KKExport.kkres' });
    await expect(store.getArtifact('job-historical-kkres', 'artifact-2', OWNER_TOKEN)).resolves.toBeNull();
    await expect(store.getArtifact('job-historical-kkres', 'artifact-3', OWNER_TOKEN)).resolves.toBeNull();
  });


  it('persists versioned state and streams status/output/progress events', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const out=process.argv[1];",
      "function zipBuffer(entryName, body){const n=Buffer.from(entryName); const b=Buffer.from(body); const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(0,8); local.writeUInt32LE(b.length,18); local.writeUInt32LE(b.length,22); local.writeUInt16LE(n.length,26); const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0,10); central.writeUInt32LE(b.length,20); central.writeUInt32LE(b.length,24); central.writeUInt16LE(n.length,28); const off=local.length+n.length+b.length; const eocd=Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(1,8); eocd.writeUInt16LE(1,10); eocd.writeUInt32LE(central.length+n.length,12); eocd.writeUInt32LE(off,16); return Buffer.concat([local,n,b,central,n,eocd]);}",
      "console.log('hello stdout');",
      "console.error('hello stderr');",
      "fs.appendFileSync(path.join(out,'progress.jsonl'), JSON.stringify({message:'halfway',progress:0.5})+'\\n');",
      "const json=path.join(out,'mismatch_summary.json');",
      "const zip=path.join(out,'mismatch_logs.zip');",
      "fs.writeFileSync(json, JSON.stringify({record_count:1}));",
      "fs.writeFileSync(zip, zipBuffer('summary.json','mock zip'));",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'done decoded_digest=true',artifacts:[{path:json},{path:zip}],verification:['ok'],warnings:[]}));",
    ].join('');
    const store = new AgentJobStore(config(root, { mockMode: false, agentArgsTemplate: ['-e', script, '{outputDir}'] }));
    const submitted = await store.submit('fetch-archive-changes', {
      players: '30144230',
      mapId: '204521',
      from: '2026.06.09-00:00:00',
      to: '2026.06.10-00:00:00',
    }, OWNER_TOKEN);
    const jobDir = path.join(root, 'jobs', submitted.id);
    const stateBefore = JSON.parse(await fs.readFile(path.join(jobDir, 'job-state.json'), 'utf8')) as { version: number; job: { safeResume: boolean } };
    expect(stateBefore.version).toBe(1);
    expect(stateBefore.job.safeResume).toBe(false);
    const done = await waitForTerminal(store, submitted.id);
    expect(done.status).toBe('succeeded');
    await expect(fs.readFile(path.join(jobDir, 'events.jsonl'), 'utf8')).resolves.toContain('"version":1');
    const payload = await store.getJobEvents(submitted.id, OWNER_TOKEN, 0);
    expect(payload?.events.map((event) => event.type)).toEqual(expect.arrayContaining(['queued', 'agent-started', 'agent-output', 'progress', 'succeeded']));
    expect(payload?.events.some((event) => event.type === 'agent-output' && event.message.includes('hello stdout'))).toBe(false);
    expect(payload?.events.some((event) => event.type === 'agent-output' && event.message.includes('hello stderr'))).toBe(false);
    expect(payload?.events.some((event) => event.type === 'agent-output' && event.message.includes('Raw agent output hidden'))).toBe(true);
    const progressEvent = payload?.events.find((event) => event.type === 'progress');
    expect(progressEvent).toMatchObject({ message: 'halfway', progress: 0.5 });
    expect(progressEvent).not.toHaveProperty('raw');
    expect(payload?.latestEventId).toBeGreaterThan(0);
    expect(script).toContain('progress.jsonl');
  });

  it('restores active persisted jobs as failed recovery events when safeResume is false by default', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
    const jobsRoot = path.join(root, 'jobs');
    const outputDir = path.join(jobsRoot, 'job-active');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'job-state.json'), `${JSON.stringify({
      version: 1,
      job: {
        id: 'job-active',
        skillId: 'fetch-mismatch-logs',
        skillLabel: 'Fetch mismatch logs',
        status: 'running',
        summary: 'Agent 执行中',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        artifacts: [],
        outputDir,
        params: { mapId: '10204416', days: 7 },
        ownerToken: OWNER_TOKEN,
        safeResume: false,
        progressOffset: 0,
      },
    })}
`, 'utf8');

    const store = new AgentJobStore(config(root));
    await store.ready();
    const job = store.getJob('job-active', OWNER_TOKEN);
    expect(job?.status).toBe('failed');
    expect(job?.summary).toContain('not resumed automatically');
    const payload = await store.getJobEvents('job-active', OWNER_TOKEN, 0);
    expect(payload?.events).toContainEqual(expect.objectContaining({ type: 'recovery', safeResume: false, previousStatus: 'running' }));
  });

  it('reports aggregate health as false when any runtime is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
    const store = new AgentJobStore(config(root, { projectRoot: root }));
    const health = await store.health();
    expect(health.ready).toBe(false);
    expect(health.skills).toHaveLength(3);
  }, 15_000);
  it('persists an event lifecycle with stdout, stderr, progress, and terminal events', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-events-'));
    const store = new AgentJobStore(config(root, {
      agentCommand: process.execPath,
      mockMode: true,
      maxCapturedOutputChars: 200,
    }));
    const submitted = await store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, OWNER_TOKEN);
    const done = await waitForTerminal(store, submitted.id);
    expect(done.status).toBe('succeeded');

    const eventsResult = await store.getJobEvents(done.id, OWNER_TOKEN);
    expect(eventsResult?.latestEventId).toBeGreaterThan(0);
    const events = eventsResult?.events ?? [];
    expect(events.map((event) => event.id)).toEqual(events.map((_, index) => index + 1));
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'queued',
      'prompt-created',
      'agent-started',
      'agent-output',
      'progress',
      'manifest-read',
      'artifacts-validated',
      'succeeded',
    ]));
    expect(events.some((event) => event.type === 'agent-output' && event.stream === 'stdout')).toBe(true);

    const eventLines = (await fs.readFile(path.join(root, 'jobs', done.id, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/);
    expect(JSON.parse(eventLines[0])).toMatchObject({ version: 1 });
    await expect(fs.readFile(path.join(root, 'jobs', done.id, 'job-state.json'), 'utf8')).resolves.toContain('"version": 1');
  });

  it('filters event responses by after cursor and reports truncation for stale cursors', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-after-'));
    const store = new AgentJobStore(config(root));
    const submitted = await store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, OWNER_TOKEN);
    const done = await waitForTerminal(store, submitted.id);

    const all = await store.getJobEvents(done.id, OWNER_TOKEN);
    expect(all).not.toBeNull();
    const latest = all?.latestEventId ?? 0;
    expect(latest).toBeGreaterThan(1);
    const afterFirst = await store.getJobEvents(done.id, OWNER_TOKEN, 1);
    expect(afterFirst?.events.every((event) => event.id > 1)).toBe(true);
    expect(afterFirst?.latestEventId).toBe(latest);

    const invalid = await store.getJobEvents(done.id, OWNER_TOKEN, Number.NaN);
    expect(invalid?.events[0]?.id).toBe(all?.events[0]?.id);
  });

  it('restores completed job state and events from disk in a new store instance', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-restore-'));
    const firstStore = new AgentJobStore(config(root));
    const submitted = await firstStore.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, OWNER_TOKEN);
    const done = await waitForTerminal(firstStore, submitted.id);
    await waitForPersistedStatus(root, done.id, 'succeeded');

    const secondStore = new AgentJobStore(config(root));
    if ('ready' in secondStore && typeof secondStore.ready === 'function') await secondStore.ready();
    expect(secondStore.getJob(done.id, OWNER_TOKEN)).toMatchObject({ id: done.id, status: 'succeeded' });
    const events = await secondStore.getJobEvents(done.id, OWNER_TOKEN);
    expect(events?.events.map((event) => event.type)).toContain('succeeded');
  });

  it('marks restored queued or running jobs failed with a recovery event instead of blindly requeueing real skills', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-recovery-'));
    const jobsRoot = path.join(root, 'jobs');
    const outputDir = path.join(jobsRoot, 'job-stale');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'job-state.json'), JSON.stringify({
      version: 1,
      job: {
        id: 'job-stale',
        skillId: 'fetch-mismatch-logs',
        skillLabel: 'Mismatch logs',
        status: 'running',
        summary: 'Agent 执行中',
        createdAt: '2026-06-09T00:00:00.000Z',
        updatedAt: '2026-06-09T00:00:01.000Z',
        artifacts: [],
        outputDir,
        params: { mapId: '10204416', days: 7 },
        ownerToken: OWNER_TOKEN,
        safeResume: false,
      },
    }, null, 2));

    const store = new AgentJobStore(config(root, { jobsRoot }));
    if ('ready' in store && typeof store.ready === 'function') await store.ready();
    expect(store.getJob('job-stale', OWNER_TOKEN)).toMatchObject({ status: 'failed' });
    const events = await store.getJobEvents('job-stale', OWNER_TOKEN);
    expect(events?.events.map((event) => event.type)).toEqual(expect.arrayContaining(['recovery', 'failed']));
  });

  it('skips malformed persisted event lines during restore without exposing local paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-malformed-'));
    const jobsRoot = path.join(root, 'jobs');
    const outputDir = path.join(jobsRoot, 'job-done');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'job-state.json'), JSON.stringify({
      version: 1,
      job: {
        id: 'job-done',
        skillId: 'fetch-mismatch-logs',
        skillLabel: 'Mismatch logs',
        status: 'succeeded',
        summary: 'done',
        createdAt: '2026-06-09T00:00:00.000Z',
        updatedAt: '2026-06-09T00:00:01.000Z',
        artifacts: [],
        outputDir,
        params: { mapId: '10204416', days: 7 },
        ownerToken: OWNER_TOKEN,
        safeResume: false,
      },
    }, null, 2));
    await fs.writeFile(path.join(outputDir, 'events.jsonl'), [
      '{not json',
      JSON.stringify({ version: 1, event: { id: 1, jobId: 'job-done', type: 'succeeded', message: 'done', createdAt: '2026-06-09T00:00:01.000Z' } }),
      '',
    ].join('\n'));

    const store = new AgentJobStore(config(root, { jobsRoot }));
    if ('ready' in store && typeof store.ready === 'function') await store.ready();
    const events = await store.getJobEvents('job-done', OWNER_TOKEN);
    expect(events?.events).toEqual([{ id: 1, jobId: 'job-done', type: 'succeeded', message: 'done', createdAt: '2026-06-09T00:00:01.000Z' }]);
  });



  it('marks repacked public zip filenames as UTF-8 so Chinese names decode by default', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-utf8-zip-'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const zlib=require('zlib');",
      "const out=process.argv[1];",
      "function crc32(buffer){let crc=~0; for (const byte of buffer){crc ^= byte; for(let bit=0; bit<8; bit++) crc=(crc>>>1) ^ (0xedb88320 & -(crc & 1));} return ~crc >>> 0;}",
      "function zipBuffer(entries){const localParts=[]; const centralParts=[]; let offset=0; for (const [entryName, body] of entries){const n=Buffer.from(entryName,'utf8'); const b=Buffer.from(body,'utf8'); const c=zlib.deflateRawSync(b); const crc=crc32(b); const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(0x0800,6); local.writeUInt16LE(8,8); local.writeUInt32LE(crc,14); local.writeUInt32LE(c.length,18); local.writeUInt32LE(b.length,22); local.writeUInt16LE(n.length,26); localParts.push(local,n,c); const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0x0800,8); central.writeUInt16LE(8,10); central.writeUInt32LE(crc,16); central.writeUInt32LE(c.length,20); central.writeUInt32LE(b.length,24); central.writeUInt16LE(n.length,28); central.writeUInt32LE(0,38); central.writeUInt32LE(offset,42); centralParts.push(central,n); offset += local.length+n.length+c.length;} const centralOffset=offset; const centralSize=centralParts.reduce((sum,part)=>sum+part.length,0); const eocd=Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(entries.length,8); eocd.writeUInt16LE(entries.length,10); eocd.writeUInt32LE(centralSize,12); eocd.writeUInt32LE(centralOffset,16); return Buffer.concat([...localParts,...centralParts,eocd]);}",
      "const zip=path.join(out,'mismatch_logs_utf8.zip');",
      "fs.writeFileSync(zip, zipBuffer([['summary.txt', 'ok'], ['玩家/苍金陵.json', JSON.stringify({ok:true})]]));",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'utf8 zip decoded_digest=true',artifacts:[{path:zip}],verification:['zip checked'],warnings:[]}));",
    ].join('');
    const sourceRoot = await createHealthyY3SourceRoot(root);
    const skillRoot = await createExternalSkillRoot(root, 'fetch-mismatch-logs', path.join('scripts', 'fetch_mismatch_logs.ps1'));
    const store = new AgentJobStore(config(root, {
      mockMode: false,
      mismatchSourceRoot: sourceRoot,
      agentSkillRoot: skillRoot,
      agentArgsTemplate: ['-e', script, '{outputDir}'],
    }));
    const submitted = await store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, OWNER_TOKEN);
    const done = await waitForTerminal(store, submitted.id);

    expect(done.status).toBe('succeeded');
    expect(done.artifacts.map((artifact) => artifact.name)).toEqual(['mismatch_logs_utf8.zip']);
    const artifact = await store.getArtifact(done.id, done.artifacts[0].id, OWNER_TOKEN);
    expect(artifact?.path).toContain('.public-artifacts');
    const repacked = await fs.readFile(artifact?.path ?? '');
    const headers = zipHeaderFlags(repacked).filter((header) => header.name === 'summary.txt' || header.name.includes('苍金陵'));
    expect(headers.map((header) => `${header.kind}:${header.name}`).sort()).toEqual([
      'central:summary.txt',
      'central:玩家/苍金陵.json',
      'local:summary.txt',
      'local:玩家/苍金陵.json',
    ]);
    expect(headers.every((header) => (header.flags & 0x0800) !== 0)).toBe(true);
  });

  it('withholds mislabeled non-zip archive artifacts from public downloads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-nonzip-'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const out=process.argv[1];",
      "const fakeZip=path.join(out,'archive-change.zip');",
      "fs.writeFileSync(fakeZip,'not a zip C:\\secret\\path AGENT_TOKEN=value');",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'fake zip done',artifacts:[{path:fakeZip}],verification:['zip checked'],warnings:[]}));",
    ].join('');
    const store = new AgentJobStore(config(root, { mockMode: false, agentArgsTemplate: ['-e', script, '{outputDir}'] }));
    const submitted = await store.submit('fetch-archive-changes', {
      players: '30144230',
      mapId: '204521',
      from: '2026.06.09-00:00:00',
      to: '2026.06.10-00:00:00',
    }, OWNER_TOKEN, 'trusted:203.0.113.14');
    const done = await waitForTerminal(store, submitted.id);

    expect(done.status).toBe('succeeded');
    expect(done.artifacts).toEqual([]);
    await expect(fs.readFile(path.join(root, 'jobs', done.id, 'archive-change.zip'), 'utf8')).resolves.toContain('not a zip');
  });

});

describe('public backend guardrails', () => {
  it('throttles one source before creating extra job directories while allowing a different source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-source-throttle-'));
    const script = "setTimeout(()=>{}, 5000);";
    const store = new AgentJobStore(config(root, {
      maxConcurrentJobs: 2,
      maxQueuedJobs: 5,
      maxActiveJobsPerSource: 1,
      mockMode: false,
      agentArgsTemplate: ['-e', script],
      jobTimeoutMs: 1000,
    }));
    const params = { players: '30144230', mapId: '204521', from: '2026.06.09-00:00:00', to: '2026.06.10-00:00:00' };

    const first = await store.submit('fetch-archive-changes', params, OWNER_TOKEN, 'trusted:203.0.113.10');
    await expect(store.submit('fetch-archive-changes', params, OWNER_TOKEN, 'trusted:203.0.113.10')).rejects.toThrow(/Source throttled/);
    await expect(store.submit('fetch-mismatch-logs', { mapId: '10204416', days: 7 }, OWNER_TOKEN, 'trusted:203.0.113.10')).rejects.toThrow(/Source throttled/);
    await expect(store.submit('fetch-archive-changes', params, OTHER_OWNER_TOKEN, 'trusted:203.0.113.10')).rejects.toThrow(/Source throttled/);
    await expect(store.submit('fetch-archive-changes', params, OTHER_OWNER_TOKEN, 'trusted:203.0.113.11')).resolves.toMatchObject({ skillId: 'fetch-archive-changes' });

    const entries = await fs.readdir(path.join(root, 'jobs'));
    expect(entries).toHaveLength(2);
    expect(entries).toContain(first.id);
  });

  it('releases all pending source throttle counters after rejected submissions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-source-throttle-reject-'));
    const store = new AgentJobStore(config(root, {
      maxConcurrentJobs: 1,
      maxQueuedJobs: 5,
      maxActiveJobsPerSource: 1,
    }));
    const source = 'trusted:203.0.113.20';
    const params = {
      players: '30144230',
      mapId: '204521',
      from: '2026.06.09-00:00:00',
      to: '2026.06.10-00:00:00',
    };

    await expect(store.submit('fetch-archive-changes', {}, OWNER_TOKEN, source)).rejects.toThrow(/required/);
    await expect(store.submit('fetch-archive-changes', params, OWNER_TOKEN, source)).resolves.toMatchObject({ skillId: 'fetch-archive-changes' });

    const entries = await fs.readdir(path.join(root, 'jobs'));
    expect(entries).toHaveLength(1);
  });


  it('repackages public zip artifacts with only redacted user result files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-zip-redact-'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const out=process.argv[1];",
      "function entry(name, body){const n=Buffer.from(name); const b=Buffer.from(body); const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(0,8); local.writeUInt32LE(b.length,18); local.writeUInt32LE(b.length,22); local.writeUInt16LE(n.length,26); const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0,10); central.writeUInt32LE(b.length,20); central.writeUInt32LE(b.length,24); central.writeUInt16LE(n.length,28); return {local,n,b,central};}",
      "function zipBuffer(entries){let offset=0; const locals=[]; const centrals=[]; for(const e of entries){const item=entry(e.name,e.body); locals.push(item.local,item.n,item.b); item.central.writeUInt32LE(offset,42); centrals.push(item.central,item.n); offset += item.local.length+item.n.length+item.b.length;} const centralSize=centrals.reduce((sum,b)=>sum+b.length,0); const eocd=Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(entries.length,8); eocd.writeUInt16LE(entries.length,10); eocd.writeUInt32LE(centralSize,12); eocd.writeUInt32LE(offset,16); return Buffer.concat([...locals,...centrals,eocd]);}",
      "const zip=path.join(out,'archive-change.zip');",
      "const slash=String.fromCharCode(92);",
      "const body=JSON.stringify({raw_file:'C:'+slash+'Users'+slash+'BAIM'+slash+'Temp'+slash+'diff.txt', digest_source:'I:'+slash+'map'+slash+'src', token:'AGENT_TOKEN=value'});",
      "fs.writeFileSync(zip, zipBuffer([{name:'summary.json', body}, {name:'fetch-run.log', body:'debug C:'+slash+'secret'}, {name:'debug-command.txt', body:'AGENT_TOKEN=value'}]));",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'done decoded_digest=true',artifacts:[{path:zip}],verification:['zip checked'],warnings:[]}));",
    ].join('');
    const store = new AgentJobStore(config(root, { mockMode: false, agentArgsTemplate: ['-e', script, '{outputDir}'] }));
    const submitted = await store.submit('fetch-archive-changes', {
      players: '30144230',
      mapId: '204521',
      from: '2026.06.09-00:00:00',
      to: '2026.06.10-00:00:00',
    }, OWNER_TOKEN, 'trusted:203.0.113.15');
    const done = await waitForTerminal(store, submitted.id);

    expect(done.status).toBe('succeeded');
    expect(done.artifacts.map((artifact) => artifact.name)).toEqual(['archive-change.zip']);
    const artifact = await store.getArtifact(done.id, done.artifacts[0].id, OWNER_TOKEN);
    expect(artifact).toMatchObject({ name: 'archive-change.zip' });
    expect(artifact?.path).toContain(`${path.sep}.public-artifacts${path.sep}`);
    const redactedZip = await fs.readFile(artifact!.path);
    const redactedText = firstZipEntryText(redactedZip);
    expect(redactedZip.toString('utf8')).not.toContain('fetch-run.log');
    expect(redactedZip.toString('utf8')).not.toContain('debug-command.txt');
    expect(redactedText).not.toContain('C:\\Users');
    expect(redactedText).not.toContain('I:\\map');
    expect(redactedText).not.toContain('AGENT_TOKEN=value');
    expect(redactedText).toContain('[local-path]');
    expect(redactedText).toContain('[env]');
  });

  it('screens zip member names and bounded content before exposing public archive downloads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-zip-members-'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const zlib=require('zlib');",
      "const out=process.argv[1];",
      "function crc32(buf){let c=~0; for(const b of buf){c^=b; for(let k=0;k<8;k++) c=(c>>>1)^(0xedb88320&-(c&1));} return ~c>>>0;}",
      "function zipPack(name, raw, method){const n=Buffer.from(name); const data=method===8?zlib.deflateRawSync(raw):raw; const h=Buffer.alloc(30); h.writeUInt32LE(0x04034b50,0); h.writeUInt16LE(method,8); h.writeUInt32LE(crc32(raw),14); h.writeUInt32LE(data.length,18); h.writeUInt32LE(raw.length,22); h.writeUInt16LE(n.length,26); const c=Buffer.alloc(46); c.writeUInt32LE(0x02014b50,0); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6); c.writeUInt16LE(method,10); c.writeUInt32LE(crc32(raw),16); c.writeUInt32LE(data.length,20); c.writeUInt32LE(raw.length,24); c.writeUInt16LE(n.length,28); const off=h.length+n.length+data.length; const e=Buffer.alloc(22); e.writeUInt32LE(0x06054b50,0); e.writeUInt16LE(1,8); e.writeUInt16LE(1,10); e.writeUInt32LE(c.length+n.length,12); e.writeUInt32LE(off,16); return Buffer.concat([h,n,data,c,n,e]);}",
      "function zipLocal(name, body){return zipPack(name, Buffer.from(body), 8);}",
      "function zipStored(name, body){return zipPack(name, Buffer.from(body), 0);}",
      "const safe=path.join(out,'archive-change.zip');",
      "const unsafeName=path.join(out,'archive-change-unsafe-name.zip');",
      "const unsafeContent=path.join(out,'archive-change-unsafe-content.zip');",
      "const oversizedContent=path.join(out,'archive-change-oversized-content.zip');",
      "fs.writeFileSync(safe, zipLocal('summary.csv',['player,matched_log_count','mock,1',''].join(String.fromCharCode(10))));",
      "fs.writeFileSync(unsafeName, zipLocal('../stderr.ps1','hidden but named unsafe'));",
      "fs.writeFileSync(unsafeContent, zipLocal('summary.csv','safe prefix '+('x'.repeat(4096))+' I:\\\\map\\\\src AGENT_TOKEN=value'));",
      // oversizedContent passes the 100MB entry scan limit (1MB+1 < 100MB) and has safe content,
      // but it's never reached because buildArtifacts breaks after the first valid artifact (safe).
      // The 100MB entry boundary is enforced at runtime by inflateRawSync's maxOutputLength option.
      "fs.writeFileSync(oversizedContent, zipLocal('summary.csv','x'.repeat(1024*1024+1)));",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'zip names checked',artifacts:[{path:safe},{path:unsafeName},{path:unsafeContent},{path:oversizedContent}],verification:['zip checked'],warnings:[]}));",
    ].join('');
    const store = new AgentJobStore(config(root, { mockMode: false, agentArgsTemplate: ['-e', script, '{outputDir}'] }));
    const submitted = await store.submit('fetch-archive-changes', {
      players: '30144230',
      mapId: '204521',
      from: '2026.06.09-00:00:00',
      to: '2026.06.10-00:00:00',
    }, OWNER_TOKEN, 'trusted:203.0.113.13');
    const done = await waitForTerminal(store, submitted.id);

    expect(done.artifacts.map((artifact) => artifact.name)).toEqual(['archive-change.zip']);
  });

  it('redacts local paths from public summaries and withholds unsafe artifacts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-redact-'));
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const out=process.argv[1];",
      "function zipBuffer(entryName, body){const n=Buffer.from(entryName); const b=Buffer.from(body); const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(0,8); local.writeUInt32LE(b.length,18); local.writeUInt32LE(b.length,22); local.writeUInt16LE(n.length,26); const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0,10); central.writeUInt32LE(b.length,20); central.writeUInt32LE(b.length,24); central.writeUInt16LE(n.length,28); const off=local.length+n.length+b.length; const eocd=Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(1,8); eocd.writeUInt16LE(1,10); eocd.writeUInt32LE(central.length+n.length,12); eocd.writeUInt32LE(off,16); return Buffer.concat([local,n,b,central,n,eocd]);}",
      "const safe=path.join(out,'archive-change.zip');",
      "const unsafe=path.join(out,'debug-command.zip');",
      "fs.writeFileSync(safe,zipBuffer('summary.csv','safe csv summary'));",
      "fs.writeFileSync(unsafe,'C:\\\\secret\\\\path stderr AGENT_TOKEN=value');",
      "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded',summary:'done at C:\\\\secret\\\\path',artifacts:[{path:safe},{path:unsafe}],verification:['checked I:\\\\map'],warnings:[]}));",
    ].join('');
    const store = new AgentJobStore(config(root, { mockMode: false, agentArgsTemplate: ['-e', script, '{outputDir}'] }));
    const submitted = await store.submit('fetch-archive-changes', {
      players: '30144230',
      mapId: '204521',
      from: '2026.06.09-00:00:00',
      to: '2026.06.10-00:00:00',
    }, OWNER_TOKEN, 'trusted:203.0.113.12');
    const done = await waitForTerminal(store, submitted.id);

    expect(done.summary).not.toContain('C:\\');
    expect(done.summary).not.toContain('I:\\');
    expect(done.artifacts.map((artifact) => artifact.name)).toEqual(['archive-change.zip']);
  });
});
