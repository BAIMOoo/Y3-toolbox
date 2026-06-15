import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const startScript = fs.readFileSync(path.join(process.cwd(), 'scripts/windows/start-dev-backend.ps1'), 'utf8');
const stopScript = fs.readFileSync(path.join(process.cwd(), 'scripts/windows/stop-dev-backend.ps1'), 'utf8');
const statusScript = fs.readFileSync(path.join(process.cwd(), 'scripts/windows/status-backend.ps1'), 'utf8');

describe('Windows dev backend scripts contract', () => {
  it('starts only the isolated development runner on port 8791', () => {
    expect(startScript).toContain('[int]$RunnerPort = 8791');
    expect(startScript).toContain("AGENT_RUNNER_PORT = [string]$RunnerPort");
    expect(startScript).toContain("AGENT_RUNNER_HOST = '127.0.0.1'");
    expect(startScript).toContain("Join-Path $ProjectRoot '.omx\\dev-agent-jobs'");
    expect(startScript).toContain("Join-Path $ProjectRoot '.omx\\dev-public-input'");
    expect(startScript).toContain('[string]$KkresProjectPath');
    expect(startScript).toContain('AGENT_KKRES_PROJECT_PATH = $KkresProjectPath');
    expect(startScript).toContain('function Resolve-Y3SourceRoot');
    expect(startScript).toContain("Join-Path $Root 'src'");
    expect(startScript).toContain('.omx\\windows-node');
    expect(startScript).toContain('tsx@4.22.4');
    expect(startScript).toContain("ArgumentList @('scripts/agent-runner/index.ts')");
    expect(startScript).toContain('agent-runner-dev-win.pid');
    expect(startScript).not.toContain('wsl.exe');
    expect(startScript).not.toContain('$cloudflared');
    expect(startScript).not.toContain('cloudflared.exe');
    expect(startScript).not.toContain('vite.web.config.ts');
    expect(startScript).not.toContain('5173');
  });

  it('stops only the development runner PID and dev-runner command lines', () => {
    expect(stopScript).toContain('.omx\\state\\agent-runner-dev-win.pid');
    expect(stopScript).toContain('Get-NetTCPConnection');
    expect(stopScript).toContain('LocalPort 8791');
    expect(stopScript).toContain('AGENT_RUNNER_PORT = \'\'8791\'\'');
    expect(stopScript).toContain('dev-agent-jobs');
    expect(stopScript).not.toContain('agent-runner-win.pid');
    expect(stopScript).not.toContain('cloudflared');
    expect(stopScript).not.toContain('wsl.exe');
  });

  it('reports public and dev status without invoking stop or start', () => {
    expect(statusScript).toContain('http://127.0.0.1:8790/api/health');
    expect(statusScript).toContain('http://127.0.0.1:8791/api/health');
    expect(statusScript).toContain('.omx\\state\\agent-runner-dev-win.pid');
    expect(statusScript).toContain("runnerPidKind = 'windows'");
    expect(statusScript).not.toMatch(/Stop-Process|Start-Process/);
  });
});
