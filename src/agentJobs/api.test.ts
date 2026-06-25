import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAgentJob, fetchAgentJobEvents, fetchAgentJobs, fetchAgentSkills, getAgentArtifactDownloadUrl, getAgentOwnerToken, getAgentServiceBaseUrl, submitAgentJob } from './api';
import type { ElectronAPI } from '../types/electron';

type TestWindow = { electronAPI?: Partial<ElectronAPI>; localStorage?: Pick<Storage, 'getItem' | 'setItem'> };
type GlobalWithWindow = { window?: TestWindow };
const globalWithWindow = globalThis as unknown as GlobalWithWindow;
const originalWindow = globalWithWindow.window;

afterEach(() => {
  globalWithWindow.window = originalWindow;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('agent job API transport', () => {
  it('persists a browser-local owner token', () => {
    const storage = createMemoryStorage();
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(7);
      return bytes;
    } });
    globalWithWindow.window = { localStorage: storage };

    const first = getAgentOwnerToken();
    const second = getAgentOwnerToken();

    expect(first).toBe('owner_07070707070707070707070707070707');
    expect(second).toBe(first);
    expect(storage.setItem).toHaveBeenCalledWith('agentJobs.ownerToken', first);
  });

  it('uses Electron-provided task service base URL for download links', () => {
    globalWithWindow.window = { electronAPI: { getAgentServiceBaseUrl: () => 'http://127.0.0.1:18790' } };

    expect(getAgentServiceBaseUrl()).toBe('http://127.0.0.1:18790');
  });

  it('uses Electron main-process proxy when available to avoid packaged file:// CORS', async () => {
    const agentServiceRequest = vi.fn<ElectronAPI['agentServiceRequest']>().mockResolvedValue({
      success: true,
      status: 200,
      payload: { skills: [], warning: 'trusted' },
    });
    globalWithWindow.window = { electronAPI: { agentServiceRequest }, localStorage: createMemoryStorage('owner-token-0003') };

    await expect(fetchAgentSkills()).resolves.toEqual({ skills: [], warning: 'trusted' });
    expect(agentServiceRequest).toHaveBeenCalledWith({ path: '/api/skills', method: undefined, body: undefined });
  });

  it('sends POST bodies through Electron proxy as structured JSON', async () => {
    const agentServiceRequest = vi.fn<ElectronAPI['agentServiceRequest']>().mockResolvedValue({
      success: true,
      status: 201,
      payload: { job: { id: 'job-1', artifacts: [] } },
    });
    globalWithWindow.window = { electronAPI: { agentServiceRequest }, localStorage: createMemoryStorage('owner-token-0001') };

    await submitAgentJob({ skillId: 'fetch-mismatch-logs', params: { mapId: '10204416', days: 7 } });
    expect(agentServiceRequest).toHaveBeenCalledWith({
      path: '/api/jobs',
      method: 'POST',
      body: { skillId: 'fetch-mismatch-logs', params: { mapId: '10204416', days: 7 }, clientVersion: '0.1.6', ownerToken: 'owner-token-0001' },
    });
  });

  it('includes owner token when listing and loading jobs', async () => {
    const agentServiceRequest = vi.fn<ElectronAPI['agentServiceRequest']>().mockResolvedValue({
      success: true,
      status: 200,
      payload: { jobs: [], job: { id: 'job-1', artifacts: [] } },
    });
    globalWithWindow.window = { electronAPI: { agentServiceRequest }, localStorage: createMemoryStorage('owner-token-0002') };

    await fetchAgentJobs();
    await fetchAgentJob('../job-1');

    expect(agentServiceRequest).toHaveBeenNthCalledWith(1, {
      path: '/api/jobs?ownerToken=owner-token-0002',
      method: undefined,
      body: undefined,
    });
    expect(agentServiceRequest).toHaveBeenNthCalledWith(2, {
      path: '/api/jobs/..%2Fjob-1?ownerToken=owner-token-0002',
      method: undefined,
      body: undefined,
    });
  });

  it('builds owner-scoped artifact download URLs', () => {
    globalWithWindow.window = {
      electronAPI: { getAgentServiceBaseUrl: () => 'http://127.0.0.1:18790' },
      localStorage: createMemoryStorage('owner-token-0005'),
    };

    expect(getAgentArtifactDownloadUrl('/api/jobs/job-1/artifacts/artifact-1')).toBe(
      'http://127.0.0.1:18790/api/jobs/job-1/artifacts/artifact-1?ownerToken=owner-token-0005',
    );
  });

  it('fetches job events through the Electron proxy with numeric after filtering', async () => {
    const agentServiceRequest = vi.fn<ElectronAPI['agentServiceRequest']>().mockResolvedValue({
      success: true,
      status: 200,
      payload: { events: [], latestEventId: 7 },
    });
    globalWithWindow.window = { electronAPI: { agentServiceRequest }, localStorage: createMemoryStorage('owner-token-0003') };

    await expect(fetchAgentJobEvents('job-1', 3)).resolves.toEqual({ events: [], latestEventId: 7 });
    expect(agentServiceRequest).toHaveBeenCalledWith({
      path: '/api/jobs/job-1/events?after=3&ownerToken=owner-token-0003',
      method: undefined,
      body: undefined,
    });
  });

  it('encodes event job ids and omits non-integer after values', async () => {
    const agentServiceRequest = vi.fn<ElectronAPI['agentServiceRequest']>().mockResolvedValue({
      success: true,
      status: 200,
      payload: { events: [], latestEventId: 0 },
    });
    globalWithWindow.window = { electronAPI: { agentServiceRequest }, localStorage: createMemoryStorage('owner-token-0004') };

    await fetchAgentJobEvents('../job-1', 1.5);
    expect(agentServiceRequest).toHaveBeenCalledWith({
      path: '/api/jobs/..%2Fjob-1/events?ownerToken=owner-token-0004',
      method: undefined,
      body: undefined,
    });
  });
});

function createMemoryStorage(initialOwnerToken?: string): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  if (initialOwnerToken) values.set('agentJobs.ownerToken', initialOwnerToken);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}
