import { execFileSync } from 'node:child_process';

export function parseNetstatListeningPid(output, port) {
  const target = String(port);
  for (const raw of String(output || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !/\bLISTENING\b/i.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const local = parts[1] || '';
    const state = parts[3] || '';
    const pid = Number(parts[4]);
    const m = local.match(/:(\d+)$/);
    if (!m || m[1] !== target || !/LISTENING/i.test(state) || !Number.isInteger(pid) || pid <= 0) continue;
    return pid;
  }
  return null;
}

export function looksLikeTaskBoardProcess(owner) {
  if (!owner) return false;
  const text = `${owner.name || ''} ${owner.commandLine || ''} ${owner.executablePath || ''}`;
  const nodeLike = /\bnode(?:\.exe)?\b/i.test(text);
  const serverEntry = /src[\\/]server[\\/]index\.js/i.test(text);
  const projectName = /taskboard-codex/i.test(text);
  return nodeLike && (serverEntry || projectName);
}

export function getWindowsPortOwner(port) {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], {
      encoding: 'utf8', windowsHide: true, timeout: 5_000,
    });
    const pid = parseNetstatListeningPid(output, port);
    if (!pid) return null;

    let info = null;
    try {
      const script = `$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"; if($p){[pscustomobject]@{Name=$p.Name;CommandLine=$p.CommandLine;ExecutablePath=$p.ExecutablePath}|ConvertTo-Json -Compress}`;
      const json = execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
      ], { encoding: 'utf8', windowsHide: true, timeout: 8_000 }).trim();
      if (json) info = JSON.parse(json);
    } catch {
      // PID is still useful even if command-line inspection is blocked.
    }
    return {
      pid,
      name: info?.Name || null,
      commandLine: info?.CommandLine || null,
      executablePath: info?.ExecutablePath || null,
    };
  } catch {
    return null;
  }
}

export function killWindowsProcessTree(pid) {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true, timeout: 8_000,
    });
    return true;
  } catch {
    return false;
  }
}
