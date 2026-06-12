import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8');

type ToneName = 'graphite' | 'paper';
type StatusName = 'create' | 'update' | 'delete';

function toneBlock(tone: ToneName): string {
  const match = css.match(new RegExp(`\\.app-shell--tone-${tone}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing tone block: ${tone}`);
  return match[1];
}

function cssVar(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing CSS variable: ${name}`);
  return match[1].trim();
}

describe('Snapshot Compare tone status color contract', () => {
  it('defines graphite status badge hues as muted dark-mode readout colors', () => {
    const block = toneBlock('graphite');

    expect(cssVar(block, '--status-color-create')).toBe('#7fb89a');
    expect(cssVar(block, '--status-color-update')).toBe('#b79552');
    expect(cssVar(block, '--status-color-delete')).toBe('#bd777f');
    expect(cssVar(block, '--status-bg-update')).toBe('rgba(183, 149, 82, 0.12)');
  });

  it.each<ToneName>(['graphite', 'paper'])('makes %s Snapshot Compare colors reuse StatusBar color tokens', (tone) => {
    const block = toneBlock(tone);
    const statuses: StatusName[] = ['create', 'update', 'delete'];

    for (const status of statuses) {
      expect(cssVar(block, `--snapshot-compare-color-${status}`)).toBe(`var(--status-color-${status})`);
      expect(cssVar(block, `--snapshot-compare-border-${status}`)).toBe(`var(--status-bg-${status})`);
    }
  });

  it('keeps graphite diff rows transparent for low-noise dark mode', () => {
    const block = toneBlock('graphite');

    expect(cssVar(block, '--snapshot-compare-bg-create')).toBe('transparent');
    expect(cssVar(block, '--snapshot-compare-bg-update')).toBe('transparent');
    expect(cssVar(block, '--snapshot-compare-bg-delete')).toBe('transparent');
  });

  it('gives paper diff rows and badges visible semantic fill', () => {
    const block = toneBlock('paper');

    expect(cssVar(block, '--status-bg-create')).toBe('rgba(19, 122, 63, 0.14)');
    expect(cssVar(block, '--status-bg-update')).toBe('rgba(138, 90, 0, 0.16)');
    expect(cssVar(block, '--status-bg-delete')).toBe('rgba(180, 35, 47, 0.14)');
    expect(cssVar(block, '--snapshot-compare-bg-create')).toBe('var(--status-bg-create)');
    expect(cssVar(block, '--snapshot-compare-bg-update')).toBe('var(--status-bg-update)');
    expect(cssVar(block, '--snapshot-compare-bg-delete')).toBe('var(--status-bg-delete)');
    expect(cssVar(block, '--color-update-bg')).toBe('var(--status-bg-update)');
  });

  it('does not use bright neon graphite status colors', () => {
    const block = toneBlock('graphite');

    expect(cssVar(block, '--status-color-create')).not.toBe('#5eead4');
    expect(cssVar(block, '--status-color-update')).not.toBe('#fbbf24');
    expect(cssVar(block, '--status-color-delete')).not.toBe('#fb7185');
  });

  it('keeps graphite and paper semantic colors visually distinct', () => {
    const graphite = toneBlock('graphite');
    const paper = toneBlock('paper');
    const statuses: StatusName[] = ['create', 'update', 'delete'];

    for (const status of statuses) {
      expect(cssVar(graphite, `--status-color-${status}`)).not.toBe(cssVar(paper, `--status-color-${status}`));
      expect(cssVar(graphite, `--status-bg-${status}`)).not.toBe(cssVar(paper, `--status-bg-${status}`));
    }
  });

});
