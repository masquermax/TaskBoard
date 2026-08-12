import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CodexRuntimeResolver, OFFICIAL_WINDOWS_INSTALL } from '../src/extensions/executors/codex/codex-runtime-resolver.js';

function fakeResult(status, stdout = '', stderr = '') { return { status, stdout, stderr, error:null }; }

function childThatExits(code = 0, stdout = '', stderr = '') {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('exit', code);
  });
  return child;
}

test('Codex runtime resolver uses an existing explicit command without installing anything', async () => {
  let installs = 0;
  const resolver = new CodexRuntimeResolver({
    platform:'win32',
    env:{ CODEX_COMMAND:'C:\\tools\\codex.exe' },
    exists:path=>path==='C:\\tools\\codex.exe',
    spawnSyncImpl:(command,args)=>{
      if(command==='where.exe')return fakeResult(1);
      if(command==='C:\\tools\\codex.exe'&&args[0]==='--version')return fakeResult(0,'codex-cli 1.2.3\n');
      return fakeResult(1);
    },
    spawnImpl:()=>{installs+=1;return childThatExits(0);},
    logger:{log(){},error(){}},
  });
  const status=await resolver.prepare();
  assert.equal(status.available,true);
  assert.equal(status.command,'C:\\tools\\codex.exe');
  assert.equal(status.version,'codex-cli 1.2.3');
  assert.equal(status.source,'explicit');
  assert.equal(installs,0);
});

test('Codex runtime resolver discovers the official standalone install even when codex is absent from PATH', async () => {
  const standalone='C:\\Users\\max\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe';
  const resolver=new CodexRuntimeResolver({
    platform:'win32',
    env:{USERPROFILE:'C:\\Users\\max',LOCALAPPDATA:'C:\\Users\\max\\AppData\\Local',APPDATA:'C:\\Users\\max\\AppData\\Roaming'},
    exists:path=>path===standalone,
    spawnSyncImpl:(command,args)=>{
      if(command==='where.exe')return fakeResult(1);
      if(command===standalone&&args[0]==='--version')return fakeResult(0,'codex-cli 2.0.0');
      return fakeResult(1);
    },
    logger:{log(){},error(){}},
  });
  const status=await resolver.prepare();
  assert.equal(status.available,true);
  assert.equal(status.source,'standalone');
  assert.equal(status.command,standalone);
});

test('missing Codex CLI is bootstrapped with the official Windows standalone installer, not npm', async () => {
  const standalone='C:\\Users\\max\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe';
  let installed=false;
  let installerArgs=null;
  const resolver=new CodexRuntimeResolver({
    platform:'win32',
    env:{USERPROFILE:'C:\\Users\\max',LOCALAPPDATA:'C:\\Users\\max\\AppData\\Local',APPDATA:'C:\\Users\\max\\AppData\\Roaming'},
    exists:path=>installed&&path===standalone,
    spawnSyncImpl:(command,args)=>{
      if(command==='where.exe')return fakeResult(1);
      if(installed&&command===standalone&&args[0]==='--version')return fakeResult(0,'codex-cli 3.0.0');
      return fakeResult(1);
    },
    spawnImpl:(command,args)=>{
      installerArgs={command,args};
      installed=true;
      return childThatExits(0,'installed');
    },
    logger:{log(){},error(){}},
  });
  const status=await resolver.prepare();
  assert.equal(status.available,true);
  assert.equal(status.command,standalone);
  assert.equal(status.installAttempted,true);
  assert.equal(installerArgs.command,'powershell.exe');
  const commandText=installerArgs.args.join(' ');
  assert.match(commandText,/CODEX_NON_INTERACTIVE/);
  assert.match(commandText,new RegExp(OFFICIAL_WINDOWS_INSTALL.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(commandText,/npm\s+(?:install|i)/i);
});

test('automatic runtime preparation does not loop installer attempts after a failure', async () => {
  let installs=0;
  const resolver=new CodexRuntimeResolver({
    platform:'win32', env:{USERPROFILE:'C:\\Users\\max',LOCALAPPDATA:'C:\\Local',APPDATA:'C:\\Roam'}, exists:()=>false,
    spawnSyncImpl:(command)=>command==='where.exe'?fakeResult(1):fakeResult(1),
    spawnImpl:()=>{installs+=1;return childThatExits(1,'','network unavailable');},
    logger:{log(){},error(){}},
  });
  const first=await resolver.prepare();
  const second=await resolver.prepare();
  assert.equal(first.available,false);
  assert.equal(second.available,false);
  assert.equal(installs,1);
  assert.match(second.error,/network unavailable|still unavailable/i);
});

test('automatic installation can be disabled without falling back to a hidden package-manager mutation', async () => {
  let installs=0;
  const resolver=new CodexRuntimeResolver({
    platform:'win32', env:{TASKBOARD_CODEX_AUTO_INSTALL:'0'}, autoInstall:false, exists:()=>false,
    spawnSyncImpl:(command)=>command==='where.exe'?fakeResult(1):fakeResult(1),
    spawnImpl:()=>{installs+=1;return childThatExits(0);}, logger:{log(){},error(){}},
  });
  const status=await resolver.prepare();
  assert.equal(status.available,false);
  assert.equal(status.state,'failed');
  assert.match(status.error,/disabled/i);
  assert.equal(installs,0);
});
