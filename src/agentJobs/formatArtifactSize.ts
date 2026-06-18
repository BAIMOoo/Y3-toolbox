export function formatArtifactSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return '0 KB';
  const mb = sizeBytes / (1024 * 1024);
  if (mb >= 1) return `${formatSizeNumber(mb)} MB`;
  return `${formatSizeNumber(sizeBytes / 1024)} KB`;
}

function formatSizeNumber(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
