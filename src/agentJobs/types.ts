export type AgentSkillId = 'fetch-archive-changes' | 'fetch-mismatch-logs' | 'export-kkres-image';

export type AgentJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type AgentJobEventType =
  | 'queued'
  | 'prompt-created'
  | 'agent-started'
  | 'agent-output'
  | 'progress'
  | 'manifest-read'
  | 'artifacts-validated'
  | 'recovery'
  | 'succeeded'
  | 'failed';

export type AgentFieldType = 'text' | 'textarea' | 'number' | 'datetime' | 'path';

export interface AgentSkillField {
  name: string;
  label: string;
  type: AgentFieldType;
  required: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: string | number;
}

export interface AgentSkillDefinition {
  id: AgentSkillId;
  label: string;
  description: string;
  fields: AgentSkillField[];
}

export interface AgentArtifact {
  id: string;
  name: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface AgentJobSummary {
  id: string;
  skillId: AgentSkillId;
  skillLabel: string;
  status: AgentJobStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  artifacts: AgentArtifact[];
}

export interface AgentJobEvent {
  id: number;
  jobId: string;
  type: AgentJobEventType;
  message: string;
  createdAt: string;
  stream?: 'stdout' | 'stderr';
}

export interface AgentJobEventsResponse {
  events: AgentJobEvent[];
  latestEventId: number;
  truncatedBefore?: number;
}

export interface AgentQueueStatus {
  running: number;
  queued: number;
  maxRunning: number;
  maxQueued: number;
  submissionsDisabled: boolean;
}

export interface AgentPublicSkillStatus {
  skillId: AgentSkillId;
  label: string;
}

export interface AgentReleaseInfo {
  schemaVersion: 1;
  releaseTrainId: string;
  clientVersion: string;
  backendVersion: string;
  backendCommit?: string;
  builtAt?: string;
  minimumClientVersion: string;
  supportedClientRange: string;
  latestClientUrl?: string;
  releaseNotesUrl?: string;
}

export interface AgentHealthResponse {
  ready: boolean;
  trustedOnly: true;
  warning: string;
  queue: AgentQueueStatus;
  skills: AgentPublicSkillStatus[];
  release: AgentReleaseInfo;
}

export interface AgentProviderStatus {
  name: string;
  ready: boolean;
  details: string[];
}

export interface AgentSkillDiagnosticStatus extends AgentPublicSkillStatus {
  ready: boolean;
  details: string[];
}

export interface AgentDiagnosticsResponse extends AgentHealthResponse {
  host: string;
  port: number;
  allowLan: boolean;
  agentProvider: AgentProviderStatus;
  skillDiagnostics: AgentSkillDiagnosticStatus[];
}

export interface AgentSubmitRequest {
  skillId: AgentSkillId;
  params: Record<string, string | number | boolean | string[]>;
  ownerToken?: string;
  clientVersion?: string;
}
