import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, win32 as winPath, posix as posixPath } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const OFFICIAL_WINDOWS_INSTALL = 'https://chatgpt.com/codex/install.ps1';

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function defaultSpawnSync(command, args, options) {
  return spawnSync(command, args, options);
}

function defaultSpawn(command, args, options) {
  return spawn(command, args, options);
}

function normalizedOutput(result) {
  return String(result?.stdout || result?.stderr || '').trim();
}

function uniq(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!value) continue;
    const key = process.platform === 'win32' ? String(value).toLowerCase() : String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(String(value));
  }
  return output;
}

function windowsPathCandidates(env) {
  const j = winPath.join;
  const userProfile = env.USERPROFILE || homedir();
  const localAppData = env.LOCALAPPDATA || j(userProfile, 'AppData', 'Local');
  const appData = env.APPDATA || j(userProfile, 'AppData', 'Roaming');
  const codexHome = env.CODEX_HOME || j(userProfile, '.codex');
  const installDir = env.CODEX_INSTALL_DIR || j(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin');
  return [
    j(installDir, 'codex.exe'),
    j(codexHome, 'packages', 'standalone', 'current', 'bin', 'codex.exe'),
    j(codexHome, 'packages', 'standalone', 'current', 'codex.exe'),
    j(localAppData, 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    j(appData, 'npm', 'codex.cmd'),
    j(appData, 'npm', 'codex.exe'),
  ];
}

function posixPathCandidates(env) {
  const j = posixPath.join;
  const home = env.HOME || homedir();
  const codexHome = env.CODEX_HOME || j(home, '.codex');
  const installDir = env.CODEX_INSTALL_DIR || j(home, '.local', 'bin');
  return [
    j(installDir, 'codex'),
    j(codexHome, 'packages', 'standalone', 'current', 'bin', 'codex'),
    j(codexHome, 'packages', 'standalone', 'current', 'codex'),
  ];
}

export class CodexRuntimeResolver {
  constructor({
    platform = process.platform,
    env = process.env,
    exists = existsSync,
    spawnSyncImpl = defaultSpawnSync,
    spawnImpl = defaultSpawn,
    autoInstall = env.TASKBOARD_CODEX_AUTO_INSTALL !== '0',
    logger = console,
  } = {}) {
    this.platform = platform;
    this.env = env;
    this.exists = exists;
    this.spawnSyncImpl = spawnSyncImpl;
    this.spawnImpl = spawnImpl;
    this.autoInstall = autoInstall;
    this.logger = logger;
    this.command = null;
    this.source = null;
    this.version = null;
    this.error = null;
    this.state = 'idle';
    this.preparePromise = null;
    this.installAttempted = false;
  }

  status() {
    return {
      state: this.state,
      available: this.state === 'ready',
      preparing: this.state === 'resolving' || this.state === 'installing',
      command: this.command,
      source: this.source,
      version: this.version,
      error: this.error,
      autoInstall: this.autoInstall,
      installAttempted: this.installAttempted,
    };
  }

  childOptions(extra = {}) {
    return {
      ...extra,
      env: this.env,
      windowsHide: true,
      shell: this.platform === 'win32',
    };
  }

  probeCommand(command) {
    if (!command) return null;
    const result = this.spawnSyncImpl(command, ['--version'], this.childOptions({ encoding: 'utf8', timeout: 8_000 }));
    if (result?.status !== 0) return null;
    const version = normalizedOutput(result);
    return { command, version: version || null };
  }

  whereCandidates() {
    if (this.platform === 'win32') {
      const result = this.spawnSyncImpl('where.exe', ['codex'], { encoding:'utf8', windowsHide:true, timeout:5_000, env:this.env });
      if (result?.status !== 0) return [];
      return String(result.stdout || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    }
    const result = this.spawnSyncImpl('sh', ['-lc', 'command -v codex 2>/dev/null || true'], { encoding:'utf8', timeout:5_000, env:this.env });
    if (result?.status !== 0) return [];
    return String(result.stdout || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  }

  candidateCommands() {
    const explicit = this.env.CODEX_COMMAND || this.env.TASKBOARD_CODEX_COMMAND || null;
    const known = this.platform === 'win32' ? windowsPathCandidates(this.env) : posixPathCandidates(this.env);
    const candidates = [explicit, ...this.whereCandidates(), ...known].filter(Boolean);
    return uniq(candidates.filter(candidate => candidate === explicit || this.exists(candidate)));
  }

  resolveInstalled() {
    this.state = 'resolving';
    this.error = null;
    for (const candidate of this.candidateCommands()) {
      const probed = this.probeCommand(candidate);
      if (!probed) continue;
      this.command = probed.command;
      this.version = probed.version;
      const explicit = this.env.CODEX_COMMAND || this.env.TASKBOARD_CODEX_COMMAND || null;
      if (explicit && resolve(String(candidate)) === resolve(String(explicit))) this.source = 'explicit';
      else if (/npm[\\/]/i.test(candidate) || /codex\.cmd$/i.test(candidate)) this.source = 'npm';
      else if (/packages[\\/]standalone/i.test(candidate) || /Programs[\\/]OpenAI[\\/]Codex[\\/]bin/i.test(candidate)) this.source = 'standalone';
      else this.source = 'path';
      this.state = 'ready';
      return this.status();
    }
    this.command = null;
    this.version = null;
    this.source = null;
    this.state = 'missing';
    this.error = 'Codex CLI runtime was not found';
    return this.status();
  }

  canAutoInstall() {
    return this.autoInstall && this.platform === 'win32';
  }

  installWindowsStandalone() {
    this.installAttempted = true;
    this.state = 'installing';
    this.error = null;
    const script = [
      "$ErrorActionPreference='Stop'",
      "$ProgressPreference='SilentlyContinue'",
      "$env:CODEX_NON_INTERACTIVE='1'",
      `$installer=Invoke-RestMethod -UseBasicParsing ${quotePowerShell(OFFICIAL_WINDOWS_INSTALL)}`,
      'Invoke-Expression $installer',
    ].join('; ');
    return new Promise((resolvePromise, rejectPromise) => {
      const child = this.spawnImpl('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
      ], {
        env: this.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
      child.once('error', rejectPromise);
      child.once('exit', code => {
        if (code === 0) resolvePromise({ stdout, stderr });
        else rejectPromise(new Error((stderr || stdout || `Codex installer exited with code ${code}`).trim()));
      });
    });
  }

  async prepare() {
    if (this.state === 'ready') return this.status();
    if (this.preparePromise) return this.preparePromise;
    this.preparePromise = (async () => {
      const previousError = this.error;
      const installed = this.resolveInstalled();
      if (installed.available) return installed;
      if (this.installAttempted) {
        this.state = 'failed';
        this.error = previousError || 'Codex CLI runtime is still unavailable after automatic preparation';
        return this.status();
      }
      if (!this.canAutoInstall()) {
        this.state = 'failed';
        this.error = this.autoInstall
          ? 'Codex CLI is missing and automatic bootstrap is unavailable on this platform'
          : 'Codex CLI is missing and automatic bootstrap is disabled';
        return this.status();
      }
      try {
        this.logger?.log?.('[codex-runtime] Codex CLI not found; preparing the official standalone runtime in the background.');
        await this.installWindowsStandalone();
        const after = this.resolveInstalled();
        if (!after.available) throw new Error('The official Codex installer completed, but no usable Codex CLI could be resolved');
        return after;
      } catch (error) {
        this.state = 'failed';
        this.error = error?.message || String(error);
        this.logger?.error?.('[codex-runtime] automatic Codex runtime preparation failed:', this.error);
        return this.status();
      }
    })();
    try { return await this.preparePromise; }
    finally { this.preparePromise = null; }
  }

  startPrepare() {
    this.prepare().catch(() => {});
    return this.status();
  }

  async requireReady() {
    const status = await this.prepare();
    if (!status.available || !status.command) {
      const error = new Error(status.error || 'Codex CLI runtime unavailable');
      error.code = 'CODEX_RUNTIME_UNAVAILABLE';
      error.runtimeStatus = status;
      throw error;
    }
    return status;
  }
}

export { OFFICIAL_WINDOWS_INSTALL };
