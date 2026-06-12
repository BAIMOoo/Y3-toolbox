import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync('src/App.css', 'utf8');
const localArchiveViewer = readFileSync('src/archiveViewer/LocalArchiveViewer.tsx', 'utf8');

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appCss.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'm'));
  return match?.groups?.body ?? '';
}

function declarationsForPattern(selectorPattern: string): string {
  const match = appCss.match(new RegExp(`${selectorPattern}\\s*\\{(?<body>[^}]*)\\}`, 'm'));
  return match?.groups?.body ?? '';
}

function expectDeclaration(selector: string, declaration: string): void {
  expect(declarationsFor(selector)).toContain(declaration);
}

describe('local archive layout contract', () => {
  it('keeps the app shell header pinned and scopes page-scroll containment to local Archive mode', () => {
    expectDeclaration('.app-shell--local-archive', 'overflow: hidden');
    expectDeclaration('.app-shell-header', 'position: sticky');
    expectDeclaration('.app-shell-header', 'top: 0');
    expectDeclaration('.app-shell-header', 'flex-shrink: 0');
    expectDeclaration('.app-content--local-archive', 'overflow: hidden');
  });

  it('keeps the local Archive toolbar above the scrolling tab content', () => {
    expect(localArchiveViewer).toContain('className="local-archive-viewer"');
    expect(localArchiveViewer).toContain('className="local-archive-toolbar"');
    expect(localArchiveViewer).toContain('className="local-archive-tabs"');
    expect(localArchiveViewer).toContain('className="local-archive-error-pane"');

    expectDeclaration('.local-archive-viewer', 'overflow: hidden');
    expectDeclaration('.local-archive-toolbar', 'position: sticky');
    expectDeclaration('.local-archive-toolbar', 'top: 0');
    expectDeclaration('.local-archive-toolbar', 'flex-shrink: 0');
  });

  it('bounds Ant Tabs height so the archive grid owns scrolling', () => {
    expectDeclaration('.local-archive-tabs.ant-tabs', 'overflow: hidden');
    expectDeclaration('.local-archive-tabs > .ant-tabs-content-holder', 'min-height: 0');
    expectDeclaration('.local-archive-tabs > .ant-tabs-content-holder', 'overflow: hidden');
    expectDeclaration('.local-archive-tabs > .ant-tabs-content-holder > .ant-tabs-content', 'height: 100%');
    expectDeclaration('.local-archive-tabs > .ant-tabs-content-holder > .ant-tabs-content > .ant-tabs-tabpane', 'overflow: hidden');
    expectDeclaration('.local-archive-error-pane', 'overflow: auto');
    expectDeclaration('.local-archive-grid', 'overflow: auto');
  });

  it('keeps local Archive tab active and focus states visibly distinct across tones', () => {
    expect(appCss).toContain('background: var(--highlight-bg) !important');
    expect(appCss).toContain('border-color: var(--border-strong) !important');
    expect(appCss).toContain('box-shadow: inset 0 2px 0 var(--text-primary) !important');
    expect(appCss).toContain('color: var(--text-primary) !important');
    expect(appCss).toContain('.local-archive-tabs.ant-tabs-card > .ant-tabs-nav .ant-tabs-tab:focus-visible');
    expect(appCss).toContain('outline: 2px solid var(--text-primary)');
  });

  it('guards Slot cards and badges against horizontal overflow', () => {
    expectDeclaration('.archive-slot-card', 'grid-template-columns: 48px minmax(0, 1fr) minmax(48px, max-content)');
    expectDeclaration('.archive-slot-card', 'overflow: hidden');
    expectDeclaration('.archive-slot-card', 'max-height: 58px');
    expectDeclaration('.archive-slot-card__main', 'min-width: 0');
    expectDeclaration('.archive-slot-card__badges', 'min-width: 0');
    expectDeclaration('.archive-slot-card__badges', 'max-width: 58px');
    const badgeDeclarations = declarationsForPattern(
      '\\.archive-slot-card__badges \\.archive-type-badge,\\s*\\.archive-slot-card__badges \\.archive-source-badge',
    );
    expect(badgeDeclarations).toContain('max-width: 100%');
    expect(badgeDeclarations).toContain('text-overflow: ellipsis');
  });

  it('keeps tree disclosure controls aligned and keyboard visible', () => {
    expect(localArchiveViewer).toContain('className="archive-tree-row__toggle"');
    expect(localArchiveViewer).toContain('aria-expanded={expanded}');
    expect(localArchiveViewer).toContain('className="archive-tree-row__toggle-spacer"');
    expect(localArchiveViewer).toContain('collectExpandedNodeKeys');
    expect(localArchiveViewer).toContain("node.typeName === 'dict' ? null");
    expectDeclaration('.archive-tree-row__field', 'display: inline-flex');
    expectDeclaration('.archive-tree-row__label', 'text-overflow: ellipsis');
    expectDeclaration('.archive-tree-row__toggle', 'cursor: pointer');
    expectDeclaration('.archive-tree-row__type', 'display: flex');
    expectDeclaration('.archive-tree-row__type', 'align-items: center');
    expect(appCss).toContain('.archive-tree-row__toggle:focus-visible');
  });

});
