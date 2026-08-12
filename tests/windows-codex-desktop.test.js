import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appxCodexDesktopExecutables,
  codexDesktopCandidates,
  codexDesktopProcessRows,
  codexDesktopRunning,
  tasklistHasCodex,
  requestCodexDesktopExit,
} from '../scripts/windows-codex-desktop.mjs';

function result(status, stdout='', stderr=''){return{status,stdout,stderr};}

test('legacy task-list helper recognizes both current ChatGPT.exe and older Codex.exe host names',()=>{
  assert.equal(tasklistHasCodex('"Codex.exe","123","Console","1","100 K"'),true);
  assert.equal(tasklistHasCodex('"ChatGPT.exe","321","Console","1","100 K"'),true);
  assert.equal(tasklistHasCodex('"codex-cli.exe","321","Console","1","100 K"'),false);
});

test('OpenAI.Codex package discovery accepts current ChatGPT.exe desktop executable',()=>{
  const current='C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.721.4979.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe';
  const rows=appxCodexDesktopExecutables({spawnSyncImpl:(command,args)=>{
    assert.equal(command,'powershell.exe');
    assert.match(args.at(-1),/AppxManifest\.xml/);
    assert.match(args.at(-1),/ChatGPT\.exe/);
    return result(0,current+'\r\n');
  }});
  assert.deepEqual(rows,[current]);
});

test('Windows Codex desktop discovery uses package executable and never PATH codex CLI',()=>{
  const appx='C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.721.4979.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe';
  const calls=[];
  const candidates=codexDesktopCandidates({
    env:{},
    exists:path=>path===appx,
    spawnSyncImpl:(command,args)=>{
      calls.push([command,args]);
      if(command==='powershell.exe')return result(0,appx+'\r\n');
      return result(1);
    },
  });
  assert.deepEqual(candidates,[appx]);
  assert.equal(calls.some(([command])=>command==='where.exe'),false,'desktop resolver must not resolve codex CLI through PATH');
});

test('explicit Codex desktop path wins over detected package paths',()=>{
  const explicit='D:\\Apps\\CodexDesktop\\Host.exe';
  const appx='C:\\Program Files\\WindowsApps\\OpenAI.Codex_x64\\app\\ChatGPT.exe';
  const candidates=codexDesktopCandidates({
    env:{TASKBOARD_CODEX_DESKTOP_COMMAND:explicit}, exists:path=>path===explicit||path===appx,
    spawnSyncImpl:(command)=>command==='powershell.exe'?result(0,appx):result(1),
  });
  assert.equal(candidates[0],explicit);
});

test('running-process discovery is package-path based so unrelated ChatGPT Desktop is not treated as Codex',()=>{
  const packageProcess='8720|C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.721.4979.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe';
  const rows=codexDesktopProcessRows({spawnSyncImpl:(command,args)=>{
    assert.equal(command,'powershell.exe');
    const script=args.at(-1);
    assert.match(script,/Get-AppxPackage -Name OpenAI\.Codex/);
    assert.match(script,/StartsWith\(\$root/);
    return result(0,packageProcess+'\r\n');
  }});
  assert.deepEqual(rows,[packageProcess]);
  assert.equal(codexDesktopRunning({spawnSyncImpl:()=>result(0,packageProcess)}),true);
});

test('forced restart stops only processes belonging to OpenAI.Codex package or explicit host path',()=>{
  const calls=[];
  requestCodexDesktopExit({force:true,spawnSyncImpl:(command,args)=>{calls.push([command,args]);return result(0);}});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'powershell.exe');
  const script=calls[0][1].at(-1);
  assert.match(script,/Get-AppxPackage -Name OpenAI\.Codex/);
  assert.match(script,/StartsWith\(\$root/);
  assert.match(script,/Stop-Process -Id \$p\.Id -Force/);
  assert.doesNotMatch(script,/taskkill\.exe/i);
});
