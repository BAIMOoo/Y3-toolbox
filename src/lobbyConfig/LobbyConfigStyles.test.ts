import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lobbyConfigCss = readFileSync('src/lobbyConfig/LobbyConfig.css', 'utf8');

describe('LobbyConfig responsive layout contract', () => {
  it('keeps wrapped project actions above the editor on narrow windows', () => {
    const toolbar = lobbyConfigCss.match(/\.lobby-config-toolbar\s*\{(?<body>[^}]*)\}/m);

    expect(toolbar?.groups?.body).toContain('flex-shrink: 0');
    expect(lobbyConfigCss).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.lobby-config-toolbar\s*\{[^}]*flex-wrap: wrap/);
    expect(lobbyConfigCss).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.lobby-config-project\s*\{[^}]*flex-basis: 100%/);
  });

  it('uses the loaded-state green for enabled dungeon entry switches', () => {
    expect(lobbyConfigCss).toMatch(/\.lobby-config-toggle-field \.ant-switch\.ant-switch-checked\s*\{[^}]*background: #52c41a/);
  });

  it('keeps all three panes independently scrollable and stacks them on narrow windows', () => {
    expect(lobbyConfigCss).toMatch(/\.lobby-config-sidebar\s*\{[^}]*overflow: auto/);
    expect(lobbyConfigCss).toMatch(/\.lobby-config-editor\s*\{[^}]*overflow: auto/);
    expect(lobbyConfigCss).toMatch(/\.lobby-config-inspector \.ant-tabs-tabpane\s*\{[^}]*overflow: auto/);
    expect(lobbyConfigCss).toMatch(/\.lobby-config-workspace > \.ant-spin\s*,[\s\S]*?display: flex/);
    expect(lobbyConfigCss).toMatch(/\.lobby-config-workspace > \.ant-spin > \.ant-spin-container\s*,[\s\S]*?display: flex/);
    expect(lobbyConfigCss).toMatch(/@media \(max-width: 1100px\)[\s\S]*?\.lobby-config-primary-split > \.resizable-split-separator[\s\S]*?display: none !important/);
  });
});
