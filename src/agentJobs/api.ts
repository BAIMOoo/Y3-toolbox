import type { AgentHealthResponse, AgentJobEventsResponse, AgentJobSummary, AgentSkillDefinition, AgentSubmitRequest } from './types';
import { Y3_TOOLBOX_CLIENT_VERSION } from './agentCompatibility';

const DEFAULT_SERVICE_URL = '/api';
const ELECTRON_DEFAULT_SERVICE_URL = 'http://127.0.0.1:8790';
const BUILD_AGENT_SERVICE_URL = typeof __AGENT_RUNNER_URL__ === 'string' ? __AGENT_RUNNER_URL__ : '';
const OWNER_TOKEN_STORAGE_KEY = 'agentJobs.ownerToken';
let memoryOwnerToken = '';

export function getAgentServiceBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const electronValue = window.electronAPI?.getAgentServiceBaseUrl?.();
    if (electronValue?.trim()) return electronValue.trim();
  }
  const value = import.meta.env.VITE_AGENT_RUNNER_URL as string | undefined;
  if (value?.trim()) return value.trim();
  if (BUILD_AGENT_SERVICE_URL.trim()) return BUILD_AGENT_SERVICE_URL.trim();
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') return ELECTRON_DEFAULT_SERVICE_URL;
  return DEFAULT_SERVICE_URL;
}


function joinAgentServiceUrl(baseUrl: string, apiPath: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/g, '');
  const normalizedPath = apiPath.startsWith('/api/') && normalizedBase.endsWith('/api')
    ? apiPath.slice('/api'.length)
    : apiPath;
  return `${normalizedBase}${normalizedPath}`;
}

function createOwnerToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return `owner_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function getAgentOwnerToken(): string {
  if (typeof window === 'undefined') return 'test-owner-token-00000000000000000000';
  const storage = window.localStorage;
  const existing = storage?.getItem(OWNER_TOKEN_STORAGE_KEY) || memoryOwnerToken;
  if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  const created = createOwnerToken();
  memoryOwnerToken = created;
  storage?.setItem(OWNER_TOKEN_STORAGE_KEY, created);
  return created;
}

function withOwnerToken(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}ownerToken=${encodeURIComponent(getAgentOwnerToken())}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (typeof window !== 'undefined' && window.electronAPI?.agentServiceRequest) {
    const result = await window.electronAPI.agentServiceRequest({
      path,
      method: init?.method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined,
    });
    if (!result.success) throw new Error(result.error);
    const payload = result.payload as { error?: unknown };
    if (result.status < 200 || result.status >= 300) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${result.status}`);
    }
    return result.payload as T;
  }

  const response = await fetch(`${joinAgentServiceUrl(getAgentServiceBaseUrl(), path)}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Owner-Token': getAgentOwnerToken(), ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export function fetchAgentSkills(): Promise<{ skills: AgentSkillDefinition[]; warning: string }> {
  return requestJson('/api/skills');
}

export function fetchAgentHealth(): Promise<AgentHealthResponse> {
  return requestJson('/api/health');
}


export function getAgentArtifactDownloadUrl(downloadPath: string): string {
  return joinAgentServiceUrl(getAgentServiceBaseUrl(), withOwnerToken(downloadPath));
}

export function fetchAgentJobs(): Promise<{ jobs: AgentJobSummary[] }> {
  return requestJson(withOwnerToken('/api/jobs'));
}

export function fetchAgentJob(id: string): Promise<{ job: AgentJobSummary }> {
  return requestJson(withOwnerToken(`/api/jobs/${encodeURIComponent(id)}`));
}

export function fetchAgentJobEvents(jobId: string, after?: number): Promise<AgentJobEventsResponse> {
  const query = after !== undefined && Number.isInteger(after) && after >= 0 ? `?after=${encodeURIComponent(String(after))}` : '';
  return requestJson(withOwnerToken(`/api/jobs/${encodeURIComponent(jobId)}/events${query}`));
}

export function submitAgentJob(request: AgentSubmitRequest): Promise<{ job: AgentJobSummary }> {
  return requestJson('/api/jobs', { method: 'POST', body: JSON.stringify({ ...request, clientVersion: Y3_TOOLBOX_CLIENT_VERSION, ownerToken: getAgentOwnerToken() }) });
}
