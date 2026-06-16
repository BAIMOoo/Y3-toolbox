export interface PreventableArtifactClickEvent {
  preventDefault: () => void;
}

export interface ArtifactDownloadBridge {
  downloadAgentArtifact?: (request: { url: string }) => Promise<{ success: true } | { success: false; error: string }>;
}

export async function handleAgentArtifactDownloadClick(
  event: PreventableArtifactClickEvent,
  url: string,
  bridge: ArtifactDownloadBridge | undefined,
): Promise<{ handledByDesktop: boolean; error?: string }> {
  const downloadAgentArtifact = bridge?.downloadAgentArtifact;
  if (!downloadAgentArtifact) return { handledByDesktop: false };
  event.preventDefault();
  const result = await downloadAgentArtifact({ url });
  if (!result.success) return { handledByDesktop: true, error: result.error };
  return { handledByDesktop: true };
}
