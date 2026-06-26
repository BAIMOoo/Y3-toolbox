import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

function expectDeclaration(block: string, property: string, value: string) {
  expect(block).toMatch(new RegExp(`${property}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`));
}

describe('diff workspace layout contract', () => {
  it('keeps the keep-alive wrapper layout-equivalent to the original diff app content column', () => {
    const block = cssRule('.diff-workspace');

    expectDeclaration(block, 'flex', '1');
    expectDeclaration(block, 'min-height', '0');
    expectDeclaration(block, 'display', 'flex');
    expectDeclaration(block, 'flex-direction', 'column');
  });
  it('keeps inactive keep-alive workspace hidden despite the flex display rule', () => {
    const block = cssRule('.diff-workspace[hidden]');

    expectDeclaration(block, 'display', 'none');
  });

});
