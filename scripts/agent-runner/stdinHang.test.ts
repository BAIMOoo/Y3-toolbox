import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createAgentRunnerServer, createDefaultConfig } from './server';
import type { AgentJobSummary } from '../../src/agentJobs/types';

const servers: http.Server[] = [];
const OWNER_TOKEN = 'owner-token-stdin-0001';

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startWithStdinReadingAgent(root: string) {
  const agentPath = path.join(root, 'stdin-reading-agent.cjs');
  await fs.writeFile(agentPath, [
    "const fs=require('fs');",
    "const path=require('path');",
    "const out=process.argv[2];",
    "const skill=process.argv[3];",
    "function zipBuffer(entryName, body){const n=Buffer.from(entryName); const b=Buffer.from(body); const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(0,8); local.writeUInt32LE(b.length,18); local.writeUInt32LE(b.length,22); local.writeUInt16LE(n.length,26); const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0,10); central.writeUInt32LE(b.length,20); central.writeUInt32LE(b.length,24); central.writeUInt16LE(n.length,28); const off=local.length+n.length+b.length; const eocd=Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(1,8); eocd.writeUInt16LE(1,10); eocd.writeUInt32LE(central.length+n.length,12); eocd.writeUInt32LE(off,16); return Buffer.concat([local,n,b,central,n,eocd]);}",
    "fs.readFileSync(0, 'utf8');",
    "fs.mkdirSync(out,{recursive:true});",
    "const summary=path.join(out,'fetch_summary.csv');",
    "const zip=path.join(out,'archive-change.zip');",
    "fs.writeFileSync(summary,'player,matched_log_count\\nsmoke,1\\n');",
    "fs.writeFileSync(zip, zipBuffer('fetch_summary.csv','mock zip'));",
    "fs.writeFileSync(path.join(out,'result-manifest.json'), JSON.stringify({status:'succeeded', summary:'stdin eof observed '+skill, artifacts:[{path:summary,name:'fetch_summary.csv'},{path:zip,name:'archive-change.zip'}], verification:['stdin reached EOF'], warnings:[]}, null, 2));",
    "console.log('stdout preserved');",
    "console.error('stderr preserved');",
  ].join(''), 'utf8');

  const config = createDefaultConfig({
    AGENT_RUNNER_HOST: '127.0.0.1',
    AGENT_RUNNER_PORT: '0',
    AGENT_RUNNER_JOBS_ROOT: path.join(root, 'jobs'),
    AGENT_RUNNER_PROJECT_ROOT: process.cwd(),
    AGENT_COMMAND: process.execPath,
    AGENT_ARGS_TEMPLATE: 'placeholder',
    AGENT_HEALTH_ARGS_TEMPLATE: '--version',
    AGENT_RUNNER_TIMEOUT_MS: '5000',
  });
  config.agentArgsTemplate = [agentPath, '{outputDir}', '{skillId}'];
  const server = createAgentRunnerServer(config);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return `http://127.0.0.1:${address.port}`;
}

describe('agent runner stdin handling', () => {
  it('does not leave non-interactive agent commands waiting for stdin EOF', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-stdin-'));
    const base = await startWithStdinReadingAgent(root);
    const created = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Token': OWNER_TOKEN },
      body: JSON.stringify({
        skillId: 'fetch-archive-changes',
        params: { players: 'smoke', mapId: '204521', from: '2026.06.03-00:00:00', to: '2026.06.04-00:00:00' },
      }),
    }).then((res) => res.json()) as { job: AgentJobSummary };

    let job = created.job;
    for (let i = 0; i < 100 && job.status !== 'succeeded' && job.status !== 'failed'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      job = await fetch(`${base}/api/jobs/${job.id}`, { headers: { 'X-Owner-Token': OWNER_TOKEN } }).then((res) => res.json()).then((payload) => (payload as { job: AgentJobSummary }).job);
    }

    expect(job.status).toBe('succeeded');
    expect(job.summary).toContain('stdin eof observed fetch-archive-changes');
    expect(job.artifacts.map((artifact) => artifact.name)).toEqual(['archive-change.zip']);

    const eventsPayload = await fetch(`${base}/api/jobs/${job.id}/events`, { headers: { 'X-Owner-Token': OWNER_TOKEN } }).then((res) => res.json()) as { events: Array<{ type: string; stream?: string; message: string }> };
    expect(eventsPayload.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agent-output', stream: 'stdout', message: 'Raw agent output hidden from public event API' }),
      expect.objectContaining({ type: 'agent-output', stream: 'stderr', message: 'Raw agent output hidden from public event API' }),
    ]));
    expect(eventsPayload.events.some((event) => event.message.includes('stdout preserved'))).toBe(false);
    expect(eventsPayload.events.some((event) => event.message.includes('stderr preserved'))).toBe(false);
  });
});
