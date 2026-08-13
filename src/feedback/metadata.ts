import { Y3_TOOLBOX_CLIENT_VERSION } from '../agentJobs/agentCompatibility';
import type { FeedbackActiveModule, FeedbackClientMetadata } from './types';

export const FEEDBACK_METADATA_KEYS = ['appVersion', 'osFamily', 'activeModule'] as const;

export function createFeedbackMetadata(activeModule: FeedbackActiveModule): FeedbackClientMetadata {
  return {
    appVersion: Y3_TOOLBOX_CLIENT_VERSION,
    osFamily: detectOsFamily(),
    activeModule,
  };
}

function detectOsFamily(): string {
  const platform = typeof navigator !== 'undefined' ? navigator.platform.toLowerCase() : '';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const value = `${platform} ${userAgent}`;
  if (value.includes('win')) return 'windows';
  if (value.includes('mac')) return 'macos';
  if (value.includes('linux')) return 'linux';
  return 'unknown';
}
