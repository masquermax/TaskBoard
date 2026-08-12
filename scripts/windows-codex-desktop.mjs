import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

function outputLines(value) {
  return String(value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function powershell(script, { spawnSyncImpl = spawnSync, timeout = 8_000 } = {}) {
  return spawnSyncImpl('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], {
    encoding:'utf8', windowsHide:true, timeout,
  });
}

export function tasklistHasCodex(output) {
  return /"(?:Codex|ChatGPT)\.exe"/i.test(String(output || ''));
}

/**
 * Return executable paths declared by the installed OpenAI.Codex MSIX package.
 * Newer Windows builds use app\\ChatGPT.exe while older ones used app\\Codex.exe,
 * so the package manifest is the source of truth rather than a hard-coded name.
 */
export function appxCodexDesktopExecutables({ spawnSyncImpl = spawnSync } = {}) {
  const script = [
    "$p=Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1",
    "if(-not $p){exit 0}",
    "$root=$p.InstallLocation",
    "$seen=@{}",
    "$emit={param($rel) if([string]::IsNullOrWhiteSpace($rel)){return}; $x=Join-Path $root $rel; if((Test-Path -LiteralPath $x) -and -not $seen.ContainsKey($x.ToLowerInvariant())){$seen[$x.ToLowerInvariant()]=$true; Write-Output $x}}",
    "$manifest=Join-Path $root 'AppxManifest.xml'",
    "if(Test-Path -LiteralPath $manifest){try{[xml]$xml=Get-Content -LiteralPath $manifest -Raw; foreach($n in $xml.SelectNodes(\"//*[local-name()='Application']\")){& $emit $n.GetAttribute('Executable')}}catch{}}",
    "& $emit 'app\\ChatGPT.exe'",
    "& $emit 'app\\Codex.exe'",
  ].join('; ');
  const result = powershell(script, { spawnSyncImpl, timeout:10_000 });
  return result?.status === 0 ? outputLines(result.stdout) : [];
}

export function appxCodexInstallRoot({ spawnSyncImpl = spawnSync } = {}) {
  const script = "$p=Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1; if($p){Write-Output $p.InstallLocation}";
  const result = powershell(script, { spawnSyncImpl });
  return result?.status === 0 ? outputLines(result.stdout)[0] || null : null;
}

export function codexDesktopCandidates({ env = process.env, exists = existsSync, spawnSyncImpl = spawnSync } = {}) {
  // Never use `where codex.exe` here: that commonly resolves the CLI/standalone
  // runtime, which is not the Electron desktop host and cannot expose a renderer CDP.
  const rows = [
    env.TASKBOARD_CODEX_DESKTOP_COMMAND || null,
    ...appxCodexDesktopExecutables({ spawnSyncImpl }),
  ].filter(Boolean);
  const seen = new Set();
  return rows.filter(path => {
    const key = String(path).toLowerCase();
    if (seen.has(key) || !exists(path)) return false;
    seen.add(key);
    return true;
  });
}

export function codexDesktopProcessRows({ env = process.env, spawnSyncImpl = spawnSync } = {}) {
  const explicit = env.TASKBOARD_CODEX_DESKTOP_COMMAND || '';
  const explicitClause = explicit
    ? `$explicit=${psQuote(explicit)}; if($path -and [string]::Equals($path,$explicit,[System.StringComparison]::OrdinalIgnoreCase)){$match=$true}`
    : '';
  const script = [
    "$pkg=Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1",
    "$root=if($pkg){$pkg.InstallLocation}else{$null}",
    "$names=@('Codex','ChatGPT')",
    "foreach($name in $names){foreach($p in @(Get-Process -Name $name -ErrorAction SilentlyContinue)){",
    "$path=$null; try{$path=$p.Path}catch{}; $match=$false",
    "if($root -and $path -and $path.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase)){$match=$true}",
    explicitClause,
    "if($match){Write-Output ($p.Id.ToString()+'|'+$path)}}}",
  ].filter(Boolean).join('; ');
  const result = powershell(script, { spawnSyncImpl });
  return result?.status === 0 ? outputLines(result.stdout) : [];
}

export function codexDesktopRunning(options = {}) {
  return codexDesktopProcessRows(options).length > 0;
}

export function requestCodexDesktopExit({ env = process.env, spawnSyncImpl = spawnSync, force = false } = {}) {
  const explicit = env.TASKBOARD_CODEX_DESKTOP_COMMAND || '';
  const explicitClause = explicit
    ? `$explicit=${psQuote(explicit)}; if($path -and [string]::Equals($path,$explicit,[System.StringComparison]::OrdinalIgnoreCase)){$match=$true}`
    : '';
  const action = force
    ? "try{Stop-Process -Id $p.Id -Force -ErrorAction Stop}catch{}"
    : "try{$null=$p.CloseMainWindow()}catch{}";
  const script = [
    "$pkg=Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1",
    "$root=if($pkg){$pkg.InstallLocation}else{$null}",
    "$names=@('Codex','ChatGPT')",
    "foreach($name in $names){foreach($p in @(Get-Process -Name $name -ErrorAction SilentlyContinue)){",
    "$path=$null; try{$path=$p.Path}catch{}; $match=$false",
    "if($root -and $path -and $path.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase)){$match=$true}",
    explicitClause,
    `if($match){${action}}}`,
  ].filter(Boolean).join('; ');
  const result = powershell(script, { spawnSyncImpl });
  return result?.status === 0;
}

export function launchCodexDesktop(exe, args, { spawnImpl = spawn } = {}) {
  const child = spawnImpl(exe, args, { cwd:dirname(exe), detached:true, stdio:'ignore', windowsHide:false });
  child.unref?.();
  return child;
}

export { psQuote };
